package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/id"
)

// Store provides persistence for Matrix client metadata, sync tokens, and filters.
type Store struct {
	db *sql.DB
}

// Ensure Store satisfies mautrix.SyncStore.
var _ mautrix.SyncStore = (*Store)(nil)

// New initializes an embedded SQLite database at dbPath and applies necessary migrations.
func New(dbPath string) (*Store, error) {
	if dbPath == "" {
		return nil, errors.New("dbPath cannot be empty")
	}

	dir := filepath.Dir(dbPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, fmt.Errorf("failed to create database directory %q: %w", dir, err)
		}
	}

	// SQLite connection string with WAL mode and busy timeout for concurrent safety
	dsn := fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000", dbPath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	return s, nil
}

// migrate creates required tables if they do not exist.
func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS matrix_client_meta (
		user_id TEXT PRIMARY KEY,
		device_id TEXT,
		access_token TEXT,
		filter_id TEXT,
		next_batch TEXT,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);
	`
	_, err := s.db.Exec(schema)
	return err
}

// Close closes the underlying SQLite database.
func (s *Store) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// SaveFilterID implements mautrix.SyncStore.
func (s *Store) SaveFilterID(ctx context.Context, userID id.UserID, filterID string) error {
	query := `
	INSERT INTO matrix_client_meta (user_id, filter_id, updated_at)
	VALUES (?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(user_id) DO UPDATE SET
		filter_id = excluded.filter_id,
		updated_at = CURRENT_TIMESTAMP;
	`
	_, err := s.db.ExecContext(ctx, query, string(userID), filterID)
	return err
}

// LoadFilterID implements mautrix.SyncStore.
func (s *Store) LoadFilterID(ctx context.Context, userID id.UserID) (string, error) {
	query := `SELECT filter_id FROM matrix_client_meta WHERE user_id = ?;`
	var filterID sql.NullString
	err := s.db.QueryRowContext(ctx, query, string(userID)).Scan(&filterID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return filterID.String, nil
}

// SaveNextBatch implements mautrix.SyncStore.
func (s *Store) SaveNextBatch(ctx context.Context, userID id.UserID, nextBatchToken string) error {
	query := `
	INSERT INTO matrix_client_meta (user_id, next_batch, updated_at)
	VALUES (?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(user_id) DO UPDATE SET
		next_batch = excluded.next_batch,
		updated_at = CURRENT_TIMESTAMP;
	`
	_, err := s.db.ExecContext(ctx, query, string(userID), nextBatchToken)
	return err
}

// LoadNextBatch implements mautrix.SyncStore.
func (s *Store) LoadNextBatch(ctx context.Context, userID id.UserID) (string, error) {
	query := `SELECT next_batch FROM matrix_client_meta WHERE user_id = ?;`
	var nextBatch sql.NullString
	err := s.db.QueryRowContext(ctx, query, string(userID)).Scan(&nextBatch)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return nextBatch.String, nil
}

// SaveDeviceCredentials persists or updates device ID and access token for the given user ID.
func (s *Store) SaveDeviceCredentials(ctx context.Context, userID id.UserID, deviceID id.DeviceID, accessToken string) error {
	query := `
	INSERT INTO matrix_client_meta (user_id, device_id, access_token, updated_at)
	VALUES (?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(user_id) DO UPDATE SET
		device_id = excluded.device_id,
		access_token = excluded.access_token,
		updated_at = CURRENT_TIMESTAMP;
	`
	_, err := s.db.ExecContext(ctx, query, string(userID), string(deviceID), accessToken)
	return err
}

// LoadDeviceCredentials returns the stored device ID and access token, if any.
func (s *Store) LoadDeviceCredentials(ctx context.Context, userID id.UserID) (id.DeviceID, string, error) {
	query := `SELECT device_id, access_token FROM matrix_client_meta WHERE user_id = ?;`
	var devID, tok sql.NullString
	err := s.db.QueryRowContext(ctx, query, string(userID)).Scan(&devID, &tok)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	return id.DeviceID(devID.String), tok.String, nil
}
