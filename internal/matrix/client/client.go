package client

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/rbac"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/store"
	"github.com/amadeus/matrix-mcp-go/internal/mcp"
	"github.com/amadeus/matrix-mcp-go/internal/metrics"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/cryptohelper"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// MessageHandler is invoked when an m.room.message event is received and processed.
type MessageHandler func(ctx context.Context, evt *event.Event)

// Client wraps the mautrix.Client with resilient syncing, crypto support, and message dispatching.
type Client struct {
	cfg           config.MatrixConfig
	matrixCli     *mautrix.Client
	store         *store.Store
	cryptoHelper  *cryptohelper.CryptoHelper
	syncer        *mautrix.DefaultSyncer
	msgHandlers   []MessageHandler
	replyRegistry *ReplyRegistry
	authorizer    *rbac.Authorizer
	log           *slog.Logger
}

// New creates and initializes a Client with SQLite persistence, RBAC, and human-in-the-loop reply routing.
func New(cfg config.MatrixConfig, log *slog.Logger) (*Client, error) {
	if log == nil {
		log = slog.Default()
	}

	st, err := store.New(cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize sqlite store: %w", err)
	}

	userID := id.UserID(cfg.UserID)
	cli, err := mautrix.NewClient(cfg.HomeserverURL, userID, cfg.AccessToken)
	if err != nil {
		_ = st.Close()
		return nil, fmt.Errorf("failed to create mautrix client: %w", err)
	}

	// Attach sync store
	cli.Store = st

	syncer := mautrix.NewDefaultSyncer()
	cli.Syncer = syncer

	c := &Client{
		cfg:           cfg,
		matrixCli:     cli,
		store:         st,
		syncer:        syncer,
		msgHandlers:   make([]MessageHandler, 0),
		replyRegistry: NewReplyRegistry(),
		authorizer:    rbac.New(cfg.AllowedUsers),
		log:           log.With("component", "matrix_client"),
	}

	// Register internal message dispatcher on syncer
	syncer.OnEventType(event.EventMessage, func(ctx context.Context, evt *event.Event) {
		c.dispatchIncomingEvent(ctx, evt)
	})

	return c, nil
}

func (c *Client) dispatchIncomingEvent(ctx context.Context, evt *event.Event) {
	// Ignore events from the bot itself
	if evt.Sender == c.matrixCli.UserID {
		return
	}

	// Track metrics
	metrics.RecordSyncEvent(evt.Type.Type)

	// Security & RBAC: verify sender
	if !c.authorizer.IsAllowed(evt.Sender) {
		c.log.Debug("discarding event from unauthorized sender",
			"sender", evt.Sender,
			"room_id", evt.RoomID,
			"event_id", evt.ID,
		)
		return
	}

	// Check if this event satisfies a pending human-in-the-loop reply
	var threadID id.EventID
	var body string

	// Parse raw content into typed structure if not parsed yet
	if evt.Content.Parsed == nil && evt.Content.Raw != nil {
		_ = evt.Content.ParseRaw(evt.Type)
	}

	// Extract relates_to thread info if present
	if relatesTo := evt.Content.AsMessage().RelatesTo; relatesTo != nil {
		if relatesTo.Type == event.RelThread {
			threadID = relatesTo.EventID
		} else if relatesTo.InReplyTo != nil {
			threadID = relatesTo.InReplyTo.EventID
		}
	} else if relRaw, ok := evt.Content.Raw["m.relates_to"].(map[string]interface{}); ok {
		if evID, ok := relRaw["event_id"].(string); ok {
			threadID = id.EventID(evID)
		}
	}

	if msg := evt.Content.AsMessage(); msg != nil {
		body = msg.Body
	}
	if body == "" {
		if rawBody, ok := evt.Content.Raw["body"].(string); ok {
			body = rawBody
		}
	}

	reply := &mcp.HumanReply{
		EventID:   string(evt.ID),
		Sender:    string(evt.Sender),
		RoomID:    string(evt.RoomID),
		ThreadID:  string(threadID),
		Body:      body,
		Timestamp: evt.Timestamp,
	}

	// If a waiter claims this reply, dispatch it
	if c.replyRegistry.Dispatch(evt.RoomID, threadID, reply) {
		c.log.Info("routed human reply to active HITL waiter",
			"room_id", evt.RoomID,
			"thread_id", threadID,
			"sender", evt.Sender,
		)
	}

	// Also invoke generic message listeners
	c.dispatchMessage(ctx, evt)
}

