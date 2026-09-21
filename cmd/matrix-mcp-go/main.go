package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
	"maunium.net/go/mautrix/event"
)

var (
	version = "0.1.0"
)

func main() {
	configPath := flag.String("config", "", "Path to configuration YAML file")
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

	log := logger.Setup(cfg.Log, os.Stderr)
	log.Info("matrix-mcp-go starting",
		"version", version,
		"server_name", cfg.MCP.ServerName,
		"transport", cfg.MCP.Transport,
		"matrix_homeserver", cfg.Matrix.HomeserverURL,
		"matrix_user", cfg.Matrix.UserID,
	)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Initialize Matrix Client
	matrixCli, err := client.New(cfg.Matrix, log)
	if err != nil {
		log.Error("failed to create matrix client", "err", err)
		os.Exit(1)
	}
	defer func() {
		if err := matrixCli.Close(); err != nil {
			log.Warn("error closing matrix client", "err", err)
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

	log.Info("matrix client ready, entering sync loop")

	// Run sync loop until context cancellation
	if err := matrixCli.SyncLoop(ctx); err != nil && err != context.Canceled {
		log.Error("sync loop terminated with error", "err", err)
		os.Exit(1)
	}

	log.Info("matrix-mcp-go shut down cleanly")
}
