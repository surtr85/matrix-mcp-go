# Matrix MCP Universal Gateway (`matrix-mcp-go`)

[![Go Version](https://img.shields.io/badge/go-1.26+-00ADD8?style=flat&logo=go)](https://golang.org)
[![Nix Flake](https://img.shields.io/badge/nix-flake-5277C3?style=flat&logo=nixos)](flake.nix)
[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blueviolet)](https://modelcontextprotocol.io)
[![Matrix E2EE](https://img.shields.io/badge/Matrix-E2EE%20(Pure%20Go)-008080?style=flat&logo=matrix)](https://matrix.org)

A high-performance, universal Matrix MCP (Model Context Protocol) server implemented in Go. Connects AI agents (Claude Desktop, Pi, Cursor, Antigravity, Devin, etc.) directly to the decentralized Matrix communications network with full end-to-end encryption (E2EE), bidirectional text formatting (RTL/LTR), human-in-the-loop workflows, and dual transports (Stdio & HTTP/SSE).

---

## 🏛 Architecture Overview

```
+-------------------------------------------------------------------------------+
|                                AI AGENTS                                      |
|    Claude Desktop  /  Pi Agent  /  Cursor  /  Antigravity  /  Devin / Custom  |
+-------------------------------------------------------------------------------+
           |                                                      ^
           | MCP JSON-RPC (Stdio / SSE)                           |
           v                                                      |
+-------------------------------------------------------------------------------+
|                       matrix-mcp-go Gateway Daemon                            |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                           MCP Server Layer                              |  |
|  |   - Stdio Transport (Log-isolated, stdin/stdout framed)                 |  |
|  |   - HTTP/SSE Server (/sse, /message, /metrics, /healthz)                |  |
|  |   - Tools: send_message, ask_human, reaction, upload, list_rooms        |  |
|  |   - Resources: matrix://rooms/joined                                    |  |
|  +-------------------------------------------------------------------------+  |
|                                     |                                         |
|  +----------------------------------+--------------------------------------+  |
|  | Formatter & BiDi Engine          | Security & RBAC                      |  |
|  |  - Goldmark AST Markdown parser  |  - Allowlist user filtering          |  |
|  |  - Auto RTL/LTR detection        |  - Malicious prompt drop             |  |
|  |  - LTR-enforced code blocks      |  - Thread binding & verification     |  |
|  +----------------------------------+--------------------------------------+  |
|                                     |                                         |
|  +-------------------------------------------------------------------------+  |
|  |                       Matrix Engine (mautrix-go)                        |  |
|  |   - Pure Go Olm/Megolm E2EE (goolm, memory-safe, zero insecure C olm)   |  |
|  |   - Resilient Sync Loop (Exponential backoff + M_LIMIT_EXCEEDED retry)  |  |
|  |   - Embedded SQLite Persistence (WAL mode, crypto state, batch tokens)  |  |
|  |   - Human-in-the-Loop Reply Registry with Live Typing Indicators        |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
                                      |
                           Matrix Client-Server API
                                      v
+-------------------------------------------------------------------------------+
|                     Matrix Homeserver (Synapse / Dendrite)                   |
|                        Encrypted Rooms, Threads, Media                        |
+-------------------------------------------------------------------------------+
```

---

## 🚀 Key Capabilities

1. **Dual Transport Architecture:**
   - **Stdio Transport:** Standard input/output for local agent sub-processes. All diagnostic and operational logs are strictly routed to `os.Stderr` to prevent JSON-RPC framing corruption.
   - **HTTP / SSE Transport:** Network daemon serving Server-Sent Events (`/sse`), JSON-RPC message endpoint (`/message`), health checks (`/healthz`), and Prometheus metrics (`/metrics`).
2. **Pure-Go E2EE Cryptography:**
   - Powered by `mautrix-go` with pure Go Olm (`-tags goolm`). Zero vulnerable C `libolm` shared library dependencies.
3. **AST-Level Bidirectional (BiDi) Markdown Formatting:**
   - Converts Markdown directly to Matrix-compliant HTML using Goldmark AST transforms.
   - Scans for the first strong directional Unicode characters (Persian/Arabic vs Latin) to automatically set `dir="rtl"` or `dir="ltr"`.
   - Strictly enforces `dir="ltr"` on inline `<code>` and `<pre><code>` blocks so code indentation and syntax never flip in RTL viewports.
4. **Interactive Human-in-the-Loop (`matrix_ask_human`):**
   - Enables agents to pause execution, prompt a human in a dedicated Matrix thread, emit active typing indicators, and resume when an authorized answer is received.
   - Resilient timeout handling and context cancellation.
5. **Security & RBAC:**
   - Enforces user allowlisting (`matrix.allowed_users`). Messages from unauthorized senders are dropped immediately.
6. **Declarative Nix Flake Packaging:**
   - Hermetic, reproducible builds via Nix Flakes.

---

## 📦 Quickstart & Installation

### Option 1: Using Nix Flake (Recommended)

Run directly without installation:
```bash
nix run github:amadeus/matrix-mcp-go -- -config config.yaml
```

Or build the standalone binary:
```bash
nix build
./result/bin/matrix-mcp-go -version
```

Enter reproducible development shell:
```bash
nix develop
go test -tags goolm -v ./...
```

### Option 2: Go Toolchain

```bash
git clone https://github.com/amadeus/matrix-mcp-go.git
cd matrix-mcp-go
go build -tags goolm -o bin/matrix-mcp-go ./cmd/matrix-mcp-go
```

---

## ⚙️ Configuration Reference

Configuration can be specified using a YAML file or environment variables (`MATRIX_MCP_*`).

Copy the example configuration:
```bash
cp config.example.yaml config.yaml
```

### Configuration Fields (`config.yaml`)

```yaml
matrix:
  # Matrix Homeserver URL
  homeserver_url: "https://matrix.example.com"

  # Bot User ID
  user_id: "@bot:example.com"

  # Authentication: provide either access_token or password
  access_token: "syt_your_matrix_access_token"
  # password: "your-secret-password"

  # Persistent Device ID (preserves session across restarts)
  device_id: "matrix-mcp-gateway"

  # SQLite database path for session/crypto/state persistence
  db_path: "data/matrix-mcp.db"

  # Optional encryption key for crypto pickle storage
  pickle_key: "your-32-byte-secret-pickle-key"

  # Security & RBAC: Allowlisted Matrix users.
  # Use ["*"] or leave empty to allow all users.
  allowed_users:
    - "@alice:example.com"
    - "@admin:example.com"

mcp:
  # Server metadata
  server_name: "matrix-mcp-go"
  server_version: "0.1.0"

  # Transport: "stdio" or "sse"
  transport: "stdio"

  # SSE network settings
  listen_address: "0.0.0.0"
  http_port: 8080

log:
  level: "info"     # debug, info, warn, error
  format: "json"    # json, text
```

### Environment Variable Overrides

Any setting can be overridden using environment variables prefixed with `MATRIX_MCP_` and double-underscores (`__`) for nested sections:

```bash
export MATRIX_MCP_MATRIX__HOMESERVER_URL="https://matrix.org"
export MATRIX_MCP_MATRIX__USER_ID="@agent:matrix.org"
export MATRIX_MCP_MATRIX__ACCESS_TOKEN="syt_secret_token"
export MATRIX_MCP_MCP__TRANSPORT="stdio"
export MATRIX_MCP_LOG__LEVEL="debug"
```

---

## 🤖 AI Agent Integration

### Claude Desktop (`claude_desktop_config.json`)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "matrix": {
      "command": "/path/to/matrix-mcp-go/result/bin/matrix-mcp-go",
      "args": [
        "-config", "/path/to/matrix-mcp-go/config.yaml",
        "-transport", "stdio"
      ]
    }
  }
}
```

### Cursor / Antigravity / Pi Agent

In your agent's MCP configuration settings:

```json
{
  "name": "matrix",
  "type": "stdio",
  "command": "matrix-mcp-go",
  "args": ["-config", "config.yaml"]
}
```

Or for remote HTTP/SSE deployments:
```json
{
  "name": "matrix-remote",
  "type": "sse",
  "url": "http://10.0.0.5:8080/sse"
}
```

---

## 🛠 MCP Tools Reference

### 1. `matrix_send_message`
Sends a formatted message to a Matrix room, automatically converting Markdown to compliant Matrix HTML with BiDi direction.

**Parameters:**
- `room_id` *(string, required)*: Target Matrix room ID (e.g., `!abc123:example.com`).
- `message` *(string, required)*: Markdown message text (supports Persian/Arabic BiDi, code blocks, tables, lists).
- `thread_id` *(string, optional)*: Root event ID if replying within a thread.

### 2. `matrix_ask_human` (Human-in-the-Loop)
Prompts a human user in a Matrix room/thread, maintains typing indicators, and pauses tool execution until the human replies.

**Parameters:**
- `room_id` *(string, required)*: Target Matrix room ID.
- `question` *(string, required)*: Question or decision prompt in Markdown.
- `thread_id` *(string, optional)*: Existing thread root ID; if empty, the question itself forms a new thread root.
- `timeout_seconds` *(number, optional, default: 300)*: Maximum time to wait for a human reply.

**Response Example:**
```json
{
  "success": true,
  "answer": "Approved. Proceed with production migration.",
  "sender": "@admin:example.com",
  "room_id": "!ops:example.com",
  "thread_id": "$prompt_event_id",
  "event_id": "$reply_event_id",
  "timestamp": 1726945200000
}
```

### 3. `matrix_send_reaction`
Sends an emoji reaction to a specific Matrix event.

**Parameters:**
- `room_id` *(string, required)*: Room containing the target event.
- `event_id` *(string, required)*: Target Matrix event ID.
- `emoji` *(string, required)*: Emoji character (e.g., `👍`, `🚀`, `✅`).

### 4. `matrix_upload_media`
Uploads a local file to the Matrix media repository and returns the `mxc://` URI.

**Parameters:**
- `file_path` *(string, required)*: Path to the local file to upload.

### 5. `matrix_list_rooms`
Lists joined rooms with room names, topics, and member counts.

---

## 📊 Observability & Metrics

When running with SSE or network transport, `matrix-mcp-go` exposes a standard Prometheus metrics endpoint at `/metrics`:

- `matrix_messages_sent_total{room_id, status}` — Total messages sent.
- `matrix_sync_events_total{type}` — Sync loop event throughput by event type.
- `matrix_mcp_tool_calls_total{tool, status}` — Tool calls partitioned by tool and outcome.
- `matrix_mcp_tool_duration_seconds` — Histogram of tool execution latencies.

Health check endpoint:
```bash
curl http://localhost:8080/healthz
# {"status":"ok"}
```

---

## 🧪 Testing & Verification

Run all unit and integration tests:
```bash
nix develop --command go test -tags goolm -v ./...
```

Run formatter benchmarks:
```bash
nix develop --command go test -tags goolm -bench=. ./internal/format
```

Run linter:
```bash
nix develop --command golangci-lint run --build-tags goolm ./...
```

---

## 📄 License

MIT License. Designed with excellence for decentralized AI agent autonomy.
