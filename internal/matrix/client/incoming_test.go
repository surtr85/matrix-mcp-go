package client_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestClient_WaitForIncomingMessage_SuccessAndAutoAck(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "wait_msg_test.db")

	var mu sync.Mutex
	var sentReactions []string
	var sentTyping []bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Reaction endpoint: /_matrix/client/v3/rooms/{roomId}/send/m.reaction/{txnId}
		if r.Method == http.MethodPut && filepath.Base(filepath.Dir(r.URL.Path)) == "m.reaction" {
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if relates, ok := body["m.relates_to"].(map[string]interface{}); ok {
				if key, ok := relates["key"].(string); ok {
					mu.Lock()
					sentReactions = append(sentReactions, key)
					mu.Unlock()
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"event_id": "$react_event_1"})
			return
		}

		// Typing endpoint: /_matrix/client/v3/rooms/{roomId}/typing/{userId}
		if r.Method == http.MethodPut && filepath.Base(filepath.Dir(r.URL.Path)) == "typing" {
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if typing, ok := body["typing"].(bool); ok {
				mu.Lock()
				sentTyping = append(sentTyping, typing)
				mu.Unlock()
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{})
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
		AllowedUsers:  []string{"@alice:example.com"},
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	roomID := id.RoomID("!room:example.com")

	waitErrCh := make(chan error, 1)
	go func() {
		msg, err := c.WaitForIncomingMessage(context.Background(), roomID, "", 5*time.Second)
		if err != nil {
			waitErrCh <- err
			return
		}
		if msg.Body != "Hello from Alice!" {
			waitErrCh <- fmt.Errorf("unexpected body: %s", msg.Body)
			return
		}
		if msg.Sender != "@alice:example.com" {
			waitErrCh <- fmt.Errorf("unexpected sender: %s", msg.Sender)
			return
		}
		waitErrCh <- nil
	}()

	// Wait briefly to ensure waiter is registered
	time.Sleep(50 * time.Millisecond)

	// Dispatch simulated event from authorized user
	incomingEvt := &event.Event{
		Type:      event.EventMessage,
		ID:        id.EventID("$event_alice_1"),
		RoomID:    roomID,
		Sender:    id.UserID("@alice:example.com"),
		Timestamp: time.Now().UnixMilli(),
		Content: event.Content{
			Raw: map[string]interface{}{
				"body":    "Hello from Alice!",
				"msgtype": "m.text",
			},
		},
	}
	c.Syncer().Dispatch(context.Background(), incomingEvt)

	select {
	case err := <-waitErrCh:
		if err != nil {
			t.Fatalf("WaitForIncomingMessage failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for WaitForIncomingMessage")
	}

	// Verify auto-acknowledgement: reaction 👀 and typing indicator
	mu.Lock()
	defer mu.Unlock()
	hasEyeReaction := false
	for _, r := range sentReactions {
		if r == "👀" {
			hasEyeReaction = true
			break
		}
	}
	if !hasEyeReaction {
		t.Errorf("expected 👀 reaction to be sent, got reactions: %v", sentReactions)
	}

	hasTyping := false
	for _, typ := range sentTyping {
		if typ {
			hasTyping = true
			break
		}
	}
	if !hasTyping {
		t.Errorf("expected typing status true, got: %v", sentTyping)
	}
}

func TestClient_WaitForIncomingMessage_Timeout(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "wait_msg_timeout.db")

	cfg := config.MatrixConfig{
		HomeserverURL: "http://localhost:8008",
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

	start := time.Now()
	_, err = c.WaitForIncomingMessage(context.Background(), "!room:example.com", "", 100*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	duration := time.Since(start)
	if duration < 90*time.Millisecond {
		t.Errorf("expected duration >= 90ms, got %v", duration)
	}
}

func TestClient_WaitForIncomingMessage_RBACAndDeduplication(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "wait_msg_rbac.db")

	cfg := config.MatrixConfig{
		HomeserverURL: "http://localhost:8008",
		UserID:        "@bot:example.com",
		AccessToken:   "token_test",
		DBPath:        dbPath,
		AllowedUsers:  []string{"@authorized:example.com"},
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	roomID := id.RoomID("!room:example.com")

	// 1. Unauthorized event should be dropped
	unauthorizedEvt := &event.Event{
		Type:      event.EventMessage,
		ID:        id.EventID("$evil_event"),
		RoomID:    roomID,
		Sender:    id.UserID("@evil:example.com"),
		Timestamp: time.Now().UnixMilli(),
		Content: event.Content{
			Raw: map[string]interface{}{
				"body": "Attack payload",
			},
		},
	}

	c.Syncer().Dispatch(context.Background(), unauthorizedEvt)

	// Verify unauthorized event is NOT in incoming queue
	ch, cleanup := c.IncomingQueue().Register(roomID, "")
	defer cleanup()

	select {
	case <-ch:
		t.Fatal("unauthorized event should not be in queue")
	case <-time.After(50 * time.Millisecond):
		// Expected
	}

	// 2. Deduplication check: dispatch same event ID twice
	authEvt := &event.Event{
		Type:      event.EventMessage,
		ID:        id.EventID("$duplicate_event_1"),
		RoomID:    roomID,
		Sender:    id.UserID("@authorized:example.com"),
		Timestamp: time.Now().UnixMilli(),
		Content: event.Content{
			Raw: map[string]interface{}{
				"body": "First dispatch",
			},
		},
	}

	// First dispatch matches registered waiter
	c.Syncer().Dispatch(context.Background(), authEvt)

	select {
	case msg := <-ch:
		if msg.EventID != "$duplicate_event_1" {
			t.Errorf("expected $duplicate_event_1, got %s", msg.EventID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timed out waiting for authorized message")
	}

	// Register another waiter
	ch2, cleanup2 := c.IncomingQueue().Register(roomID, "")
	defer cleanup2()

	// Dispatch same event ID again
	c.Syncer().Dispatch(context.Background(), authEvt)

	select {
	case <-ch2:
		t.Fatal("duplicate event ID should have been discarded by deduplication!")
	case <-time.After(100 * time.Millisecond):
		// Expected: deduplicated and ignored
	}
}
