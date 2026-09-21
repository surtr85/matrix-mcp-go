package mcp

import (
	"context"
	"io"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

// HumanReply represents the message captured from a human in Matrix.
type HumanReply struct {
	EventID   string `json:"event_id"`
	Sender    string `json:"sender"`
	RoomID    string `json:"room_id"`
	ThreadID  string `json:"thread_id,omitempty"`
	Body      string `json:"body"`
	Timestamp int64  `json:"timestamp"`
}

// IncomingMessage represents an incoming message delivered to polling agents.
type IncomingMessage struct {
	EventID   string `json:"event_id"`
	RoomID    string `json:"room_id"`
	ThreadID  string `json:"thread_id,omitempty"`
	Sender    string `json:"sender"`
	Body      string `json:"body"`
	Timestamp int64  `json:"timestamp"`
}

// RoomSummary represents metadata for a joined Matrix room.
type RoomSummary struct {
	RoomID      string `json:"room_id"`
	Name        string `json:"name,omitempty"`
	Topic       string `json:"topic,omitempty"`
	MemberCount int    `json:"member_count,omitempty"`
}

// MatrixOperations defines the Matrix actions required by MCP tools.
type MatrixOperations interface {
	SendMessage(ctx context.Context, roomID id.RoomID, plainText, formattedHTML string, threadID id.EventID) (*mautrix.RespSendEvent, error)
	SendReaction(ctx context.Context, roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error)
	UploadMedia(ctx context.Context, content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error)
	ListJoinedRooms(ctx context.Context) ([]RoomSummary, error)
	SetTyping(ctx context.Context, roomID id.RoomID, typing bool, timeout time.Duration) error
	WaitForHumanReply(ctx context.Context, roomID id.RoomID, threadID id.EventID, timeout time.Duration) (*HumanReply, error)
	WaitForIncomingMessage(ctx context.Context, roomID id.RoomID, threadID id.EventID, timeout time.Duration) (*IncomingMessage, error)
}
