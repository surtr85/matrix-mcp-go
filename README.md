<div align="center">

![pi-matrix Banner](assets/banner.jpg)

# pi-matrix

**Native, high-performance, zero-token-overhead Matrix bridge extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent).**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pi Coding Agent](https://img.shields.io/badge/Agent-Pi%20Coding%20Agent-00d2ff.svg)](https://github.com/earendil-works/pi-coding-agent)
[![Matrix Protocol](https://img.shields.io/badge/Protocol-Matrix%20v1.11-0ebd8f.svg)](https://matrix.org)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)

</div>

---

## ⚡ Overview

`pi-matrix` is a dedicated bridge extension engineered specifically for **Pi Coding Agent**. Unlike traditional bots that spin up separate API sessions or wrap messages in hundreds of tokens of subagent instructions, `pi-matrix` directly injects messages into your active Pi TUI session, giving you full access to your agent, its workspaces, tools, and subscriptions seamlessly over Matrix.

```mermaid
flowchart LR
    User([User on Matrix / Element])
    subgraph pi-matrix [pi-matrix Extension]
        Sync[Long-Polling Sync & Coalesce]
        Queue[Concurrency Turn Queue]
        MediaIn[Media Downloader & Disk Cache]
        MediaOut[Outbound Media Uplink]
        Reporter[Progress Reporter / m.replace]
        Commands[Command & Abort Interceptor]
    end
    subgraph PiRuntime [Pi Coding Agent Runtime]
        Session[(Active Interactive Session)]
        Tools[Coding Tools: bash, edit, read, write]
        Vision[Multimodal Vision Model]
    end

    User -- "Prompt / Image / Video / File" --> Sync
    Sync --> Queue --> MediaIn --> Session
    Sync -- "/abort, 🛑 Reaction" --> Commands --> Session
    Sync -- "/sh, /upload, /new" --> Commands
    Session -- "tool_execution_start" --> Reporter -- "⏳ Status (m.replace)" --> User
    Session -- "write (plot/svg/image)" --> MediaOut -- "m.image / m.file" --> User
    Session -- "agent_end" --> Reporter -- "Delete status & Send final answer" --> User
```

---

## ✨ Features

- **🚀 Direct Session Injection (Zero Token Bloat)**: Messages are dispatched directly via `pi.sendUserMessage()` with `{ deliverAs: "followUp" }`. No system-prompt wrapping, no wasted context tokens, and no concurrency crashes.
- **🛡️ Concurrency-Safe Turn Queue (FIFO)**: Intelligent multi-turn queue keeps track of every request's exact originating room and message event ID, ensuring answers and acknowledgments always route to the right message even during rapid typing.
- **📤 Outbound Media Uplink**: Automatically uploads newly created plots, diagrams (`.png`, `.jpg`, `.svg`), PDFs, and generated files produced by Pi tools directly to Matrix via `/_matrix/media/v3/upload`!
- **🛑 Interactive Instant Abort**: Interrupt runaway agent loops or long compilation jobs immediately by typing `/abort` or simply reacting with 🛑 to the message.
- **💻 Zero-Token Shell Commands (`/sh`)**: Execute system commands (`/sh git status`, `/sh df -h`, etc.) directly on your host machine from Matrix without invoking the LLM or burning tokens.
- **⏱️ Live Progress Reporter with Cooldown**: Hooks into Pi lifecycle events (`turn_start`, `tool_execution_start`, `tool_execution_end`) to report what the agent is doing (`⚙️ Running bash: ...`, `📖 Reading ...`, `✏️ Editing ...`, `🔍 Searching ...`) with a debounced cooldown (default: `5s`).
- **🧹 In-Place Updates (`m.replace`) & Auto-Cleanup**: Status updates are edited in-place inside a single Matrix message (MSC2676) so chat rooms never get spammed. When Pi finishes, the temporary progress message is automatically redacted (deleted), leaving only your prompt and the final response.
- **🖼️ Comprehensive Multimodal Media**:
  - **Images (`m.image`)**: Downloads media, passes Base64 directly into Pi's multimodal vision model, and saves the file locally in `~/.pi/agent/media/`.
  - **Videos (`m.video`)**: Downloads to local disk, extracts metadata, and notifies Pi of the local path for tool analysis.
  - **Audio (`m.audio`)**: Downloads and caches audio files locally for agent inspection.
  - **Files / Documents (`m.file`)**: Saves documents/code to disk and generates syntax-highlighted code previews for text files under 64KB.
- **📦 Matrix PDU Protection & Chunking**: Splits large responses (>4000 characters) cleanly into sequential chunks, and automatically attaches massive responses (>25KB) as markdown files to prevent Matrix `M_TOO_LARGE` errors.
- **🔗 Intelligent Batch Coalescing**: Automatically merges rapid-fire text captions and media events from Matrix clients into a single multimodal turn.
- **💾 Disk-Backed Sync Token**: Automatically saves `next_batch` to `~/.pi/agent/matrix_sync_token` so restarts never replay past messages.
- **🛠️ Remote Control Slash Commands**:
  - `/abort` or `/stop`: Instantly cancels active agent execution.
  - `/sh <cmd>`: Runs a host shell command directly without LLM tokens.
  - `/upload <path>`: Uploads a local server file to the Matrix chat.
  - `/new` or `/reset`: Instantly resets the session via `ctx.newSession()`.
  - `/status`: Displays connection state, active model, thinking budget, and token metrics.
  - `/model [name]`: Inspects available models or dynamically switches models.
  - `/thinking [level]`: Adjusts reasoning depth (`off`, `low`, `medium`, `high`, `max`).
  - `/compact`: Triggers context compaction.
  - `/help`: Lists available commands.
- **🌐 Persian & Bilingual BiDi Formatting**: Automatically wraps Persian text lines in right-to-left (`dir="rtl"`) tags, code blocks in left-to-right (`dir="ltr"`), and supports markdown links, headers, blockquotes, and lists.
- **🧠 Clean Output**: Strips `<think>...</think>` tags automatically before delivering replies.
- **👀 Fast Reactions**: Immediate acknowledgment reaction (`👀`) and task completion checkmark (`✅`).
- **🔔 Hardened Notifications**: Desktop notifications via `execFile("notify-send", ...)` with zero shell-interpolation risks.

---

## 📦 Installation

### 1. Declarative (NixOS & Home-Manager)

Add the extension and declarative configuration into your Home-Manager setup:

```nix
# modules/home/ai/pi/default.nix
{ pkgs, ... }:
let
  piAgentDir = ".pi/agent";
in
{
  home.file."${piAgentDir}/extensions/pi-matrix.ts".source =
    builtins.fetchurl {
      url = "https://raw.githubusercontent.com/surtr85/pi-matrix/main/index.ts";
    };

  home.file."${piAgentDir}/matrix.json".text = builtins.toJSON {
    homeserver = "https://matrix.example.com";
    accessToken = "YOUR_MATRIX_ACCESS_TOKEN";
    botUserId = "@pi_bot:matrix.example.com";
    allowedUsers = [ "@you:matrix.example.com" ];
    autoStart = true;
    useSubagent = false;
    progressCooldownSeconds = 5;
    progressMode = "edit";
  };
}
```

### 2. Manual Installation

Clone or copy `index.ts` into your local Pi extensions directory:

```bash
mkdir -p ~/.pi/agent/extensions
curl -fsSL https://raw.githubusercontent.com/surtr85/pi-matrix/main/index.ts \
  -o ~/.pi/agent/extensions/pi-matrix.ts
```

Create your configuration file at `~/.pi/agent/matrix.json`:

```json
{
  "homeserver": "https://matrix.example.com",
  "accessToken": "syt_xxxxxxxxxxxxxxxxxxxx",
  "botUserId": "@bot:matrix.example.com",
  "allowedUsers": [
    "@your_username:matrix.example.com"
  ],
  "autoStart": true,
  "progressCooldownSeconds": 5,
  "progressMode": "edit"
}
```

Start Pi in your terminal:

```bash
pi
```

You will see:
```text
Matrix Bridge connected (Direct Mode)
```

---

## ⚙️ Configuration Reference (`matrix.json`)

| Option | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `homeserver` | `string` | `""` | Matrix homeserver base URL (e.g. `https://matrix.example.com`). |
| `accessToken` | `string` | `""` | Bot account access token. |
| `botUserId` | `string` | `""` | The bot user ID (e.g. `@miku:matrix.example.com`). |
| `allowedUsers` | `string[]` | `[]` | Allowlist of user IDs permitted to interact with the bot. Leave empty for open access. |
| `autoStart` | `boolean` | `true` | Whether to automatically start listening when Pi opens. |
| `progressCooldownSeconds`| `number` | `5` | Minimum seconds between progress updates to avoid notification spam. |
| `progressMode` | `"edit" \| "message"` | `"edit"` | `"edit"` updates the progress in-place via MSC2676; `"message"` sends new messages. |
| `useSubagent` | `boolean` | `false` | When `false`, messages execute directly in Pi for minimum token consumption. |

---

## 🎮 Interactive Slash Commands

Control your agent remotely from any Matrix client:

| Command | Description |
| :--- | :--- |
| `/abort` or `/stop` | Instantly interrupts and cancels active agent execution. |
| `/sh <command>` | Runs a host shell command directly without burning LLM tokens. |
| `/upload <path>` | Uploads a file or image from the host machine directly into Matrix. |
| `/new` or `/reset` | Resets the conversation and starts a new session immediately. |
| `/status` | Shows connection status, active model, thinking level, and token metrics. |
| `/model [id]` | Shows the active model or switches to another available model. |
| `/thinking [level]`| Sets thinking/reasoning depth (`off`, `low`, `medium`, `high`, `max`). |
| `/compact [prompt]`| Triggers context compaction with optional instructions. |
| `/help` | Shows the command cheat sheet. |

> **Pro Tip**: React to any in-flight message with 🛑 to abort the task immediately!

---

## 📁 Media Storage

All received media (images, videos, voice notes, PDFs, code archives) are securely saved to:
```text
~/.pi/agent/media/<timestamp>_<filename>
```
Pi is automatically informed of the file's exact location, allowing it to inspect or process files locally using its command-line tools (`read`, `bash`, Python scripts, ImageMagick, etc.).

---

## 📄 License

Distributed under the [MIT License](LICENSE).
