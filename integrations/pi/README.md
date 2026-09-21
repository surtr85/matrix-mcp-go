# Pi Coding Agent Matrix Extension

Dedicated high-performance, token-efficient, zero-cost bridge between Matrix and [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent).

## Highlights
- **Direct Session Injection**: Injects Matrix messages directly into Pi's interactive session via `pi.sendUserMessage(rawBody)` with zero token bloat or subagent prompt wrappers.
- **Live Progress Reporting with Cooldown**: Hooks into Pi lifecycle events (`turn_start`, `tool_execution_start`, `tool_execution_end`) and updates Matrix status in real-time (bash commands, file reads/edits, grep/find) with a configurable debounced cooldown (default: 5 seconds).
- **In-Place Live Updates (`m.replace`)**: Status updates are edited in-place inside a single Matrix message via standard `m.replace` (MSC2676) so your room does not get flooded with spam.
- **State Persistence**: Persists Matrix sync token (`next_batch`) in `~/.pi/agent/matrix_sync_token` to prevent replaying old messages on restart.
- **Interactive Control Commands**: Control Pi directly from your Matrix chat:
  - `/new` or `/reset`: Start a fresh Pi session.
  - `/status`: View active model, thinking level, and session token statistics.
  - `/model [id]`: Switch or inspect active models.
  - `/thinking [level]`: Adjust thinking/reasoning budget.
  - `/compact`: Compact session history.
  - `/help`: Command guide.
- **Bilingual BiDi & Formatting**: Persian RTL lines, English LTR lines, syntax-highlighted code blocks, and automatic `<think>...</think>` tag stripping.
- **Multimodal Support**: Automatically downloads `mxc://` media attachments and passes them as native image content to Pi.
- **Safety & Hygiene**: Read receipt (`m.read`), acknowledgment reaction (`👀`), task completion reaction (`✅`), and hardened desktop notifications via `execFile`.

## Installation

### Declarative (NixOS / Home-Manager)
Add the extension to your Home-Manager files:
```nix
home.file.".pi/agent/extensions/matrix-bridge.ts".source = ./matrix-bridge.ts;
home.file.".pi/agent/matrix.json".text = builtins.toJSON {
  homeserver = "https://matrix.example.com";
  accessToken = "YOUR_ACCESS_TOKEN";
  botUserId = "@bot:matrix.example.com";
  allowedUsers = [ "@your_user:matrix.example.com" ];
  autoStart = true;
  useSubagent = false;
  progressCooldownSeconds = 5;
  progressMode = "edit";
};
```

### Manual Installation
1. Copy `matrix-bridge.ts` into `~/.pi/agent/extensions/matrix-bridge.ts`.
2. Create or update `~/.pi/agent/matrix.json`:
```json
{
  "homeserver": "https://matrix.example.com",
  "accessToken": "YOUR_ACCESS_TOKEN",
  "botUserId": "@bot:matrix.example.com",
  "allowedUsers": ["@your_user:matrix.example.com"],
  "autoStart": true,
  "useSubagent": false,
  "progressCooldownSeconds": 5,
  "progressMode": "edit"
}
```
3. Launch Pi in your terminal:
```bash
pi
```
Pi will automatically connect and listen for incoming Matrix requests.