// InitCrypto initializes the Olm/Megolm E2EE CryptoHelper if a pickle key or DB path is configured.
func (c *Client) InitCrypto(ctx context.Context) error {
	if c.matrixCli.DeviceID == "" {
		return errors.New("cannot initialize crypto without a valid device_id")
	}

	pickleKey := []byte(c.cfg.PickleKey)
	if len(pickleKey) == 0 {
		// Default development pickle key if not set
		pickleKey = []byte("matrix-mcp-go-default-pickle-key")
	}

	helper, err := cryptohelper.NewCryptoHelper(c.matrixCli, pickleKey, c.cfg.DBPath)
	if err != nil {
		return fmt.Errorf("failed to create crypto helper: %w", err)
	}

	helper.DBAccountID = string(c.matrixCli.UserID)
	if err := helper.Init(ctx); err != nil {
		return fmt.Errorf("failed to initialize crypto helper: %w", err)
	}

	c.cryptoHelper = helper
	c.matrixCli.Crypto = helper
	c.log.Info("E2EE crypto initialized successfully", "user_id", c.matrixCli.UserID, "device_id", c.matrixCli.DeviceID)
	return nil
}

// Login authenticates with the Matrix homeserver using access_token or password.
func (c *Client) Login(ctx context.Context) error {
	userID := c.matrixCli.UserID

	// Check if we have stored credentials from previous session
	savedDeviceID, savedToken, err := c.store.LoadDeviceCredentials(ctx, userID)
	if err != nil {
		c.log.Warn("failed to load saved device credentials from store", "err", err)
	}

	if savedToken != "" && savedDeviceID != "" {
		c.matrixCli.DeviceID = savedDeviceID
		c.matrixCli.AccessToken = savedToken
		c.log.Info("restored Matrix session from store", "user_id", userID, "device_id", savedDeviceID)
		return nil
	}

	// If access token is provided directly in configuration
	if c.cfg.AccessToken != "" {
		c.matrixCli.AccessToken = c.cfg.AccessToken
		if c.cfg.DeviceID != "" {
			c.matrixCli.DeviceID = id.DeviceID(c.cfg.DeviceID)
		}

		// Persist credentials
		if c.matrixCli.DeviceID != "" {
			_ = c.store.SaveDeviceCredentials(ctx, userID, c.matrixCli.DeviceID, c.matrixCli.AccessToken)
		}
		c.log.Info("authenticated with config access token", "user_id", userID, "device_id", c.matrixCli.DeviceID)
		return nil
	}

	// Password login fallback
	if c.cfg.Password != "" {
		req := &mautrix.ReqLogin{
			Type: mautrix.AuthTypePassword,
			Identifier: mautrix.UserIdentifier{
				Type: mautrix.IdentifierTypeUser,
				User: string(userID),
			},
			Password:                 c.cfg.Password,
			InitialDeviceDisplayName: "Matrix MCP Gateway (Go)",
		}
		if c.cfg.DeviceID != "" {
			req.DeviceID = id.DeviceID(c.cfg.DeviceID)
		}

		resp, err := c.matrixCli.Login(ctx, req)
		if err != nil {
			return fmt.Errorf("password login failed: %w", err)
		}

		c.matrixCli.AccessToken = resp.AccessToken
		c.matrixCli.DeviceID = resp.DeviceID

		// Persist new device ID and access token
		if err := c.store.SaveDeviceCredentials(ctx, userID, resp.DeviceID, resp.AccessToken); err != nil {
			c.log.Warn("failed to persist new login credentials", "err", err)
		}

		c.log.Info("password login succeeded", "user_id", userID, "device_id", resp.DeviceID)
		return nil
	}

	return errors.New("neither access_token nor password provided for authentication")
}

// OnMessage registers a callback handler for incoming m.room.message events.
func (c *Client) OnMessage(handler MessageHandler) {
	if handler != nil {
		c.msgHandlers = append(c.msgHandlers, handler)
	}
}

func (c *Client) dispatchMessage(ctx context.Context, evt *event.Event) {
	for _, h := range c.msgHandlers {
		h(ctx, evt)
	}
}

// SetTyping sets the user typing status in the specified room.
func (c *Client) SetTyping(ctx context.Context, roomID id.RoomID, typing bool, timeout time.Duration) error {
	_, err := c.matrixCli.UserTyping(ctx, roomID, typing, timeout)
	return err
}

