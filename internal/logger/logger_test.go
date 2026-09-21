package logger_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
)

func TestLogger_JSONOutput(t *testing.T) {
	buf := &bytes.Buffer{}
	cfg := config.LogConfig{
		Level:  "info",
		Format: "json",
	}

	l := logger.Setup(cfg, buf)
	l.Info("server starting", "port", 8080)

	var entry map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("expected valid JSON log output, got error: %v, raw: %s", err, buf.String())
	}

	if entry["msg"] != "server starting" {
		t.Errorf("expected msg 'server starting', got %v", entry["msg"])
	}
	if entry["level"] != "INFO" {
		t.Errorf("expected level 'INFO', got %v", entry["level"])
	}
	if entry["port"] != float64(8080) {
		t.Errorf("expected port 8080, got %v", entry["port"])
	}
}

func TestLogger_LevelFiltering(t *testing.T) {
	buf := &bytes.Buffer{}
	cfg := config.LogConfig{
		Level:  "warn",
		Format: "json",
	}

	l := logger.Setup(cfg, buf)
	l.Debug("debug message")
	l.Info("info message")

	if buf.Len() > 0 {
		t.Fatalf("expected no output for levels below warn, got: %s", buf.String())
	}

	l.Warn("warning message")
	if buf.Len() == 0 {
		t.Fatal("expected output for warn message, got empty buffer")
	}
}
