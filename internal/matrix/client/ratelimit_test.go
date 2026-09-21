package client_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/amadeus/matrix-mcp-go/internal/config"
	"github.com/amadeus/matrix-mcp-go/internal/logger"
	"github.com/amadeus/matrix-mcp-go/internal/matrix/client"
)

func TestClient_RateLimitHandling(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "ratelimit_test.db")

	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{
				"errcode": "M_LIMIT_EXCEEDED",
				"error": "Too Many Requests",
				"retry_after_ms": 100
			}`))
			return
		}
		// Second call returns empty sync
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"next_batch": "batch_after_rate_limit"}`))
	}))
	defer server.Close()

	cfg := config.MatrixConfig{
		HomeserverURL: server.URL,
		UserID:        "@bot:example.com",
		AccessToken:   "test_token",
		DBPath:        dbPath,
	}

	log := logger.Setup(config.LogConfig{Level: "debug", Format: "text"}, nil)
	c, err := client.New(cfg, log)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer func() { _ = c.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// SyncLoop will hit the rate limit, sleep retry_after_ms (100ms), and then succeed
	go func() {
		_ = c.SyncLoop(ctx)
	}()

	// Wait until at least 2 calls have been processed
	start := time.Now()
	for calls < 2 && time.Since(start) <= 2*time.Second {
		time.Sleep(50 * time.Millisecond)
	}

	if calls < 2 {
		t.Errorf("expected at least 2 calls after rate limit backoff, got %d", calls)
	}
}
