package client_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

func TestClient_ReplyRoutingAndRBAC(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "rbac_test.db")

	cfg := config.MatrixConfig{
		HomeserverURL: "http://localhost:8008",
		UserID:        "@bot:example.com",
		AccessToken:   "test_token",
		DeviceID:      "DEV_TEST",
		DBPath:        dbPath,
		AllowedUsers:  []string{"@alice:example.com"}, // only alice is allowed!
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	roomID := id.RoomID("!room:example.com")
	threadID := id.EventID("$question_root")

	replyCh, cleanup := c.ReplyRegistry().Register(roomID, threadID)
	defer cleanup()

	// 1. Unauthorized user tries to reply -> must NOT be dispatched
	unauthorizedEvt := &event.Event{
		Type:      event.EventMessage,
		ID:        id.EventID("$msg_attacker"),
		RoomID:    roomID,
		Sender:    id.UserID("@evil_user:example.com"),
		Timestamp: time.Now().UnixMilli(),
		Content: event.Content{
			Raw: map[string]interface{}{
				"body": "Malicious override payload",
				"m.relates_to": map[string]interface{}{
					"rel_type": "m.thread",
					"event_id": string(threadID),
				},
			},
		},
	}

	// Dispatch simulated sync event via syncer
	c.Syncer().Dispatch(ctx, unauthorizedEvt)

	// Wait briefly to ensure unauthorized message was ignored
	select {
	case <-replyCh:
		t.Fatal("unauthorized user reply should NOT have been dispatched!")
	case <-time.After(100 * time.Millisecond):
		// Expected: no dispatch
	}

	// 2. Authorized user replies -> MUST be received by waiter
	authorizedEvt := &event.Event{
		Type:      event.EventMessage,
		ID:        id.EventID("$msg_alice"),
		RoomID:    roomID,
		Sender:    id.UserID("@alice:example.com"),
		Timestamp: time.Now().UnixMilli(),
		Content: event.Content{
			Raw: map[string]interface{}{
				"body": "I approve the release.",
				"m.relates_to": map[string]interface{}{
					"rel_type": "m.thread",
					"event_id": string(threadID),
				},
			},
		},
	}

	c.Syncer().Dispatch(ctx, authorizedEvt)

	select {
	case reply := <-replyCh:
		if reply.Body != "I approve the release." {
			t.Errorf("expected body 'I approve the release.', got %q", reply.Body)
		}
		if reply.Sender != "@alice:example.com" {
			t.Errorf("expected sender '@alice:example.com', got %q", reply.Sender)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for authorized user reply to be routed")
	}
}
