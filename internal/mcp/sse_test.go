package mcp_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	mcpinternal "github.com/amadeus/matrix-mcp-go/internal/mcp"
	"github.com/mark3labs/mcp-go/mcp"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

func TestSSEAndObservabilityEndpoints(t *testing.T) {
	ops := &mockMatrixOps{
		sentMessage: func(roomID id.RoomID, plain, html string, threadID id.EventID) (*mautrix.RespSendEvent, error) {
			return &mautrix.RespSendEvent{EventID: id.EventID("$event_sse")}, nil
		},
	}

	cfg := config.MCPConfig{
		ServerName:    "sse-test-server",
		ServerVersion: "0.1.0",
		Transport:     "sse",
		ListenAddress: "127.0.0.1",
		HTTPPort:      0,
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	s := mcpinternal.NewServer(cfg, ops, log)

	ts := httptest.NewServer(s.HTTPServerHandler())
	defer ts.Close()

	client := ts.Client()

	// 1. Test /healthz
	resp, err := client.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("failed to GET /healthz: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK from /healthz, got %d", resp.StatusCode)
	}

	// 2. Trigger a tool call to generate Prometheus metrics
	tool := s.MCPServer().GetTool("matrix_send_message")
	if tool == nil {
		t.Fatal("tool matrix_send_message not registered")
	}

	callReq := mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name: "matrix_send_message",
			Arguments: map[string]interface{}{
				"room_id": "!test:example.com",
				"message": "Hello from SSE test",
			},
		},
	}
	_, err = tool.Handler(context.Background(), callReq)
	if err != nil {
		t.Fatalf("unexpected tool call error: %v", err)
	}

	// 3. Test /metrics endpoint contains expected Prometheus metric keys
	metricsResp, err := client.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatalf("failed to GET /metrics: %v", err)
	}
	defer func() { _ = metricsResp.Body.Close() }()
	if metricsResp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK from /metrics, got %d", metricsResp.StatusCode)
	}

	metricsBody, err := io.ReadAll(metricsResp.Body)
	if err != nil {
		t.Fatalf("failed to read /metrics body: %v", err)
	}

	metricsStr := string(metricsBody)
	if !strings.Contains(metricsStr, "matrix_mcp_tool_calls_total") {
		t.Errorf("expected 'matrix_mcp_tool_calls_total' in /metrics, got:\n%s", metricsStr)
	}
	if !strings.Contains(metricsStr, "matrix_messages_sent_total") {
		t.Errorf("expected 'matrix_messages_sent_total' in /metrics, got:\n%s", metricsStr)
	}
	if !strings.Contains(metricsStr, "matrix_mcp_tool_duration_seconds") {
		t.Errorf("expected 'matrix_mcp_tool_duration_seconds' in /metrics, got:\n%s", metricsStr)
	}

	// 4. Test SSE endpoint responds with text/event-stream or event stream header
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, ts.URL+"/sse", nil)
	sseResp, err := client.Do(req)
	if err != nil {
		t.Fatalf("failed to connect to /sse: %v", err)
	}
	defer func() { _ = sseResp.Body.Close() }()

	contentType := sseResp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/event-stream") {
		t.Errorf("expected Content-Type 'text/event-stream', got %q", contentType)
	}
}

func TestServer_StartHTTPGracefulShutdown(t *testing.T) {
	ops := &mockMatrixOps{}
	cfg := config.MCPConfig{
		ServerName:    "http-shutdown-test",
		ServerVersion: "0.1.0",
		Transport:     "sse",
		ListenAddress: "127.0.0.1",
		HTTPPort:      19283, // test port
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	s := mcpinternal.NewServer(cfg, ops, log)

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.StartHTTP(ctx)
	}()

	// Wait for server to start listening
	time.Sleep(100 * time.Millisecond)

	// Cancel context to trigger graceful shutdown
	cancel()

	select {
	case err := <-errCh:
		if err != nil && err != context.Canceled && err != http.ErrServerClosed {
			t.Errorf("unexpected error on shutdown: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for HTTP server to shut down")
	}
}
