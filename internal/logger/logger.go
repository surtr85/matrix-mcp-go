package logger

import (
	"io"
	"log/slog"
	"os"
	"strings"

	"github.com/amadeus/matrix-mcp-go/internal/config"
)

// Setup configures and sets the default global structured logger based on LogConfig.
// It returns the configured *slog.Logger.
func Setup(cfg config.LogConfig, out io.Writer) *slog.Logger {
	if out == nil {
		out = os.Stderr
	}

	var level slog.Level
	switch strings.ToLower(cfg.Level) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	var handler slog.Handler
	if strings.ToLower(cfg.Format) == "text" {
		handler = slog.NewTextHandler(out, opts)
	} else {
		handler = slog.NewJSONHandler(out, opts)
	}

	l := slog.New(handler)
	slog.SetDefault(l)
	return l
}
