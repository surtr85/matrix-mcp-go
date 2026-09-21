package client_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
)

func TestClient_InitCrypto(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "crypto_test.db")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	cfg := config.MatrixConfig{
		HomeserverURL: server.URL,
		UserID:        "@bot:example.com",
		AccessToken:   "crypto_token",
		DeviceID:      "CRYPTO_DEV",
		DBPath:        dbPath,
		PickleKey:     "secret-pickle-key-32-bytes-long!",
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	ctx := context.Background()
	if err := c.Login(ctx); err != nil {
		t.Fatalf("login failed: %v", err)
	}

	// Initialize crypto
	if err := c.InitCrypto(ctx); err != nil {
		t.Fatalf("failed to init crypto: %v", err)
	}

	if c.UnderlyingClient().Crypto == nil {
		t.Error("expected CryptoHelper to be set on mautrix client")
	}
}
