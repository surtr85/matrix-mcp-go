# Graph Report - pi-matrix  (2026-09-24)

## Corpus Check
- 23 files · ~72,092 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 217 nodes · 394 edges · 10 communities (8 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9b092013`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- package.json
- matrix/index.ts
- MatrixApiClient
- TelegramApiClient
- telegram/index.ts
- compilerOptions
- pi-matrix & pi-telegram
- MatrixQueue
- BoundedEventCache
- flake.nix

## God Nodes (most connected - your core abstractions)
1. `TelegramApiClient` - 23 edges
2. `MatrixApiClient` - 22 edges
3. `MatrixQueue` - 15 edges
4. `TelegramQueue` - 14 edges
5. `MatrixProgressReporter` - 12 edges
6. `handleSlashCommand()` - 11 edges
7. `compilerOptions` - 11 edges
8. `handleMatrixCommand()` - 9 edges
9. `MatrixConfig` - 9 edges
10. `PendingTurn` - 9 edges

## Surprising Connections (you probably didn't know these)
- `handleMatrixCommand()` --calls--> `getHomeDir()`  [EXTRACTED]
  matrix/src/commands.ts → matrix/src/config.ts
- `MatrixQueue` --references--> `PendingTurn`  [EXTRACTED]
  matrix/src/queue.ts → matrix/src/types.ts
- `TelegramApiClient` --references--> `TelegramConfig`  [EXTRACTED]
  telegram/src/api.ts → telegram/src/types.ts
- `TelegramProgressReporter` --references--> `TelegramApiClient`  [EXTRACTED]
  telegram/src/progress.ts → telegram/src/api.ts
- `handleSlashCommand()` --calls--> `getHomeDir()`  [EXTRACTED]
  telegram/src/commands.ts → telegram/src/config.ts

## Import Cycles
- None detected.

## Communities (10 total, 2 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.06
Nodes (34): @earendil-works/pi-coding-agent, author, bugs, url, description, devDependencies, @types/node, typescript (+26 more)

### Community 1 - "matrix/index.ts"
Cohesion: 0.20
Nodes (10): BoundedEventCache, DEFAULT_CONFIG, formatFileSize(), getHomeDir(), getMediaDir(), getSyncTokenPath(), loadConfig(), loadSavedSyncToken() (+2 more)

### Community 2 - "MatrixApiClient"
Cohesion: 0.11
Nodes (12): MatrixApiClient, handleMatrixCommand(), cleanAssistantText(), escapeHtml(), getMimeType(), isPersian(), markdownToMatrixHtml(), renderMarkdownTable() (+4 more)

### Community 3 - "TelegramApiClient"
Cohesion: 0.14
Nodes (3): TelegramApiClient, TelegramProgressReporter, TelegramConfig

### Community 4 - "telegram/index.ts"
Cohesion: 0.13
Nodes (20): getQuickActionMarkup(), handleSlashCommand(), DEFAULT_CONFIG, formatFileSize(), getHomeDir(), getMediaDir(), getOffsetPath(), loadConfig() (+12 more)

### Community 5 - "compilerOptions"
Cohesion: 0.11
Nodes (18): DOM, DOM.Iterable, ES2022, matrix/**/*.ts, telegram/**/*.ts, compilerOptions, allowSyntheticDefaultImports, esModuleInterop (+10 more)

### Community 6 - "pi-matrix & pi-telegram"
Cohesion: 0.13
Nodes (14): ⚙️ Configuration Reference, 📦 Declarative Installation (NixOS / Home-Manager), ✨ Features, 🎮 Interactive Slash Commands, 📄 License, 🟢 Matrix Bridge (`matrix/`), Matrix Configuration (`~/.pi/agent/matrix.json`), Option A: Using Flake Packages (Recommended) (+6 more)

### Community 10 - "flake.nix"
Cohesion: 0.40
Nodes (4): matrix.nix, pi-matrix.nix, telegram.nix, pkgs.mkShell

## Knowledge Gaps
- **56 isolated node(s):** `matrix.nix`, `telegram.nix`, `pi-matrix.nix`, `pkgs.mkShell`, `DEFAULT_CONFIG` (+51 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MatrixApiClient` connect `MatrixApiClient` to `matrix/index.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `TelegramApiClient` connect `TelegramApiClient` to `telegram/index.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `MatrixQueue` connect `MatrixQueue` to `matrix/index.ts`, `MatrixApiClient`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `matrix.nix`, `telegram.nix`, `pi-matrix.nix` to the rest of the system?**
  _56 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `MatrixApiClient` be split into smaller, more focused modules?**
  _Cohesion score 0.10852713178294573 - nodes in this community are weakly interconnected._
- **Should `TelegramApiClient` be split into smaller, more focused modules?**
  _Cohesion score 0.13538461538461538 - nodes in this community are weakly interconnected._