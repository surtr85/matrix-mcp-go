package client

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/store"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/cryptohelper"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// MessageHandler is invoked when an m.room.message event is received and processed.
type MessageHandler func(ctx context.Context, evt *event.Event)

// Client wraps the mautrix.Client with resilient syncing, crypto support, and message dispatching.
type Client struct {
	cfg          config.MatrixConfig
	matrixCli    *mautrix.Client
	store        *store.Store
	cryptoHelper *cryptohelper.CryptoHelper
	syncer       *mautrix.DefaultSyncer
	msgHandlers  []MessageHandler
	log          *slog.Logger
}

// New creates and initializes a Client with SQLite persistence and optional E2EE crypto support.
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
		cfg:         cfg,
		matrixCli:   cli,
		store:       st,
		syncer:      syncer,
		msgHandlers: make([]MessageHandler, 0),
		log:         log.With("component", "matrix_client"),
	}

	// Register internal message dispatcher on syncer
	syncer.OnEventType(event.EventMessage, func(ctx context.Context, evt *event.Event) {
		c.dispatchMessage(ctx, evt)
	})

	return c, nil
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
// It restores previously saved device ID and token if available to avoid ghost sessions.
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

// SyncLoop runs the Matrix sync loop with exponential backoff and 429 rate limit handling.
// It terminates cleanly when ctx is cancelled.
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

		// Perform sync request
		err := c.matrixCli.SyncWithContext(ctx)
		if err == nil {
			// Successful sync iteration, reset backoff
			backoff = 1 * time.Second
			continue
		}

		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			c.log.Info("sync loop context cancelled")
			return err
		}

		// Check for Matrix API rate limiting (M_LIMIT_EXCEEDED or HTTP 429)
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

		// Network or server error backoff
		c.log.Error("sync failed, backing off", "err", err, "backoff", backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
			backoff = min(backoff*2, maxBackoff)
		}
	}
}

// Stop closes all stores and crypto helpers gracefully.
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
