package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/format"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"maunium.net/go/mautrix/id"
)

// Server encapsulates the MCP server instance and registered Matrix tools.
type Server struct {
	mcpServer *server.MCPServer
	matrixOps MatrixOperations
	log       *slog.Logger
	cfg       config.MCPConfig
}

// NewServer initializes a new MCP server with Matrix tools and resources.
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

	s := &Server{
		mcpServer: server.NewMCPServer(name, ver,
			server.WithToolCapabilities(true),
			server.WithResourceCapabilities(true, true),
			server.WithLogging(),
		),
		matrixOps: matrixOps,
		log:       log.With("component", "mcp_server"),
		cfg:       cfg,
	}

	s.registerTools()
	s.registerResources()

	return s
}

// MCPServer returns the underlying *server.MCPServer.
func (s *Server) MCPServer() *server.MCPServer {
	return s.mcpServer
}

// ServeStdio starts serving MCP requests over standard I/O.
// NOTE: When this runs, nothing else must write to os.Stdout to preserve JSON-RPC protocol framing.
func (s *Server) ServeStdio() error {
	s.log.Info("serving MCP over stdio transport")
	return server.ServeStdio(s.mcpServer)
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
		s.handleSendMessage,
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
		s.handleSendReaction,
	)

	// Tool 3: matrix_upload_media
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_upload_media",
			mcp.WithDescription("Upload a local file to the Matrix media repository and return its mxc:// URI."),
			mcp.WithString("file_path", mcp.Required(), mcp.Description("Absolute or relative local file path to upload")),
		),
		s.handleUploadMedia,
	)

	// Tool 4: matrix_list_rooms
	s.mcpServer.AddTool(
		mcp.NewTool(
			"matrix_list_rooms",
			mcp.WithDescription("List all joined Matrix rooms with metadata such as name, topic, and member count."),
		),
		s.handleListRooms,
	)
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

	// Format Markdown and BiDi HTML
	plainText, formattedHTML, err := format.FormatMessage(msgStr)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to format markdown message: %v", err)), nil
	}

	resp, err := s.matrixOps.SendMessage(ctx, id.RoomID(roomIDStr), plainText, formattedHTML, id.EventID(threadIDStr))
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to send matrix message: %v", err)), nil
	}

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

	// Sniff content type from first 512 bytes
	header := make([]byte, 512)
	n, _ := f.Read(header)
	contentType := http.DetectContentType(header[:n])
	_, _ = f.Seek(0, 0) // rewind

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
