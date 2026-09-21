package mcp

import (
	"context"
	"io"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

// RoomSummary represents metadata for a joined Matrix room.
type RoomSummary struct {
	RoomID      string `json:"room_id"`
	Name        string `json:"name,omitempty"`
	Topic       string `json:"topic,omitempty"`
	MemberCount int    `json:"member_count,omitempty"`
}

// MatrixOperations defines the Matrix actions required by MCP tools.
// This interface decouples MCP handlers from the concrete Matrix client for easy testing and mocking.
type MatrixOperations interface {
	SendMessage(ctx context.Context, roomID id.RoomID, plainText, formattedHTML string, threadID id.EventID) (*mautrix.RespSendEvent, error)
	SendReaction(ctx context.Context, roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error)
	UploadMedia(ctx context.Context, content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error)
	ListJoinedRooms(ctx context.Context) ([]RoomSummary, error)
}

// Ensure client.Client can provide MatrixOperations
