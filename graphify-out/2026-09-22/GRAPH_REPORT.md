# Graph Report - matrix-mcp-go  (2026-09-21)

## Corpus Check
- 34 files · ~45,847 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 263 nodes · 568 edges · 15 communities (14 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2bc31ce6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- context.Context
- testing.T
- Server
- FormatMessage
- Store
- Client
- README.md
- matrixHTMLRenderer
- Config
- Matrix MCP Universal Gateway - Project Plan
- flake.nix
- github.com/amadeus/matrix-mcp-go
- matrix_agent_listener.py

## God Nodes (most connected - your core abstractions)
1. `Client` - 26 edges
2. `Server` - 24 edges
3. `Setup()` - 23 edges
4. `New()` - 20 edges
5. `mockMatrixOps` - 19 edges
6. `NewServer()` - 15 edges
7. `Store` - 12 edges
8. `hitlMockOperations` - 12 edges
9. `setupTestServer()` - 11 edges
10. `matrixHTMLRenderer` - 10 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `Load()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/config/config.go
- `main()` --calls--> `Setup()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/logger/logger.go
- `main()` --calls--> `New()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/matrix/client/client.go
- `main()` --calls--> `NewServer()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/mcp/server.go
- `New()` --calls--> `NewIncomingQueue()`  [INFERRED]
  internal/matrix/client/client.go → internal/matrix/client/incoming_queue.go

## Import Cycles
- None detected.

## Communities (15 total, 1 thin omitted)

### Community 0 - "context.Context"
Cohesion: 0.15
Nodes (16): context.Context, io.Reader, maunium.net/go/mautrix/id.EventID, maunium.net/go/mautrix/id.RoomID, maunium.net/go/mautrix.RespMediaUpload, maunium.net/go/mautrix.RespSendEvent, sync.Mutex, time.Duration (+8 more)

### Community 1 - "testing.T"
Cohesion: 0.11
Nodes (30): main(), io.Writer, testing.T, Setup(), TestLogger_JSONOutput(), TestLogger_LevelFiltering(), New(), TestClient_LoginWithPassword() (+22 more)

### Community 2 - "Server"
Cohesion: 0.11
Nodes (12): github.com/mark3labs/mcp-go/mcp.CallToolRequest, github.com/mark3labs/mcp-go/mcp.CallToolResult, github.com/mark3labs/mcp-go/server.MCPServer, github.com/mark3labs/mcp-go/server.SSEServer, github.com/mark3labs/mcp-go/server.ToolHandlerFunc, net/http.Handler, net/http.Server, RecordMessageSent() (+4 more)

### Community 3 - "FormatMessage"
Cohesion: 0.11
Nodes (21): bidiASTTransformer, Direction, Formatter, github.com/yuin/goldmark/ast.Document, github.com/yuin/goldmark.Markdown, github.com/yuin/goldmark/parser.Context, github.com/yuin/goldmark/renderer.NodeRenderer, github.com/yuin/goldmark/text.Reader (+13 more)

### Community 4 - "Store"
Cohesion: 0.13
Nodes (10): database/sql.DB, maunium.net/go/mautrix/id.DeviceID, maunium.net/go/mautrix/id.UserID, Authorizer, New(), TestAuthorizer_AllowAllWhenEmpty(), TestAuthorizer_AllowlistedUsers(), Store (+2 more)

### Community 5 - "Client"
Cohesion: 0.11
Nodes (14): IncomingQueue, incomingWaiter, MessageHandler, ReplyRegistry, replyWaiter, log/slog.Logger, maunium.net/go/mautrix.Client, maunium.net/go/mautrix/crypto/cryptohelper.CryptoHelper (+6 more)

### Community 6 - "README.md"
Cohesion: 0.11
Nodes (18): 🤖 AI Agent Integration, 🏛 Architecture, Available MCP Resources, 🛠 Available MCP Tools, Claude Desktop (`claude_desktop_config.json`), `config.yaml`, ⚙️ Configuration Reference, Cursor / Antigravity / Pi Agent (+10 more)

### Community 7 - "matrixHTMLRenderer"
Cohesion: 0.34
Nodes (7): matrixHTMLRenderer, github.com/yuin/goldmark/ast.Node, github.com/yuin/goldmark/ast.WalkStatus, github.com/yuin/goldmark/renderer/html.Config, github.com/yuin/goldmark/renderer.NodeRendererFuncRegisterer, github.com/yuin/goldmark/util.BufWriter, getDirectionAttr()

### Community 8 - "Config"
Cohesion: 0.24
Nodes (9): Config, rawStructProvider, DefaultConfig(), LogConfig, MatrixConfig, MCPConfig, Load(), TestLoadConfig_FileAndEnv() (+1 more)

### Community 9 - "Matrix MCP Universal Gateway - Project Plan"
Cohesion: 0.22
Nodes (8): Matrix MCP Universal Gateway - Project Plan, Phase 1: Project Scaffolding & Configuration, Phase 2: Matrix Core Engine (Powered by mautrix-go), Phase 3: The Formatting Engine (Markdown & RTL), Phase 4: MCP Protocol Integration, Phase 5: Event Routing & Human-in-the-Loop Workflow, Phase 6: Reliability, Dual-Transport & Observability, Phase 7: Universal Agent Inbound Polling (`matrix_wait_message`)

### Community 10 - "flake.nix"
Cohesion: 0.50
Nodes (3): matrix-mcp-go.nix, pkgs.buildGoModule, pkgs.mkShell

### Community 14 - "matrix_agent_listener.py"
Cohesion: 0.57
Nodes (7): ask_pi(), load_config(), main(), matrix_request(), send_message(), send_reaction(), set_typing()

## Knowledge Gaps
- **25 isolated node(s):** `matrix-mcp-go.nix`, `pkgs.mkShell`, `pkgs.buildGoModule`, `github.com/amadeus/matrix-mcp-go`, `Client` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FormatMessage()` connect `FormatMessage` to `Server`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **Why does `Client` connect `Client` to `context.Context`, `testing.T`, `Store`, `Config`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `Server` connect `Server` to `Config`, `testing.T`, `Client`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **What connects `matrix-mcp-go.nix`, `pkgs.mkShell`, `pkgs.buildGoModule` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.11184939091915837 - nodes in this community are weakly interconnected._
- **Should `Server` be split into smaller, more focused modules?**
  _Cohesion score 0.10591133004926108 - nodes in this community are weakly interconnected._
- **Should `FormatMessage` be split into smaller, more focused modules?**
  _Cohesion score 0.11076923076923077 - nodes in this community are weakly interconnected._