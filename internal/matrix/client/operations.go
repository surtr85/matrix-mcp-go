package client

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/amadeus/matrix-mcp-go/internal/mcp"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// Ensure *Client implements mcp.MatrixOperations.
var _ mcp.MatrixOperations = (*Client)(nil)

// SendMessage sends a formatted message to a room, optionally replying within a thread.
func (c *Client) SendMessage(ctx context.Context, roomID id.RoomID, plainText, formattedHTML string, threadID id.EventID) (*mautrix.RespSendEvent, error) {
	content := &event.MessageEventContent{
		MsgType:       event.MsgText,
		Body:          plainText,
		Format:        event.FormatHTML,
		FormattedBody: formattedHTML,
	}

	if threadID != "" {
		content.RelatesTo = &event.RelatesTo{
			Type:    event.RelThread,
			EventID: threadID,
			// In Matrix MSC3440 / Matrix v1.4, fallback to thread root or latest event
			InReplyTo: &event.InReplyTo{
				EventID: threadID,
			},
		}
	}

	return c.matrixCli.SendMessageEvent(ctx, roomID, event.EventMessage, content)
}

// SendReaction sends an emoji reaction to a specific Matrix event.
func (c *Client) SendReaction(ctx context.Context, roomID id.RoomID, eventID id.EventID, emoji string) (*mautrix.RespSendEvent, error) {
	return c.matrixCli.SendReaction(ctx, roomID, eventID, emoji)
}

// UploadMedia uploads raw media to the Matrix content repository and returns the mxc URI.
func (c *Client) UploadMedia(ctx context.Context, content io.Reader, filename, contentType string) (*mautrix.RespMediaUpload, error) {
	data, err := io.ReadAll(content)
	if err != nil {
		return nil, fmt.Errorf("failed to read media content: %w", err)
	}

	if contentType == "" {
		contentType = http.DetectContentType(data)
	}

	return c.matrixCli.UploadBytesWithName(ctx, data, contentType, filename)
}

// ListJoinedRooms retrieves the list of joined rooms with summaries.
func (c *Client) ListJoinedRooms(ctx context.Context) ([]mcp.RoomSummary, error) {
	resp, err := c.matrixCli.JoinedRooms(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch joined rooms: %w", err)
	}

	summaries := make([]mcp.RoomSummary, 0, len(resp.JoinedRooms))
	for _, rID := range resp.JoinedRooms {
		summary := mcp.RoomSummary{
			RoomID: string(rID),
		}

		// Try to query room summary or state
		roomSummary, err := c.matrixCli.GetRoomSummary(ctx, string(rID))
		if err == nil && roomSummary != nil {
			summary.Name = roomSummary.Name
			summary.Topic = roomSummary.Topic
			summary.MemberCount = roomSummary.NumJoinedMembers
		}

		summaries = append(summaries, summary)
	}

	return summaries, nil
}
