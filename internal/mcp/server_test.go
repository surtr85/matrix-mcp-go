package mcp_test

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	mcpinternal "github.com/amadeus/matrix-mcp-go/internal/mcp"
	"github.com/mark3labs/mcp-go/mcp"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

// mockMatrixOps implements mcpinternal.MatrixOperations for testing.
type mockMatrixOps struct {
	sentMessage   func(roomID id.RoomID, plain, html string, threadID id.EventID) (*mautrix.RespSendEvent, error)
	sentReaction  func(roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error)
	uploadedMedia func(content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error)
	listedRooms   func() ([]mcpinternal.RoomSummary, error)
}

func (m *mockMatrixOps) SendMessage(ctx context.Context, roomID id.RoomID, plainText, formattedHTML string, threadID id.EventID) (*mautrix.RespSendEvent, error) {
	if m.sentMessage != nil {
		return m.sentMessage(roomID, plainText, formattedHTML, threadID)
	}
	return &mautrix.RespSendEvent{EventID: id.EventID("$event_mock")}, nil
}

func (m *mockMatrixOps) SendReaction(ctx context.Context, roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error) {
	if m.sentReaction != nil {
		return m.sentReaction(roomID, eventID, emoji)
	}
	return &mautrix.RespSendEvent{EventID: id.EventID("$reaction_mock")}, nil
}

func (m *mockMatrixOps) UploadMedia(ctx context.Context, content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error) {
	if m.uploadedMedia != nil {
		return m.uploadedMedia(content, filename, contentType)
	}
	return &mautrix.RespMediaUpload{ContentURI: id.MustParseContentURI("mxc://example.com/mock_media")}, nil
}

func (m *mockMatrixOps) ListJoinedRooms(ctx context.Context) ([]mcpinternal.RoomSummary, error) {
	if m.listedRooms != nil {
		return m.listedRooms()
	}
	return []mcpinternal.RoomSummary{
		{RoomID: "!room1:example.com", Name: "Room 1", MemberCount: 5},
	}, nil
}

func setupTestServer(t *testing.T, ops *mockMatrixOps) *mcpinternal.Server {
	t.Helper()
	cfg := config.MCPConfig{
		ServerName:    "test-server",
		ServerVersion: "0.1.0",
		Transport:     "stdio",
	}
	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	return mcpinternal.NewServer(cfg, ops, log)
}

func extractResultText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	if len(res.Content) == 0 {
		t.Fatal("expected tool result content, got empty slice")
	}
	textResult, ok := res.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", res.Content[0])
	}
	return textResult.Text
}

