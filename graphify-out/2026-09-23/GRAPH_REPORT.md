# Graph Report - pi-matrix  (2026-09-23)

## Corpus Check
- 13 files · ~72,340 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 132 nodes · 213 edges · 11 communities (8 shown, 3 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `13d8d6d3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- package.json
- index.ts
- ProgressReporter
- TelegramApiClient
- api.ts
- handleSlashCommand
- pi-matrix
- telegram/index.ts
- TelegramQueue
- flake.nix

## God Nodes (most connected - your core abstractions)
1. `TelegramApiClient` - 21 edges
2. `TelegramQueue` - 11 edges
3. `handleSlashCommand()` - 9 edges
4. `TelegramProgressReporter` - 9 edges
5. `ProgressReporter` - 8 edges
6. `pi-matrix` - 8 edges
7. `keywords` - 7 edges
8. `PendingTelegramTurn` - 7 edges
9. `getHomeDir()` - 6 edges
10. `TelegramConfig` - 6 edges

## Surprising Connections (you probably didn't know these)
- `handleSlashCommand()` --calls--> `getHomeDir()`  [EXTRACTED]
  telegram/src/commands.ts → telegram/src/config.ts
- `TelegramApiClient` --references--> `TelegramConfig`  [EXTRACTED]
  telegram/src/api.ts → telegram/src/types.ts
- `TelegramProgressReporter` --references--> `TelegramApiClient`  [EXTRACTED]
  telegram/src/progress.ts → telegram/src/api.ts
- `handleSlashCommand()` --calls--> `escapeHtml()`  [EXTRACTED]
  telegram/src/commands.ts → telegram/src/formatter.ts
- `TelegramQueue` --references--> `PendingTelegramTurn`  [EXTRACTED]
  telegram/src/queue.ts → telegram/src/types.ts

## Import Cycles
- None detected.

## Communities (11 total, 3 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.07
Nodes (28): @earendil-works/pi-coding-agent, author, bugs, url, description, files, homepage, keywords (+20 more)

### Community 1 - "index.ts"
Cohesion: 0.12
Nodes (16): BoundedEventCache, DEFAULT_CONFIG, DownloadedMedia, downloadMatrixMedia(), escapeHtml(), getHomeDir(), getMediaDir(), getSyncTokenPath() (+8 more)

### Community 3 - "TelegramApiClient"
Cohesion: 0.15
Nodes (3): TelegramApiClient, TelegramProgressReporter, TelegramConfig

### Community 4 - "api.ts"
Cohesion: 0.39
Nodes (4): getMediaDir(), DownloadedFile, InlineKeyboardButton, InlineKeyboardMarkup

### Community 5 - "handleSlashCommand"
Cohesion: 0.33
Nodes (6): getQuickActionMarkup(), handleSlashCommand(), decodeHtmlEntities(), escapeHtml(), markdownToTelegramHtml(), stripHtmlToPlainText()

### Community 6 - "pi-matrix"
Cohesion: 0.18
Nodes (10): 1. Declarative (NixOS & Home-Manager), 2. Manual Installation, ⚙️ Configuration Reference (`matrix.json`), ✨ Features, 📦 Installation, 🎮 Interactive Slash Commands, 📄 License, 📁 Media Storage (+2 more)

### Community 7 - "telegram/index.ts"
Cohesion: 0.39
Nodes (5): DEFAULT_CONFIG, formatFileSize(), getHomeDir(), loadConfig(), cleanAssistantText()

## Knowledge Gaps
- **37 isolated node(s):** `pkgs.mkShell`, `MatrixConfig`, `DEFAULT_CONFIG`, `PendingTurn`, `DownloadedMedia` (+32 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TelegramApiClient` connect `TelegramApiClient` to `api.ts`, `handleSlashCommand`, `telegram/index.ts`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `TelegramQueue` connect `TelegramQueue` to `api.ts`, `handleSlashCommand`, `telegram/index.ts`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `TelegramProgressReporter` connect `TelegramApiClient` to `telegram/index.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `handleSlashCommand()` (e.g. with `.sendMediaAuto()` and `.sendMessage()`) actually correct?**
  _`handleSlashCommand()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `pkgs.mkShell`, `MatrixConfig`, `DEFAULT_CONFIG` to the rest of the system?**
  _37 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11956521739130435 - nodes in this community are weakly interconnected._