// WaitForHumanReply registers a reply waiter and blocks until a response is received, timeout occurs, or ctx is cancelled.
func (c *Client) WaitForHumanReply(ctx context.Context, roomID id.RoomID, threadID id.EventID, timeout time.Duration) (*mcp.HumanReply, error) {
	replyCh, cleanup := c.replyRegistry.Register(roomID, threadID)
	defer cleanup()

	// Maintain typing indicator while waiting in background
	typingTicker := time.NewTicker(4 * time.Second)
	defer typingTicker.Stop()

	// Initial typing notification
	_ = c.SetTyping(ctx, roomID, true, 5*time.Second)

	timeoutTimer := time.NewTimer(timeout)
	defer timeoutTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = c.SetTyping(context.Background(), roomID, false, 0)
			return nil, ctx.Err()

		case <-timeoutTimer.C:
			_ = c.SetTyping(context.Background(), roomID, false, 0)
			return nil, errors.New("timeout waiting for human reply")

		case <-typingTicker.C:
			// Refresh typing indicator so Matrix clients show the bot is active
			_ = c.SetTyping(ctx, roomID, true, 5*time.Second)

		case reply := <-replyCh:
			// Stop typing indicator on reply receipt
			_ = c.SetTyping(context.Background(), roomID, false, 0)
			return reply, nil
		}
	}
}

// SyncLoop runs the Matrix sync loop with exponential backoff and 429 rate limit handling.
func (c *Client) SyncLoop(ctx context.Context) error {
	c.log.Info("starting Matrix sync loop", "user_id", c.matrixCli.UserID)

	backoff := 1 * time.Second
	const maxBackoff = 60 * time.Second

	for {
		select {
		case <-ctx.Done():
			c.log.Info("matrix sync loop terminated by context")
			return ctx.Err()
		default:
		}

		err := c.matrixCli.SyncWithContext(ctx)
		if err == nil {
			backoff = 1 * time.Second
			continue
		}

		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			c.log.Info("sync loop context cancelled")
			return err
		}

		// Check for Matrix API rate limiting
		var httpErr mautrix.HTTPError
		if errors.As(err, &httpErr) {
			if httpErr.RespError != nil && httpErr.RespError.ErrCode == "M_LIMIT_EXCEEDED" {
				retryAfter := backoff
				if retryMsVal, ok := httpErr.RespError.ExtraData["retry_after_ms"]; ok {
					if retryMs, ok := retryMsVal.(float64); ok && retryMs > 0 {
						retryAfter = time.Duration(retryMs) * time.Millisecond
					}
				}
				c.log.Warn("Matrix rate limit exceeded (M_LIMIT_EXCEEDED)",
					"retry_after", retryAfter,
					"err", err,
				)
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(retryAfter):
					continue
				}
			}
			if httpErr.Response != nil && httpErr.Response.StatusCode == http.StatusTooManyRequests {
				c.log.Warn("HTTP 429 received, backing off", "backoff", backoff)
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(backoff):
					backoff = min(backoff*2, maxBackoff)
					continue
				}
			}
		}

		c.log.Error("sync failed, backing off", "err", err, "backoff", backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
			backoff = min(backoff*2, maxBackoff)
		}
	}
}

// Close closes all stores and crypto helpers gracefully.
func (c *Client) Close() error {
	var errs []error
	c.matrixCli.StopSync()

	if c.cryptoHelper != nil {
		if err := c.cryptoHelper.Close(); err != nil {
			errs = append(errs, fmt.Errorf("crypto helper close failed: %w", err))
		}
	}

	if c.store != nil {
		if err := c.store.Close(); err != nil {
			errs = append(errs, fmt.Errorf("store close failed: %w", err))
		}
	}

	return errors.Join(errs...)
}

// UnderlyingClient returns the raw mautrix.Client for advanced or test usage.
func (c *Client) UnderlyingClient() *mautrix.Client {
	return c.matrixCli
}

// ReplyRegistry returns the Client's internal reply registry for tests.
func (c *Client) ReplyRegistry() *ReplyRegistry {
	return c.replyRegistry
}

// Syncer returns the underlying *mautrix.DefaultSyncer.
func (c *Client) Syncer() *mautrix.DefaultSyncer {
	return c.syncer
}
