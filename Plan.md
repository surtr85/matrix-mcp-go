# Matrix MCP Universal Gateway - Project Plan

This document serves as the master execution plan for the `matrix-mcp-go` project.
It is structured as an iterative, phase-by-phase checklist for AI agents to follow, implement, and check off (`[x]`).

## Phase 1: Project Scaffolding & Configuration
- [x] Initialize Go module (`go mod init github.com/amadeus/matrix-mcp-go`).
- [x] Setup Nix Flake (`flake.nix`) for reproducible development environment (Go, SQLite, etc.).
- [x] Implement robust configuration management (e.g., using `koanf` or `viper` for YAML/Env loading). Ensure zero hardcoded secrets.
- [x] Implement logging framework (e.g., `slog` or `zerolog`) with structured JSON output.
- [x] **CHECKPOINT:** Run `go build` and ensure the binary compiles via `nix develop`.

## Phase 2: Matrix Core Engine (Powered by mautrix-go)
- [x] Setup embedded SQLite database for `mautrix-go` state persistence (crypto, sync tokens, room state).
- [x] Implement Matrix Client initialization and login (using Access Token/Password from config).
- [x] Implement `/sync` loop with exponential backoff, retry mechanisms, and error handling.
- [x] Enable E2EE (Olm/Megolm) support in the client for encrypted rooms.
- [x] **CHECKPOINT:** Test matrix login and basic message reception (log to stdout). Run `go test` for client wrapper.

## Phase 3: The Formatting Engine (Markdown & RTL)
- [x] Integrate `goldmark` (or similar fast parser) for Markdown parsing.
- [x] Develop custom Goldmark renderer/AST transformer to convert standard Markdown to Matrix-compatible HTML.
- [x] Implement BiDi (Bidirectional) text detection algorithm to wrap paragraphs with `dir="rtl"` or `dir="ltr"` natively without breaking formatting.
- [x] Ensure nested elements (code blocks, blockquotes, lists, tables) are rendered correctly without breaking Matrix clients.
- [x] **CHECKPOINT & BENCHMARK:** Write extensive unit tests for the formatter with complex Markdown and mixed Persian/English text. Benchmark formatter performance.

## Phase 4: MCP Protocol Integration
- [x] Integrate Go MCP SDK (e.g., `github.com/mark3labs/mcp-go`).
- [x] Setup Stdio transport for the MCP server.
- [x] Define and expose core MCP Tools:
  - [x] `matrix_send_message` (Target room, text, optional thread_id).
  - [x] `matrix_send_reaction` (Event ID, Emoji).
  - [x] `matrix_upload_media` (Upload local file path, return `mxc://` URI).
  - [x] `matrix_list_rooms` (Return joined rooms with metadata).
- [x] Define and expose core MCP Resources:
  - [x] `matrix://notifications/active`
- [x] **CHECKPOINT:** Use an MCP inspector or dummy client to connect via stdio and call `matrix_list_rooms` and `matrix_send_message`.

## Phase 5: Event Routing & Human-in-the-Loop Workflow
- [x] Implement Thread management logic: Automatically reply to the correct thread if a tool call is related to a specific Matrix thread.
- [x] Implement `matrix_ask_human` tool logic: Pause tool execution, listen to the Matrix sync loop for the user's reply in the same thread, and return the reply to the MCP client (with timeout support).
- [x] Implement RBAC (Role-Based Access Control) & Allowlisting to ignore unauthorized Matrix users securely.
- [x] **CHECKPOINT:** E2E integration test: AI agent asks a question via MCP -> message appears in Matrix -> human replies -> AI agent receives the reply.

## Phase 6: Reliability, Dual-Transport & Observability
- [x] Add SSE/HTTP transport support (allowing remote agents to connect to the daemon over network).
- [x] Implement Graceful Shutdown (capturing SIGINT/SIGTERM, closing DB connections safely, sending offline presence).
- [x] Add Prometheus metrics endpoint (tracking messages sent, sync latency, tool call frequency).
- [x] **CHECKPOINT & BENCHMARK:** Load testing the Sync loop and HTTP MCP endpoints. Check memory leaks during long-running execution.
- [x] Finalize Nix packaging (`nix build .#matrix-mcp-go`) and document setup instructions.
