package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/format"
	"github.com/amadeus/matrix-mcp-go/internal/metrics"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"maunium.net/go/mautrix/id"
)

// Server encapsulates the MCP server instance and registered Matrix tools.
type Server struct {
	mcpServer  *server.MCPServer
	sseServer  *server.SSEServer
	httpServer *http.Server
	matrixOps  MatrixOperations
	log        *slog.Logger
	cfg        config.MCPConfig
}

// NewServer initializes a new MCP server with Matrix tools, resources, and dual-transport support.
func NewServer(cfg config.MCPConfig, matrixOps MatrixOperations, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}

	name := cfg.ServerName
	if name == "" {
		name = "matrix-mcp-go"
	}
	ver := cfg.ServerVersion
	if ver == "" {
		ver = "0.1.0"
	}

	baseMCPServer := server.NewMCPServer(name, ver,
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(true, true),
		server.WithLogging(),
	)

	s := &Server{
		mcpServer: baseMCPServer,
		matrixOps: matrixOps,
		log:       log.With("component", "mcp_server"),
		cfg:       cfg,
	}

	s.registerTools()
	s.registerResources()

	// Initialize SSE server wrapper
	s.sseServer = server.NewSSEServer(baseMCPServer,
		server.WithSSEEndpoint("/sse"),
		server.WithMessageEndpoint("/message"),
	)

	return s
}

// MCPServer returns the underlying *server.MCPServer.
func (s *Server) MCPServer() *server.MCPServer {
	return s.mcpServer
}

// SSEServer returns the underlying *server.SSEServer.
func (s *Server) SSEServer() *server.SSEServer {
	return s.sseServer
}

// HTTPServerHandler constructs the complete HTTP handler including SSE, metrics, and healthz.
func (s *Server) HTTPServerHandler() http.Handler {
	mux := http.NewServeMux()

	// MCP SSE endpoints
	mux.Handle("/sse", s.sseServer.SSEHandler())
	mux.Handle("/message", s.sseServer.MessageHandler())

	// Health check
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// Prometheus metrics endpoint
	mux.Handle("/metrics", promhttp.Handler())

	return mux
}

// ServeStdio starts serving MCP requests over standard I/O.
func (s *Server) ServeStdio() error {
	s.log.Info("serving MCP over stdio transport")
	return server.ServeStdio(s.mcpServer)
}

// StartHTTP starts serving MCP requests over HTTP/SSE with Prometheus metrics on the configured address.
func (s *Server) StartHTTP(ctx context.Context) error {
	addr := fmt.Sprintf("%s:%d", s.cfg.ListenAddress, s.cfg.HTTPPort)
	s.httpServer = &http.Server{
		Addr:              addr,
		Handler:           s.HTTPServerHandler(),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext: func(net.Listener) context.Context {
			return ctx
		},
	}

	s.log.Info("starting MCP HTTP/SSE server",
		"address", addr,
		"sse_endpoint", "/sse",
		"message_endpoint", "/message",
		"metrics_endpoint", "/metrics",
		"healthz_endpoint", "/healthz",
	)

	errCh := make(chan error, 1)
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		return s.Shutdown(context.Background())
	case err := <-errCh:
		return err
	}
}

// Shutdown gracefully terminates HTTP sessions and listeners.
func (s *Server) Shutdown(ctx context.Context) error {
	s.log.Info("shutting down MCP server")
	if s.sseServer != nil {
		s.sseServer.CloseSessions()
	}
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}

