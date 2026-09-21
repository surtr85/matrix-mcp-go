package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
	mcpinternal "github.com/amadeus/matrix-mcp-go/internal/mcp"
	"maunium.net/go/mautrix/event"
)

var (
	version = "0.1.0"
)

func main() {
	configPath := flag.String("config", "", "Path to configuration YAML file")
	transportFlag := flag.String("transport", "", "MCP transport override: 'stdio' or 'sse'")
	showVersion := flag.Bool("version", false, "Display version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("matrix-mcp-go version %s\n", version)
		os.Exit(0)
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading configuration: %v\n", err)
		os.Exit(1)
	}

	// Override transport if provided via CLI flag
	if *transportFlag != "" {
		cfg.MCP.Transport = *transportFlag
	}

	// CRITICAL RULE: All logs must go to stderr so stdout is reserved for MCP JSON-RPC Stdio transport!
	log := logger.Setup(cfg.Log, os.Stderr)
	log.Info("matrix-mcp-go starting",
		"version", version,
		"server_name", cfg.MCP.ServerName,
		"transport", cfg.MCP.Transport,
		"matrix_homeserver", cfg.Matrix.HomeserverURL,
		"matrix_user", cfg.Matrix.UserID,
	)

	// Intercept SIGINT and SIGTERM for deterministic graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Initialize Matrix Client
	matrixCli, err := client.New(cfg.Matrix, log)
	if err != nil {
		log.Error("failed to create matrix client", "err", err)
		os.Exit(1)
	}

	// Matrix shutdown sequence
	defer func() {
		log.Info("executing Matrix graceful shutdown")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Set presence to offline
		if err := matrixCli.SetOffline(shutdownCtx); err != nil {
			log.Warn("failed to set presence offline", "err", err)
		}

		// Close SQLite DB connections and crypto stores
		if err := matrixCli.Close(); err != nil {
			log.Warn("error closing matrix client resources", "err", err)
		}
	}()

	// Perform Matrix Login / credential restoration
	if err := matrixCli.Login(ctx); err != nil {
		log.Error("matrix login failed", "err", err)
		os.Exit(1)
	}

	// Initialize E2EE crypto
	if err := matrixCli.InitCrypto(ctx); err != nil {
		log.Warn("matrix crypto initialization failed, continuing without E2EE", "err", err)
	}

	// Register message logger
	matrixCli.OnMessage(func(ctx context.Context, evt *event.Event) {
		log.Info("received matrix message",
			"room_id", evt.RoomID,
			"sender", evt.Sender,
			"event_id", evt.ID,
		)
	})

	// Start Matrix sync loop in background
	go func() {
		if err := matrixCli.SyncLoop(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error("sync loop terminated with error", "err", err)
		}
	}()

	// Initialize MCP Server (with Stdio and SSE transports + Prometheus metrics)
	mcpSrv := mcpinternal.NewServer(cfg.MCP, matrixCli, log)

	if cfg.MCP.Transport == "sse" {
		log.Info("starting server in SSE network transport mode")
		if err := mcpSrv.StartHTTP(ctx); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, http.ErrServerClosed) {
			log.Error("mcp http/sse server terminated with error", "err", err)
		}
	} else {
		log.Info("starting server in Stdio transport mode")
		// In Stdio mode, wait on Stdio serve loop
		stdioDone := make(chan error, 1)
		go func() {
			stdioDone <- mcpSrv.ServeStdio()
		}()

		select {
		case <-ctx.Done():
			log.Info("received shutdown signal, stopping stdio transport")
		case err := <-stdioDone:
			if err != nil && !errors.Is(err, context.Canceled) {
				log.Error("mcp stdio server terminated with error", "err", err)
			}
		}
	}

	log.Info("matrix-mcp-go shut down cleanly")
}
