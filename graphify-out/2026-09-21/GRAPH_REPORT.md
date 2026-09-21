# Graph Report - matrix-mcp-go  (2026-09-21)

## Corpus Check
- 30 files · ~13,589 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 238 nodes · 487 edges · 14 communities (13 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `495e5fbe`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- context.Context
- testing.T
- Server
- FormatMessage
- Store
- Client
- Matrix MCP Universal Gateway (`matrix-mcp-go`)
- matrixHTMLRenderer
- Config
- Matrix MCP Universal Gateway - Project Plan
- flake.nix
- github.com/amadeus/matrix-mcp-go

## God Nodes (most connected - your core abstractions)
1. `Client` - 23 edges
2. `Server` - 23 edges
3. `Setup()` - 18 edges
4. `mockMatrixOps` - 17 edges
5. `New()` - 16 edges
6. `NewServer()` - 13 edges
7. `Store` - 12 edges
8. `hitlMockOperations` - 11 edges
9. `setupTestServer()` - 11 edges
10. `matrixHTMLRenderer` - 10 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `Load()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/config/config.go
- `main()` --calls--> `NewServer()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/mcp/server.go
- `main()` --calls--> `Setup()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/logger/logger.go
- `main()` --calls--> `New()`  [EXTRACTED]
  cmd/matrix-mcp-go/main.go → internal/matrix/client/client.go
- `New()` --calls--> `NewReplyRegistry()`  [INFERRED]
  internal/matrix/client/client.go → internal/matrix/client/reply_registry.go

## Import Cycles
- None detected.

## Communities (14 total, 1 thin omitted)

### Community 0 - "context.Context"
Cohesion: 0.16
Nodes (15): context.Context, io.Reader, maunium.net/go/mautrix/id.EventID, maunium.net/go/mautrix/id.RoomID, maunium.net/go/mautrix.RespMediaUpload, maunium.net/go/mautrix.RespSendEvent, sync.Mutex, time.Duration (+7 more)

### Community 1 - "testing.T"
Cohesion: 0.12
Nodes (25): main(), io.Writer, log/slog.Logger, testing.T, Setup(), TestLogger_JSONOutput(), TestLogger_LevelFiltering(), New() (+17 more)

### Community 2 - "Server"
Cohesion: 0.11
Nodes (13): github.com/mark3labs/mcp-go/mcp.CallToolRequest, github.com/mark3labs/mcp-go/mcp.CallToolResult, github.com/mark3labs/mcp-go/server.MCPServer, github.com/mark3labs/mcp-go/server.SSEServer, github.com/mark3labs/mcp-go/server.ToolHandlerFunc, net/http.Handler, net/http.Server, NewServer() (+5 more)

### Community 3 - "FormatMessage"
Cohesion: 0.11
Nodes (21): bidiASTTransformer, Direction, Formatter, github.com/yuin/goldmark/ast.Document, github.com/yuin/goldmark.Markdown, github.com/yuin/goldmark/parser.Context, github.com/yuin/goldmark/renderer.NodeRenderer, github.com/yuin/goldmark/text.Reader (+13 more)

### Community 4 - "Store"
Cohesion: 0.13
Nodes (10): database/sql.DB, maunium.net/go/mautrix/id.DeviceID, maunium.net/go/mautrix/id.UserID, Authorizer, New(), TestAuthorizer_AllowAllWhenEmpty(), TestAuthorizer_AllowlistedUsers(), Store (+2 more)

### Community 5 - "Client"
Cohesion: 0.13
Nodes (10): MessageHandler, ReplyRegistry, replyWaiter, maunium.net/go/mautrix.Client, maunium.net/go/mautrix/crypto/cryptohelper.CryptoHelper, maunium.net/go/mautrix.DefaultSyncer, maunium.net/go/mautrix/event.Event, sync.RWMutex (+2 more)

### Community 6 - "Matrix MCP Universal Gateway (`matrix-mcp-go`)"
Cohesion: 0.09
Nodes (21): 1. `matrix_send_message`, 2. `matrix_ask_human` (Human-in-the-Loop), 3. `matrix_send_reaction`, 4. `matrix_upload_media`, 5. `matrix_list_rooms`, 🤖 AI Agent Integration, 🏛 Architecture Overview, Claude Desktop (`claude_desktop_config.json`) (+13 more)

### Community 7 - "matrixHTMLRenderer"
Cohesion: 0.34
Nodes (7): matrixHTMLRenderer, github.com/yuin/goldmark/ast.Node, github.com/yuin/goldmark/ast.WalkStatus, github.com/yuin/goldmark/renderer/html.Config, github.com/yuin/goldmark/renderer.NodeRendererFuncRegisterer, github.com/yuin/goldmark/util.BufWriter, getDirectionAttr()

### Community 8 - "Config"
Cohesion: 0.24
Nodes (9): Config, rawStructProvider, DefaultConfig(), LogConfig, MatrixConfig, MCPConfig, Load(), TestLoadConfig_FileAndEnv() (+1 more)

### Community 9 - "Matrix MCP Universal Gateway - Project Plan"
Cohesion: 0.25
Nodes (7): Matrix MCP Universal Gateway - Project Plan, Phase 1: Project Scaffolding & Configuration, Phase 2: Matrix Core Engine (Powered by mautrix-go), Phase 3: The Formatting Engine (Markdown & RTL), Phase 4: MCP Protocol Integration, Phase 5: Event Routing & Human-in-the-Loop Workflow, Phase 6: Reliability, Dual-Transport & Observability

### Community 10 - "flake.nix"
Cohesion: 0.50
Nodes (3): matrix-mcp-go.nix, pkgs.buildGoModule, pkgs.mkShell

## Knowledge Gaps
- **27 isolated node(s):** `matrix-mcp-go.nix`, `pkgs.mkShell`, `pkgs.buildGoModule`, `github.com/amadeus/matrix-mcp-go`, `Client` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FormatMessage()` connect `FormatMessage` to `Server`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **Why does `Server` connect `Server` to `Config`, `testing.T`?**
  _High betweenness centrality (0.125) - this node is a cross-community bridge._
- **Why does `Client` connect `Client` to `context.Context`, `testing.T`, `Store`, `Config`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **What connects `matrix-mcp-go.nix`, `pkgs.mkShell`, `pkgs.buildGoModule` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.12436974789915967 - nodes in this community are weakly interconnected._
- **Should `Server` be split into smaller, more focused modules?**
  _Cohesion score 0.11083743842364532 - nodes in this community are weakly interconnected._
- **Should `FormatMessage` be split into smaller, more focused modules?**
  _Cohesion score 0.11076923076923077 - nodes in this community are weakly interconnected._