func (s *Server) registerTools() {
	// Tool 1: matrix_send_message
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_send_message",
			mcp.WithDescription("Send a formatted Markdown message to a Matrix room, optionally inside a specific thread."),
			mcp.WithString("room_id", mcp.Required(), mcp.Description("The target Matrix Room ID (e.g. !roomid:example.com)")),
			mcp.WithString("message", mcp.Required(), mcp.Description("The message text in Markdown format (supports Persian/Arabic BiDi and code blocks)")),
			mcp.WithString("thread_id", mcp.Description("Optional Matrix root event ID if replying within a thread")),
		),
		s.instrumentTool("matrix_send_message", s.handleSendMessage),
	)

	// Tool 2: matrix_send_reaction
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_send_reaction",
			mcp.WithDescription("Send an emoji reaction to a specific Matrix event."),
			mcp.WithString("room_id", mcp.Required(), mcp.Description("The Matrix Room ID where the event is located")),
			mcp.WithString("event_id", mcp.Required(), mcp.Description("The Matrix Event ID to react to (e.g. $eventid)")),
			mcp.WithString("emoji", mcp.Required(), mcp.Description("The emoji string for the reaction (e.g. 👍, ❤️, 🚀)")),
		),
		s.instrumentTool("matrix_send_reaction", s.handleSendReaction),
	)

	// Tool 3: matrix_upload_media
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_upload_media",
			mcp.WithDescription("Upload a local file to the Matrix media repository and return its mxc:// URI."),
			mcp.WithString("file_path", mcp.Required(), mcp.Description("Absolute or relative local file path to upload")),
		),
		s.instrumentTool("matrix_upload_media", s.handleUploadMedia),
	)

	// Tool 4: matrix_list_rooms
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_list_rooms",
			mcp.WithDescription("List all joined Matrix rooms with metadata such as name, topic, and member count."),
		),
		s.instrumentTool("matrix_list_rooms", s.handleListRooms),
	)

	// Tool 5: matrix_ask_human (Human-in-the-Loop)
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_ask_human",
			mcp.WithDescription("Ask a human a question in Matrix, pause execution, and wait for their reply in the thread."),
			mcp.WithString("room_id", mcp.Required(), mcp.Description("Target Matrix room ID")),
			mcp.WithString("question", mcp.Required(), mcp.Description("The question or decision prompt in Markdown")),
			mcp.WithString("thread_id", mcp.Description("Optional existing thread ID; if empty, the question creates a new thread root")),
			mcp.WithNumber("timeout_seconds", mcp.Description("Maximum wait time in seconds (default: 300)")),
		),
		s.instrumentTool("matrix_ask_human", s.handleAskHuman),
	)
}

func (s *Server) instrumentTool(toolName string, handler server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		start := time.Now()
		res, err := handler(ctx, req)
		duration := time.Since(start).Seconds()

		isError := (err != nil) || (res != nil && res.IsError)
		metrics.RecordToolCall(toolName, isError, duration)

		return res, err
	}
}

func (s *Server) registerResources() {
	// Resource: matrix://rooms/joined
	s.mcpServer.AddResource(
		mcp.NewResource(
			"matrix://rooms/joined",
			"Active Joined Matrix Rooms",
			mcp.WithResourceDescription("Current list of joined Matrix rooms with metadata"),
			mcp.WithMIMEType("application/json"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			rooms, err := s.matrixOps.ListJoinedRooms(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to retrieve joined rooms resource: %w", err)
			}

			data, err := json.MarshalIndent(rooms, "", "  ")
			if err != nil {
				return nil, fmt.Errorf("failed to encode rooms JSON: %w", err)
			}

			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      "matrix://rooms/joined",
					MIMEType: "application/json",
					Text:     string(data),
				},
			}, nil
		},
	)
}

func (s *Server) handleSendMessage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	roomIDStr, err := req.RequireString("room_id")
	if err != nil {
		return mcp.NewToolResultError("room_id is required"), nil
	}

	msgStr, err := req.RequireString("message")
	if err != nil {
		return mcp.NewToolResultError("message is required"), nil
	}

	threadIDStr := req.GetString("thread_id", "")

	plainText, formattedHTML, err := format.FormatMessage(msgStr)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to format markdown message: %v", err)), nil
	}

	resp, err := s.matrixOps.SendMessage(ctx, id.RoomID(roomIDStr), plainText, formattedHTML, id.EventID(threadIDStr))
	if err != nil {
		metrics.RecordMessageSent(roomIDStr, false)
		return mcp.NewToolResultError(fmt.Sprintf("failed to send matrix message: %v", err)), nil
	}

	metrics.RecordMessageSent(roomIDStr, true)
	res := map[string]interface{}{
		"success":  true,
		"event_id": resp.EventID,
		"room_id":  roomIDStr,
	}
	resJSON, _ := json.Marshal(res)
	return mcp.NewToolResultText(string(resJSON)), nil
}

