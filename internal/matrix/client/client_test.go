package client_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestClient_LoginWithToken(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
	}))
	defer server.Close()

	cfg := config.MatrixConfig{
		HomeserverURL: server.URL,
		UserID:        "@bot:example.com",
		AccessToken:   "test_token_123",
		DeviceID:      "DEV_TEST",
		DBPath:        dbPath,
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	ctx := context.Background()
	if err := c.Login(ctx); err != nil {
		t.Fatalf("login failed: %v", err)
	}

	if c.UnderlyingClient().AccessToken != "test_token_123" {
		t.Errorf("expected access token 'test_token_123', got %q", c.UnderlyingClient().AccessToken)
	}
	if string(c.UnderlyingClient().DeviceID) != "DEV_TEST" {
		t.Errorf("expected device ID 'DEV_TEST', got %q", c.UnderlyingClient().DeviceID)
	}
}

func TestClient_LoginWithPassword(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/_matrix/client/r0/login" || r.URL.Path == "/_matrix/client/v3/login" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"user_id":      "@bot:example.com",
				"access_token": "password_acquired_token",
				"device_id":    "NEW_DEV_ID",
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := config.MatrixConfig{
		HomeserverURL: server.URL,
		UserID:        "@bot:example.com",
		Password:      "secret_pass",
		DBPath:        dbPath,
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	ctx := context.Background()
	if err := c.Login(ctx); err != nil {
		t.Fatalf("password login failed: %v", err)
	}

	if c.UnderlyingClient().AccessToken != "password_acquired_token" {
		t.Errorf("expected token 'password_acquired_token', got %q", c.UnderlyingClient().AccessToken)
	}
	if string(c.UnderlyingClient().DeviceID) != "NEW_DEV_ID" {
		t.Errorf("expected device ID 'NEW_DEV_ID', got %q", c.UnderlyingClient().DeviceID)
	}

	// Create second client instance to verify credential restoration from DB
	c2, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create second client: %v", err)
	}
	defer func() { _ = c2.Close() }()

	if err := c2.Login(ctx); err != nil {
		t.Fatalf("restoration login failed: %v", err)
	}
	if c2.UnderlyingClient().AccessToken != "password_acquired_token" {
		t.Errorf("restored token expected 'password_acquired_token', got %q", c2.UnderlyingClient().AccessToken)
	}
}

func TestClient_SyncLoop_CancellationAndMessage(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	var syncCount int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/_matrix/client/r0/sync" || r.URL.Path == "/_matrix/client/v3/sync" {
			current := atomic.AddInt64(&syncCount, 1)
			if current == 1 {
				// Send a mock sync response containing an m.room.message event
				syncResp := &mautrix.RespSync{
					NextBatch: "batch_token_1",
					Rooms: mautrix.RespSyncRooms{
						Join: map[id.RoomID]*mautrix.SyncJoinedRoom{
							id.RoomID("!room:example.com"): {
								Timeline: mautrix.SyncTimeline{
									SyncEventsList: mautrix.SyncEventsList{
										Events: []*event.Event{
											{
												Type:      event.EventMessage,
												ID:        id.EventID("$event_1"),
												Sender:    id.UserID("@user:example.com"),
												RoomID:    id.RoomID("!room:example.com"),
												Timestamp: time.Now().UnixMilli(),
												Content: event.Content{
													Raw: map[string]interface{}{
														"msgtype": "m.text",
														"body":    "Hello MCP!",
													},
												},
											},
										},
									},
								},
							},
						},
					},
				}
				_ = json.NewEncoder(w).Encode(syncResp)
				return
			}
			// Subsequent sync calls return empty response
			_ = json.NewEncoder(w).Encode(&mautrix.RespSync{
				NextBatch: "batch_token_2",
			})
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	cfg := config.MatrixConfig{
		HomeserverURL: server.URL,
		UserID:        "@bot:example.com",
		AccessToken:   "token_test",
		DBPath:        dbPath,
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	msgReceived := make(chan string, 1)
	c.OnMessage(func(ctx context.Context, evt *event.Event) {
		if content, ok := evt.Content.Raw["body"].(string); ok {
			msgReceived <- content
		}
	})

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- c.SyncLoop(ctx)
	}()

	// Wait for message callback
	select {
	case body := <-msgReceived:
		if body != "Hello MCP!" {
			t.Errorf("expected 'Hello MCP!', got %q", body)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for message dispatch")
	}

	// Cancel sync loop context to verify clean termination
	cancel()

	select {
	case err := <-errCh:
		if err != nil && err != context.Canceled {
			t.Errorf("unexpected sync loop error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for sync loop to stop")
	}
}
