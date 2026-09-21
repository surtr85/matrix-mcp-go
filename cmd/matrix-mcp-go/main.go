package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
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
		// Before logger setup, report directly to stderr
		fmt.Fprintf(os.Stderr, "Error loading configuration: %v\n", err)
		os.Exit(1)
	}

	log := logger.Setup(cfg.Log, os.Stderr)
	log.Info("matrix-mcp-go initialized",
		"version", version,
		"server_name", cfg.MCP.ServerName,
		"transport", cfg.MCP.Transport,
		"matrix_homeserver", cfg.Matrix.HomeserverURL,
		"matrix_user", cfg.Matrix.UserID,
	)

	// Phase 1 scaffold complete - Phase 2 will start the Matrix engine and MCP server.
	slog.Info("scaffold verified, waiting for next phases")
}
