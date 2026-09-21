package mcp_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	mcpinternal "github.com/amadeus/matrix-mcp-go/internal/mcp"
	"github.com/mark3labs/mcp-go/mcp"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

// hitlMockOperations manages simulated human replies and typing notifications.
type hitlMockOperations struct {
	mu           sync.Mutex
	lastQuestion string
	lastThread   id.EventID
	waiterActive chan struct{}
	replyToSend  *mcpinternal.HumanReply
	replyDelay   time.Duration
	failReply    error
	typingCalls  int
}

func (h *hitlMockOperations) SendMessage(ctx context.Context, roomID id.RoomID, plainText, formattedHTML string, threadID id.EventID) (*mautrix.RespSendEvent, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastQuestion = plainText
	h.lastThread = threadID
	return &mautrix.RespSendEvent{EventID: id.EventID("$question_event_1")}, nil
}

func (h *hitlMockOperations) SendReaction(ctx context.Context, roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error) {
	return &mautrix.RespSendEvent{EventID: id.EventID("$react_1")}, nil
}

func (h *hitlMockOperations) UploadMedia(ctx context.Context, content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error) {
	return &mautrix.RespMediaUpload{ContentURI: id.MustParseContentURI("mxc://example.com/mock")}, nil
}

func (h *hitlMockOperations) ListJoinedRooms(ctx context.Context) ([]mcpinternal.RoomSummary, error) {
	return []mcpinternal.RoomSummary{{RoomID: "!room:example.com"}}, nil
}

func (h *hitlMockOperations) SetTyping(ctx context.Context, roomID id.RoomID, typing bool, timeout time.Duration) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if typing {
		h.typingCalls++
	}
	return nil
}

func (h *hitlMockOperations) WaitForHumanReply(ctx context.Context, roomID id.RoomID, threadID id.EventID, timeout time.Duration) (*mcpinternal.HumanReply, error) {
	if h.failReply != nil {
		return nil, h.failReply
	}

	if h.waiterActive != nil {
		close(h.waiterActive)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(h.replyDelay):
		if h.replyToSend != nil {
			return h.replyToSend, nil
		}
		return nil, errors.New("timeout waiting for human reply")
	}
}

func TestTool_AskHuman_Success(t *testing.T) {
	mockOps := &hitlMockOperations{
		waiterActive: make(chan struct{}),
		replyDelay:   50 * time.Millisecond,
		replyToSend: &mcpinternal.HumanReply{
			EventID:   "$answer_event_99",
			Sender:    "@alice:example.com",
			RoomID:    "!room:example.com",
			ThreadID:  "$question_event_1",
			Body:      "Yes, proceed with deployment.",
			Timestamp: time.Now().UnixMilli(),
		},
	}

	cfg := config.MCPConfig{
		ServerName:    "hitl-test",
		ServerVersion: "0.1.0",
		Transport:     "stdio",
	}
	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	sMCP := mcpinternal.NewServer(cfg, mockOps, log)

	tool := sMCP.MCPServer().GetTool("matrix_ask_human")
	if tool == nil {
		t.Fatal("tool matrix_ask_human not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_ask_human",
			Arguments: map[string]interface{}{
				"room_id":         "!room:example.com",
				"question":        "Should we deploy to production?",
				"timeout_seconds": 5,
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

	if output["answer"] != "Yes, proceed with deployment." {
		t.Errorf("expected answer 'Yes, proceed with deployment.', got %v", output["answer"])
	}
	if output["sender"] != "@alice:example.com" {
		t.Errorf("expected sender '@alice:example.com', got %v", output["sender"])
	}
}

func TestTool_AskHuman_Timeout(t *testing.T) {
	mockOps := &hitlMockOperations{
		replyDelay: 100 * time.Millisecond,
	}

	cfg := config.MCPConfig{
		ServerName:    "hitl-test",
		ServerVersion: "0.1.0",
		Transport:     "stdio",
	}
	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	sMCP := mcpinternal.NewServer(cfg, mockOps, log)
	tool := sMCP.MCPServer().GetTool("matrix_ask_human")

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_ask_human",
			Arguments: map[string]interface{}{
				"room_id":         "!room:example.com",
				"question":        "Do you approve?",
				"timeout_seconds": 1,
			},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}

	if !res.IsError {
		t.Fatalf("expected error result on timeout, got success")
	}

	errText := extractResultText(t, res)
	if !strings.Contains(errText, "timeout") {
		t.Errorf("expected timeout message in error, got: %s", errText)
	}
}
