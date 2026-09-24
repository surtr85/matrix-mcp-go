# Graph Report - pi-matrix  (2026-09-24)

## Corpus Check
- 22 files · ~71,235 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 180 nodes · 352 edges · 9 communities (6 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `878fecd5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- package.json
- matrix/index.ts
- MatrixApiClient
- TelegramApiClient
- telegram/index.ts
- MatrixProgressReporter
- pi-matrix & pi-telegram
- BoundedEventCache
- flake.nix

## God Nodes (most connected - your core abstractions)
1. `MatrixApiClient` - 22 edges
2. `TelegramApiClient` - 22 edges
3. `MatrixProgressReporter` - 12 edges
4. `MatrixQueue` - 12 edges
5. `handleSlashCommand()` - 11 edges
6. `TelegramQueue` - 11 edges
7. `handleMatrixCommand()` - 9 edges
8. `MatrixConfig` - 9 edges
9. `TelegramProgressReporter` - 9 edges
10. `pi-matrix & pi-telegram` - 8 edges

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

## Communities (9 total, 3 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.07
Nodes (28): @earendil-works/pi-coding-agent, author, bugs, url, description, files, homepage, keywords (+20 more)

### Community 1 - "matrix/index.ts"
Cohesion: 0.13
Nodes (12): BoundedEventCache, handleMatrixCommand(), DEFAULT_CONFIG, formatFileSize(), getHomeDir(), getSyncTokenPath(), loadConfig(), loadSavedSyncToken() (+4 more)

### Community 2 - "MatrixApiClient"
Cohesion: 0.16
Nodes (10): MatrixApiClient, getMediaDir(), cleanAssistantText(), escapeHtml(), getMimeType(), isPersian(), markdownToMatrixHtml(), renderMarkdownTable() (+2 more)

### Community 3 - "TelegramApiClient"
Cohesion: 0.14
Nodes (3): TelegramApiClient, TelegramProgressReporter, TelegramConfig

### Community 4 - "telegram/index.ts"
Cohesion: 0.13
Nodes (20): getQuickActionMarkup(), handleSlashCommand(), DEFAULT_CONFIG, formatFileSize(), getHomeDir(), getMediaDir(), getOffsetPath(), loadConfig() (+12 more)

### Community 6 - "pi-matrix & pi-telegram"
Cohesion: 0.15
Nodes (12): ⚙️ Configuration Reference, 📦 Declarative Installation (NixOS / Home-Manager), ✨ Features, 🎮 Interactive Slash Commands, 📄 License, 🟢 Matrix Bridge (`matrix/`), Matrix Configuration (`~/.pi/agent/matrix.json`), ⚡ Overview (+4 more)

## Knowledge Gaps
- **35 isolated node(s):** `pkgs.mkShell`, `DEFAULT_CONFIG`, `name`, `version`, `description` (+30 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MatrixApiClient` connect `MatrixApiClient` to `matrix/index.ts`, `MatrixProgressReporter`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `TelegramApiClient` connect `TelegramApiClient` to `telegram/index.ts`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `handleSlashCommand()` (e.g. with `.acknowledgeOffset()` and `.sendMediaAuto()`) actually correct?**
  _`handleSlashCommand()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `pkgs.mkShell`, `DEFAULT_CONFIG`, `name` to the rest of the system?**
  _35 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Should `matrix/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12688172043010754 - nodes in this community are weakly interconnected._
- **Should `TelegramApiClient` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._