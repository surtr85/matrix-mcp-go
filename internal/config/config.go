package config

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

// Config holds all configuration parameters for matrix-mcp-go.
type Config struct {
	Matrix MatrixConfig `koanf:"matrix"`
	MCP    MCPConfig    `koanf:"mcp"`
	Log    LogConfig    `koanf:"log"`
}

// MatrixConfig holds Matrix homeserver, authentication, and database settings.
type MatrixConfig struct {
	HomeserverURL string `koanf:"homeserver_url"`
	UserID        string `koanf:"user_id"`
	AccessToken   string `koanf:"access_token"`
	Password      string `koanf:"password"`
	DeviceID      string `koanf:"device_id"`
	DBPath        string `koanf:"db_path"`
	PickleKey     string `koanf:"pickle_key"`
}

// MCPConfig holds MCP transport and server settings.
type MCPConfig struct {
	ServerName    string `koanf:"server_name"`
	ServerVersion string `koanf:"server_version"`
	Transport     string `koanf:"transport"` // "stdio" or "sse"
	HTTPPort      int    `koanf:"http_port"`
}

// LogConfig holds structured logging configuration.
type LogConfig struct {
	Level  string `koanf:"level"`  // debug, info, warn, error
	Format string `koanf:"format"` // json, text
}

// DefaultConfig returns a Config initialized with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Matrix: MatrixConfig{
			DBPath: "data/matrix-mcp.db",
		},
		MCP: MCPConfig{
			ServerName:    "matrix-mcp-go",
			ServerVersion: "0.1.0",
			Transport:     "stdio",
			HTTPPort:      8080,
		},
		Log: LogConfig{
			Level:  "info",
			Format: "json",
		},
	}
}

// Load loads configuration from an optional file path and overrides with environment variables.
// Environment variables are prefixed with MATRIX_MCP_ and use double underscores for nesting,
// e.g. MATRIX_MCP_MATRIX__HOMESERVER_URL -> matrix.homeserver_url
func Load(configPath string) (*Config, error) {
	k := koanf.New(".")

	// Set defaults into koanf instance
	defaults := DefaultConfig()
	if err := k.Load(rawStructProvider{cfg: defaults}, nil); err != nil {
		return nil, fmt.Errorf("failed to load default config: %w", err)
	}

	// Load from configuration file if provided or if default config.yaml exists
	targetPath := configPath
	if targetPath == "" {
		if _, err := os.Stat("config.yaml"); err == nil {
			targetPath = "config.yaml"
		}
	}

	if targetPath != "" {
		if err := k.Load(file.Provider(targetPath), yaml.Parser()); err != nil {
			return nil, fmt.Errorf("failed to load config file %q: %w", targetPath, err)
		}
	}

	// Load environment variables with prefix MATRIX_MCP_
	// Example: MATRIX_MCP_MATRIX__HOMESERVER_URL -> matrix.homeserver_url
	// Example: MATRIX_MCP_LOG__LEVEL -> log.level
	err := k.Load(env.Provider("MATRIX_MCP_", ".", func(s string) string {
		trimmed := strings.TrimPrefix(s, "MATRIX_MCP_")
		lower := strings.ToLower(trimmed)
		return strings.ReplaceAll(lower, "__", ".")
	}), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to load environment variables: %w", err)
	}

	var cfg Config
	if err := k.Unmarshal("", &cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal configuration: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	return &cfg, nil
}

// Validate checks essential configuration constraints.
func (c *Config) Validate() error {
	if c.Matrix.HomeserverURL == "" {
		return errors.New("matrix.homeserver_url is required")
	}
	if c.Matrix.UserID == "" {
		return errors.New("matrix.user_id is required")
	}
	if c.Matrix.AccessToken == "" && c.Matrix.Password == "" {
		return errors.New("either matrix.access_token or matrix.password must be provided")
	}
	if c.Matrix.DBPath == "" {
		return errors.New("matrix.db_path cannot be empty")
	}
	return nil
}

// rawStructProvider adapts an in-memory struct to koanf Provider.
type rawStructProvider struct {
	cfg *Config
}

func (p rawStructProvider) ReadBytes() ([]byte, error) {
	return nil, nil
}

func (p rawStructProvider) Read() (map[string]interface{}, error) {
	return map[string]interface{}{
		"matrix": map[string]interface{}{
			"db_path": p.cfg.Matrix.DBPath,
		},
		"mcp": map[string]interface{}{
			"server_name":    p.cfg.MCP.ServerName,
			"server_version": p.cfg.MCP.ServerVersion,
			"transport":      p.cfg.MCP.Transport,
			"http_port":      p.cfg.MCP.HTTPPort,
		},
		"log": map[string]interface{}{
			"level":  p.cfg.Log.Level,
			"format": p.cfg.Log.Format,
		},
	}, nil
}
