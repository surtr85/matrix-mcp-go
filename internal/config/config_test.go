package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/config"
)

func TestLoadConfig_Validation(t *testing.T) {
	// Empty config should fail validation
	_, err := config.Load("/nonexistent-path-never-used")
	if err == nil {
		t.Fatal("expected error loading nonexistent file, got nil")
	}

	// Loading with empty homeserver url
	tmpDir := t.TempDir()
	emptyCfgFile := filepath.Join(tmpDir, "empty.yaml")
	if err := os.WriteFile(emptyCfgFile, []byte("mcp:\n  server_name: test\n"), 0600); err != nil {
		t.Fatalf("failed to write empty cfg: %v", err)
	}

	_, err = config.Load(emptyCfgFile)
	if err == nil {
		t.Fatal("expected validation error for missing homeserver_url, got nil")
	}
}

func TestLoadConfig_FileAndEnv(t *testing.T) {
	tmpDir := t.TempDir()
	cfgFile := filepath.Join(tmpDir, "config.yaml")

	yamlContent := `
matrix:
  homeserver_url: "https://matrix.example.com"
  user_id: "@bot:example.com"
  access_token: "file_token"
  db_path: "file.db"
mcp:
  server_name: "test-server"
  transport: "stdio"
log:
  level: "debug"
  format: "json"
`
	if err := os.WriteFile(cfgFile, []byte(yamlContent), 0600); err != nil {
		t.Fatalf("failed to write yaml: %v", err)
	}

	cfg, err := config.Load(cfgFile)
	if err != nil {
		t.Fatalf("unexpected load error: %v", err)
	}

	if cfg.Matrix.HomeserverURL != "https://matrix.example.com" {
		t.Errorf("expected homeserver_url 'https://matrix.example.com', got %q", cfg.Matrix.HomeserverURL)
	}
	if cfg.Matrix.AccessToken != "file_token" {
		t.Errorf("expected access_token 'file_token', got %q", cfg.Matrix.AccessToken)
	}
	if cfg.Log.Level != "debug" {
		t.Errorf("expected log.level 'debug', got %q", cfg.Log.Level)
	}

	// Override via Environment Variable
	t.Setenv("MATRIX_MCP_MATRIX__ACCESS_TOKEN", "env_token_secret")
	t.Setenv("MATRIX_MCP_LOG__LEVEL", "warn")

	cfgEnv, err := config.Load(cfgFile)
	if err != nil {
		t.Fatalf("unexpected load error with env: %v", err)
	}

	if cfgEnv.Matrix.AccessToken != "env_token_secret" {
		t.Errorf("expected access_token overridden to 'env_token_secret', got %q", cfgEnv.Matrix.AccessToken)
	}
	if cfgEnv.Log.Level != "warn" {
		t.Errorf("expected log.level overridden to 'warn', got %q", cfgEnv.Log.Level)
	}
}