func (s *Server) handleSendReaction(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	roomIDStr, err := req.RequireString("room_id")
	if err != nil {
		return mcp.NewToolResultError("room_id is required"), nil
	}

	eventIDStr, err := req.RequireString("event_id")
	if err != nil {
		return mcp.NewToolResultError("event_id is required"), nil
	}

	emoji, err := req.RequireString("emoji")
	if err != nil {
		return mcp.NewToolResultError("emoji is required"), nil
	}

	resp, err := s.matrixOps.SendReaction(ctx, id.RoomID(roomIDStr), id.EventID(eventIDStr), emoji)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to send matrix reaction: %v", err)), nil
	}

	res := map[string]interface{}{
		"success":  true,
		"event_id": resp.EventID,
		"room_id":  roomIDStr,
	}
	resJSON, _ := json.Marshal(res)
	return mcp.NewToolResultText(string(resJSON)), nil
}

func (s *Server) handleUploadMedia(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	filePath, err := req.RequireString("file_path")
	if err != nil {
		return mcp.NewToolResultError("file_path is required"), nil
	}

	f, err := os.Open(filePath)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("cannot open file %q: %v", filePath, err)), nil
	}
	defer func() { _ = f.Close() }()

	header := make([]byte, 512)
	n, _ := f.Read(header)
	contentType := http.DetectContentType(header[:n])
	_, _ = f.Seek(0, 0)

	filename := filepath.Base(filePath)
	resp, err := s.matrixOps.UploadMedia(ctx, f, filename, contentType)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to upload media: %v", err)), nil
	}

	res := map[string]interface{}{
		"success":      true,
		"content_uri":  resp.ContentURI,
		"content_type": contentType,
		"filename":     filename,
	}
	resJSON, _ := json.Marshal(res)
	return mcp.NewToolResultText(string(resJSON)), nil
}

func (s *Server) handleListRooms(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	rooms, err := s.matrixOps.ListJoinedRooms(ctx)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to list joined rooms: %v", err)), nil
	}

	resJSON, _ := json.Marshal(map[string]interface{}{
		"rooms": rooms,
		"total": len(rooms),
	})
	return mcp.NewToolResultText(string(resJSON)), nil
}

func (s *Server) handleAskHuman(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	roomIDStr, err := req.RequireString("room_id")
	if err != nil {
		return mcp.NewToolResultError("room_id is required"), nil
	}

	question, err := req.RequireString("question")
	if err != nil {
		return mcp.NewToolResultError("question is required"), nil
	}

	threadIDStr := req.GetString("thread_id", "")
	timeoutSeconds := req.GetInt("timeout_seconds", 300)
	if timeoutSeconds <= 0 {
		timeoutSeconds = 300
	}
	timeoutDur := time.Duration(timeoutSeconds) * time.Second

	plainText, formattedHTML, err := format.FormatMessage(question)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to format question: %v", err)), nil
	}

	resp, err := s.matrixOps.SendMessage(ctx, id.RoomID(roomIDStr), plainText, formattedHTML, id.EventID(threadIDStr))
	if err != nil {
		metrics.RecordMessageSent(roomIDStr, false)
		return mcp.NewToolResultError(fmt.Sprintf("failed to send question to matrix: %v", err)), nil
	}
	metrics.RecordMessageSent(roomIDStr, true)

	activeThreadID := id.EventID(threadIDStr)
	if activeThreadID == "" {
		activeThreadID = resp.EventID
	}

	s.log.Info("waiting for human reply via Matrix",
		"room_id", roomIDStr,
		"thread_id", activeThreadID,
		"timeout_seconds", timeoutSeconds,
	)

	reply, err := s.matrixOps.WaitForHumanReply(ctx, id.RoomID(roomIDStr), activeThreadID, timeoutDur)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("human did not reply within timeout (%v): %v", timeoutDur, err)), nil
	}

	result := map[string]interface{}{
		"success":   true,
		"answer":    reply.Body,
		"sender":    reply.Sender,
		"room_id":   reply.RoomID,
		"thread_id": reply.ThreadID,
		"event_id":  reply.EventID,
		"timestamp": reply.Timestamp,
	}

	resJSON, _ := json.Marshal(result)
	return mcp.NewToolResultText(string(resJSON)), nil
}
