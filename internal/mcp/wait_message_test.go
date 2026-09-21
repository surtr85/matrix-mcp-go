package mcp_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	mcpinternal "github.com/amadeus/matrix-mcp-go/internal/mcp"
	"github.com/mark3labs/mcp-go/mcp"
	"maunium.net/go/mautrix/id"
)

func TestTool_WaitMessage_Success(t *testing.T) {
	mockOps := &mockMatrixOps{
		waitIncoming: func(ctx context.Context, roomID id.RoomID, threadID id.EventID, timeout time.Duration) (*mcpinternal.IncomingMessage, error) {
			if roomID != "!room:example.com" {
				t.Errorf("expected roomID !room:example.com, got %s", roomID)
			}
			if threadID != "$thread_1" {
				t.Errorf("expected threadID $thread_1, got %s", threadID)
			}
			return &mcpinternal.IncomingMessage{
				EventID:   "$event_incoming_123",
				RoomID:    string(roomID),
				ThreadID:  string(threadID),
				Sender:    "@alice:example.com",
				Body:      "Deploy release v1.0.0",
				Timestamp: 1726945200000,
			}, nil
		},
	}

	cfg := config.MCPConfig{
		ServerName:    "wait-test",
		ServerVersion: "0.1.0",
		Transport:     "stdio",
	}
	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	sMCP := mcpinternal.NewServer(cfg, mockOps, log)

	tool := sMCP.MCPServer().GetTool("matrix_wait_message")
	if tool == nil {
		t.Fatal("tool matrix_wait_message not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_wait_message",
			Arguments: map[string]interface{}{
				"room_id":         "!room:example.com",
				"thread_id":       "$thread_1",
				"timeout_seconds": 60,
			},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil || res.IsError {
		t.Fatalf("unexpected call error: %v (isError: %v)", err, res.IsError)
	}

	text := extractResultText(t, res)
	var output map[string]interface{}
	if err := json.Unmarshal([]byte(text), &output); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}

	if output["has_message"] != true {
		t.Errorf("expected has_message true, got %v", output["has_message"])
	}
	if output["room_id"] != "!room:example.com" {
		t.Errorf("expected room_id '!room:example.com', got %v", output["room_id"])
	}
	if output["event_id"] != "$event_incoming_123" {
		t.Errorf("expected event_id '$event_incoming_123', got %v", output["event_id"])
	}
	if output["thread_id"] != "$thread_1" {
		t.Errorf("expected thread_id '$thread_1', got %v", output["thread_id"])
	}
	if output["sender"] != "@alice:example.com" {
		t.Errorf("expected sender '@alice:example.com', got %v", output["sender"])
	}
	if output["message"] != "Deploy release v1.0.0" {
		t.Errorf("expected message 'Deploy release v1.0.0', got %v", output["message"])
	}
	if output["timestamp"] != float64(1726945200000) {
		t.Errorf("expected timestamp 1726945200000, got %v", output["timestamp"])
	}
}

func TestTool_WaitMessage_Timeout(t *testing.T) {
	mockOps := &mockMatrixOps{
		waitIncoming: func(ctx context.Context, roomID id.RoomID, threadID id.EventID, timeout time.Duration) (*mcpinternal.IncomingMessage, error) {
			return nil, errors.New("timeout waiting for incoming message")
		},
	}

	cfg := config.MCPConfig{
		ServerName:    "wait-test",
		ServerVersion: "0.1.0",
		Transport:     "stdio",
	}
	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	sMCP := mcpinternal.NewServer(cfg, mockOps, log)
	tool := sMCP.MCPServer().GetTool("matrix_wait_message")

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_wait_message",
			Arguments: map[string]interface{}{
				"timeout_seconds": 10,
			},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if res.IsError {
		t.Fatalf("expected non-error result on timeout, got isError=true")
	}

	text := extractResultText(t, res)
	var output map[string]interface{}
	if err := json.Unmarshal([]byte(text), &output); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}

	if output["has_message"] != false {
		t.Errorf("expected has_message false, got %v", output["has_message"])
	}
	if output["message"] != "No new messages received within timeout window." {
		t.Errorf("unexpected message body: %v", output["message"])
	}
}