func TestTool_SendMessage(t *testing.T) {
	var capturedRoom id.RoomID
	var capturedPlain, capturedHTML string
	var capturedThread id.EventID

	ops := &mockMatrixOps{
		sentMessage: func(roomID id.RoomID, plain, html string, threadID id.EventID) (*mautrix.RespSendEvent, error) {
			capturedRoom = roomID
			capturedPlain = plain
			capturedHTML = html
			capturedThread = threadID
			return &mautrix.RespSendEvent{EventID: id.EventID("$new_event_123")}, nil
		},
	}

	s := setupTestServer(t, ops)
	tool := s.MCPServer().GetTool("matrix_send_message")
	if tool == nil {
		t.Fatal("tool matrix_send_message not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_send_message",
			Arguments: map[string]interface{}{
				"room_id":   "!general:example.com",
				"message":   "# سلام\nاین یک پیام تستی با `کد` است.",
				"thread_id": "$thread_root_456",
			},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil {
		t.Fatalf("unexpected call error: %v", err)
	}

	if res.IsError {
		t.Fatalf("call tool returned error: %v", extractResultText(t, res))
	}

	if capturedRoom != "!general:example.com" {
		t.Errorf("expected room '!general:example.com', got %q", capturedRoom)
	}
	if capturedThread != "$thread_root_456" {
		t.Errorf("expected thread '$thread_root_456', got %q", capturedThread)
	}
	if capturedPlain == "" || capturedHTML == "" {
		t.Errorf("expected formatted plaintext and html, got plain=%q html=%q", capturedPlain, capturedHTML)
	}

	// Verify JSON result contains event_id
	text := extractResultText(t, res)
	var output map[string]interface{}
	if err := json.Unmarshal([]byte(text), &output); err != nil {
		t.Fatalf("failed to parse output JSON: %v", err)
	}
	if output["event_id"] != "$new_event_123" {
		t.Errorf("expected event_id '$new_event_123', got %v", output["event_id"])
	}
}

func TestTool_SendReaction(t *testing.T) {
	var capturedEmoji string
	ops := &mockMatrixOps{
		sentReaction: func(roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error) {
			capturedEmoji = emoji
			return &mautrix.RespSendEvent{EventID: id.EventID("$reaction_event")}, nil
		},
	}

	s := setupTestServer(t, ops)
	tool := s.MCPServer().GetTool("matrix_send_reaction")
	if tool == nil {
		t.Fatal("tool matrix_send_reaction not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_send_reaction",
			Arguments: map[string]interface{}{
				"room_id":  "!room:example.com",
				"event_id": "$target_event",
				"emoji":    "🚀",
			},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil || res.IsError {
		t.Fatalf("unexpected call error: %v (isError: %v)", err, res.IsError)
	}

	if capturedEmoji != "🚀" {
		t.Errorf("expected emoji '🚀', got %q", capturedEmoji)
	}
}

func TestTool_UploadMedia(t *testing.T) {
	tmpDir := t.TempDir()
	testFilePath := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFilePath, []byte("matrix media content test"), 0600); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	var capturedFilename, capturedContentType string
	ops := &mockMatrixOps{
		uploadedMedia: func(content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error) {
			capturedFilename = filename
			capturedContentType = contentType
			return &mautrix.RespMediaUpload{ContentURI: id.MustParseContentURI("mxc://example.com/uploaded_123")}, nil
		},
	}

	s := setupTestServer(t, ops)
	tool := s.MCPServer().GetTool("matrix_upload_media")
	if tool == nil {
		t.Fatal("tool matrix_upload_media not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_upload_media",
			Arguments: map[string]interface{}{
				"file_path": testFilePath,
			},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil || res.IsError {
		t.Fatalf("unexpected call error: %v (isError: %v)", err, res.IsError)
	}

	if capturedFilename != "test.txt" {
		t.Errorf("expected filename 'test.txt', got %q", capturedFilename)
	}
	if capturedContentType == "" {
		t.Errorf("expected detected content type, got empty string")
	}

	text := extractResultText(t, res)
	var output map[string]interface{}
	_ = json.Unmarshal([]byte(text), &output)
	if output["content_uri"] != "mxc://example.com/uploaded_123" {
		t.Errorf("expected mxc URI 'mxc://example.com/uploaded_123', got %v", output["content_uri"])
	}
}

func TestTool_ListRoomsAndResource(t *testing.T) {
	ops := &mockMatrixOps{
		listedRooms: func() ([]mcpinternal.RoomSummary, error) {
			return []mcpinternal.RoomSummary{
				{RoomID: "!roomA:example.com", Name: "Alpha", MemberCount: 10},
				{RoomID: "!roomB:example.com", Name: "Beta", MemberCount: 2},
			}, nil
		},
	}

	s := setupTestServer(t, ops)

	// Test Tool matrix_list_rooms
	tool := s.MCPServer().GetTool("matrix_list_rooms")
	if tool == nil {
		t.Fatal("tool matrix_list_rooms not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name:      "matrix_list_rooms",
			Arguments: map[string]interface{}{},
		},
	}

	res, err := tool.Handler(context.Background(), callReq)
	if err != nil || res.IsError {
		t.Fatalf("unexpected tool call error: %v (isError: %v)", err, res.IsError)
	}

	text := extractResultText(t, res)
	var toolOut map[string]interface{}
	_ = json.Unmarshal([]byte(text), &toolOut)
	if toolOut["total"] != float64(2) {
		t.Errorf("expected total 2 rooms, got %v", toolOut["total"])
	}

	// Test Resource matrix://rooms/joined
	resources := s.MCPServer().ListResources()
	r, exists := resources["matrix://rooms/joined"]
	if !exists {
		t.Fatal("resource matrix://rooms/joined not registered")
	}

	readReq := mcp.ReadResourceRequest{
		Params: mcp.ReadResourceParams{
			URI: "matrix://rooms/joined",
		},
	}

	resourceContents, err := r.Handler(context.Background(), readReq)
	if err != nil {
		t.Fatalf("failed to read resource: %v", err)
	}

	if len(resourceContents) == 0 {
		t.Fatal("expected resource contents, got empty")
	}
	textContent, ok := resourceContents[0].(mcp.TextResourceContents)
	if !ok {
		t.Fatalf("expected TextResourceContents, got %T", resourceContents[0])
	}

	var resRooms []mcpinternal.RoomSummary
	if err := json.Unmarshal([]byte(textContent.Text), &resRooms); err != nil {
		t.Fatalf("failed to unmarshal resource JSON: %v", err)
	}
	if len(resRooms) != 2 || resRooms[0].Name != "Alpha" {
		t.Errorf("expected 2 rooms with Alpha first, got: %+v", resRooms)
	}
}

func TestJSONRPC_ProtocolInitialization(t *testing.T) {
	ops := &mockMatrixOps{}
	s := setupTestServer(t, ops)

	// Send JSON-RPC initialize request
	initReq := []byte(`{
		"jsonrpc": "2.0",
		"id": 1,
		"method": "initialize",
		"params": {
			"protocolVersion": "2024-11-05",
			"capabilities": {},
			"clientInfo": {
				"name": "test-client",
				"version": "1.0.0"
			}
		}
	}`)

	resp := s.MCPServer().HandleMessage(context.Background(), initReq)
	if resp == nil {
		t.Fatal("expected non-nil response to initialize request")
	}

	respBytes, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal response: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		t.Fatalf("failed to parse JSON-RPC response: %v", err)
	}

	if parsed["error"] != nil {
		t.Fatalf("initialize returned error: %v", parsed["error"])
	}

	result, ok := parsed["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected result object in response, got: %v", parsed)
	}

	serverInfo, ok := result["serverInfo"].(map[string]interface{})
	if !ok || serverInfo["name"] != "test-server" {
		t.Errorf("expected server name 'test-server', got: %v", serverInfo)
	}
}
