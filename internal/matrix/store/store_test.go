package store_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/matrix/store"
	"maunium.net/go/mautrix/id"
)

func TestStore_SyncTokensAndCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	s, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	userID := id.UserID("@alice:example.com")

	// 1. Initial loads should return empty string without error
	filterID, err := s.LoadFilterID(ctx, userID)
	if err != nil {
		t.Fatalf("unexpected error loading filter: %v", err)
	}
	if filterID != "" {
		t.Errorf("expected empty filter ID, got %q", filterID)
	}

	nextBatch, err := s.LoadNextBatch(ctx, userID)
	if err != nil {
		t.Fatalf("unexpected error loading next batch: %v", err)
	}
	if nextBatch != "" {
		t.Errorf("expected empty next batch, got %q", nextBatch)
	}

	deviceID, token, err := s.LoadDeviceCredentials(ctx, userID)
	if err != nil {
		t.Fatalf("unexpected error loading credentials: %v", err)
	}
	if deviceID != "" || token != "" {
		t.Errorf("expected empty credentials, got deviceID=%q token=%q", deviceID, token)
	}

	// 2. Save and reload Filter ID
	if err := s.SaveFilterID(ctx, userID, "filter_123"); err != nil {
		t.Fatalf("failed to save filter ID: %v", err)
	}
	filterID, err = s.LoadFilterID(ctx, userID)
	if err != nil || filterID != "filter_123" {
		t.Errorf("expected 'filter_123', got %q (err: %v)", filterID, err)
	}

	// 3. Save and reload NextBatch
	if err := s.SaveNextBatch(ctx, userID, "s123_456"); err != nil {
		t.Fatalf("failed to save next batch: %v", err)
	}
	nextBatch, err = s.LoadNextBatch(ctx, userID)
	if err != nil || nextBatch != "s123_456" {
		t.Errorf("expected 's123_456', got %q (err: %v)", nextBatch, err)
	}

	// 4. Save and reload Device Credentials
	if err := s.SaveDeviceCredentials(ctx, userID, "DEVICE_ABC", "syt_token_xyz"); err != nil {
		t.Fatalf("failed to save credentials: %v", err)
	}
	deviceID, token, err = s.LoadDeviceCredentials(ctx, userID)
	if err != nil || deviceID != "DEVICE_ABC" || token != "syt_token_xyz" {
		t.Errorf("expected DEVICE_ABC / syt_token_xyz, got %q / %q (err: %v)", deviceID, token, err)
	}

	// 5. Update credentials and verify upsert
	if err := s.SaveDeviceCredentials(ctx, userID, "DEVICE_DEF", "syt_token_new"); err != nil {
		t.Fatalf("failed to update credentials: %v", err)
	}
	deviceID, token, err = s.LoadDeviceCredentials(ctx, userID)
	if err != nil || deviceID != "DEVICE_DEF" || token != "syt_token_new" {
		t.Errorf("expected updated DEVICE_DEF / syt_token_new, got %q / %q (err: %v)", deviceID, token, err)
	}
}
