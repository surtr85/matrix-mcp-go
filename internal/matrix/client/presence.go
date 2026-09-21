package client

import (
	"context"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
)

// SetOffline sends an offline presence update to the homeserver during graceful shutdown.
func (c *Client) SetOffline(ctx context.Context) error {
	return c.matrixCli.SetPresence(ctx, mautrix.ReqPresence{
		Presence: event.PresenceOffline,
	})
}
