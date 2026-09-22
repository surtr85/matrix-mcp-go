# Graph Report - matrix-mcp-go  (2026-09-22)

## Corpus Check
- 4 files · ~51,960 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 70 nodes · 77 edges · 8 communities (5 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c0541243`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- package.json
- index.ts
- ProgressReporter
- keywords
- files
- BoundedEventCache
- pi-matrix
- flake.nix

## God Nodes (most connected - your core abstractions)
1. `pi-matrix` - 8 edges
2. `ProgressReporter` - 7 edges
3. `keywords` - 7 edges
4. `files` - 5 edges
5. `getHomeDir()` - 4 edges
6. `getSyncTokenPath()` - 4 edges
7. `BoundedEventCache` - 4 edges
8. `getMediaDir()` - 3 edges
9. `markdownToMatrixHtml()` - 3 edges
10. `repository` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (8 total, 3 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.12
Nodes (16): @earendil-works/pi-coding-agent, author, bugs, url, description, homepage, license, main (+8 more)

### Community 1 - "index.ts"
Cohesion: 0.18
Nodes (13): DEFAULT_CONFIG, DownloadedMedia, downloadMatrixMedia(), escapeHtml(), getHomeDir(), getMediaDir(), getSyncTokenPath(), isPersian() (+5 more)

### Community 3 - "keywords"
Cohesion: 0.29
Nodes (7): keywords, ai-agent, coding-agent, matrix, matrix-bridge, pi-coding-agent, pi-extension

### Community 4 - "files"
Cohesion: 0.40
Nodes (5): files, assets, index.ts, LICENSE, README.md

### Community 6 - "pi-matrix"
Cohesion: 0.18
Nodes (10): 1. Declarative (NixOS & Home-Manager), 2. Manual Installation, ⚙️ Configuration Reference (`matrix.json`), ✨ Features, 📦 Installation, 🎮 Interactive Slash Commands, 📄 License, 📁 Media Storage (+2 more)

## Knowledge Gaps
- **34 isolated node(s):** `pkgs.mkShell`, `MatrixConfig`, `DEFAULT_CONFIG`, `DownloadedMedia`, `name` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `keywords` connect `keywords` to `package.json`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `ProgressReporter` connect `ProgressReporter` to `index.ts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `files` connect `files` to `package.json`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `pkgs.mkShell`, `MatrixConfig`, `DEFAULT_CONFIG` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._