import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MatrixApiClient } from "./api.js";
import type { MatrixQueue } from "./queue.js";
import type { MatrixProgressReporter } from "./progress.js";
import type { MatrixConfig } from "./types.js";
import { getHomeDir } from "./config.js";

export async function handleMatrixCommand(
  roomId: string,
  commandText: string,
  sender: string,
  replyToId: string,
  ctx: ExtensionContext | null,
  pi: ExtensionAPI,
  api: MatrixApiClient,
  queue: MatrixQueue,
  progressReporter: MatrixProgressReporter,
  config: MatrixConfig,
  isPolling: boolean,
): Promise<boolean> {
  const trimmed = commandText.trim();
  if (!trimmed.startsWith("/")) return false;

  const [cmdNameRaw, ...restParts] = trimmed.slice(1).split(" ");
  const cmdName = cmdNameRaw.toLowerCase();
  const args = restParts.join(" ").trim();

  // 1. /abort, /stop, /cancel
  if (cmdName === "abort" || cmdName === "stop" || cmdName === "cancel") {
    try {
      if (ctx && typeof ctx.abort === "function") {
        ctx.abort();
      }
      api.stopTypingLoop();
      await progressReporter.cleanup();
      queue.clear();

      await api.sendReaction(roomId, replyToId, "🛑");
      await api.sendMessage(
        roomId,
        "🛑 **Agent execution aborted.**",
        replyToId,
      );
    } catch (err: any) {
      await api.sendMessage(
        roomId,
        `❌ Failed to abort: ${err.message || String(err)}`,
        replyToId,
      );
    }
    return true;
  }

  // 2. /sh, /bash, /run
  if (cmdName === "sh" || cmdName === "bash" || cmdName === "run") {
    if (!args) {
      await api.sendMessage(
        roomId,
        "⚠️ Usage: `/sh <command>` (Executes host command directly without LLM tokens)",
        replyToId,
      );
      return true;
    }

    if (config.allowedUsers.length === 0 || !config.allowedUsers.includes(sender)) {
      await api.sendMessage(
        roomId,
        "⛔ Permission denied: /sh requires sender to be explicitly listed in allowedUsers.",
        replyToId,
      );
      return true;
    }

    await api.sendReaction(roomId, replyToId, "⚙️");

    execFile(
      "/bin/sh",
      ["-c", args],
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PAGER: "cat" },
        cwd: getHomeDir(),
      },
      async (error, stdout, stderr) => {
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
        if (error && !output) output = `Process error: ${error.message}`;
        if (!output.trim()) output = "Command completed with no output.";

        if (output.length > 6000) {
          output = output.slice(0, 6000) + "\n... (truncated)";
        }

        const formatted = `💻 **Exec:** \`${args.slice(0, 80)}\`\n\`\`\`sh\n${output}\n\`\`\``;
        await api.sendMessage(roomId, formatted, replyToId);
        await api.sendReaction(roomId, replyToId, "✅");
      },
    );
    return true;
  }

  // 3. /upload, /file
  if (cmdName === "upload" || cmdName === "file") {
    if (config.allowedUsers.length === 0 || !config.allowedUsers.includes(sender)) {
      await api.sendMessage(
        roomId,
        "⛔ Permission denied: /upload requires sender to be explicitly listed in allowedUsers.",
        replyToId,
      );
      return true;
    }

    if (!args) {
      await api.sendMessage(
        roomId,
        "⚠️ Usage: `/upload <local_path>`",
        replyToId,
      );
      return true;
    }

    const targetPath = path.isAbsolute(args)
      ? args
      : path.resolve(getHomeDir(), args);

    if (!fs.existsSync(targetPath)) {
      await api.sendMessage(
        roomId,
        `❌ File not found: \`${targetPath}\``,
        replyToId,
      );
      return true;
    }

    await api.sendReaction(roomId, replyToId, "📤");
    const evId = await api.sendMedia(roomId, targetPath, replyToId);
    if (evId) {
      await api.sendReaction(roomId, replyToId, "✅");
    } else {
      await api.sendMessage(
        roomId,
        `❌ Failed to upload file \`${path.basename(targetPath)}\``,
        replyToId,
      );
    }
    return true;
  }

  // 4. /new, /reset, /clear
  if (cmdName === "new" || cmdName === "reset" || cmdName === "clear") {
    try {
      if (ctx && typeof (ctx as any).newSession === "function") {
        await (ctx as any).newSession();
      } else {
        pi.sendUserMessage("/matrix_new_session", {
          expandPromptTemplates: true,
          deliverAs: "followUp",
        });
      }
      await api.sendMessage(
        roomId,
        "✨ **New session started successfully.**",
        replyToId,
      );
    } catch (err: any) {
      await api.sendMessage(
        roomId,
        `❌ Failed to start new session: ${err.message || String(err)}`,
        replyToId,
      );
    }
    return true;
  }

  // 5. /status, /info, /session
  if (cmdName === "status" || cmdName === "info" || cmdName === "session") {
    let statsText = "";
    try {
      const session = (ctx as any)?.session;
      if (session && typeof session.getSessionStats === "function") {
        const stats = session.getSessionStats();
        statsText = [
          `📊 **Session Statistics:**`,
          `- Messages: ${stats.totalMessages} (user: ${stats.userMessages}, assistant: ${stats.assistantMessages})`,
          `- Tool Calls: ${stats.toolCalls}`,
          `- Tokens: ${stats.tokens?.total?.toLocaleString() || 0} total`,
        ].join("\n");
      }
    } catch {}

    const currentModel = ctx?.model;
    const currentThinking = pi.getThinkingLevel();

    const msg = [
      `📡 **Pi Matrix Bridge Status (v2.5 Modular):**`,
      `- Connection: ${isPolling ? "🟢 Connected & Active" : "🔴 Stopped"}`,
      `- Execution Mode: ${config.useSubagent ? `⚡ Subagent (${config.subagentRole})` : "🚀 Direct (Zero Token Bloat)"}`,
      `- Active Model: \`${currentModel ? `${currentModel.provider}/${currentModel.id}` : "Unset"}\``,
      `- Thinking Level: \`${currentThinking}\``,
      `- Progress Cooldown: \`${config.progressCooldownSeconds}s\` (Mode: \`${config.progressMode}\`)`,
      `- Pending Queue: \`${queue.length} turns\``,
      statsText,
    ]
      .filter(Boolean)
      .join("\n");

    await api.sendMessage(roomId, msg, replyToId);
    return true;
  }

  // 6. /model [model_id]
  if (cmdName === "model") {
    if (!args) {
      const currentModel = ctx?.model;
      await api.sendMessage(
        roomId,
        `🤖 **Active Model:** \`${currentModel ? `${currentModel.provider}/${currentModel.id}` : "Unset"}\``,
        replyToId,
      );
      return true;
    }
    try {
      const available =
        ctx?.scopedModels && ctx.scopedModels.length > 0
          ? ctx.scopedModels.map((sm) => sm.model)
          : ctx?.modelRegistry?.getAvailable() || [];

      const match = available.find(
        (m: any) =>
          m.id.toLowerCase() === args.toLowerCase() ||
          `${m.provider}/${m.id}`.toLowerCase() === args.toLowerCase(),
      );
      if (match) {
        const success = await pi.setModel(match);
        if (success) {
          await api.sendMessage(
            roomId,
            `✅ Switched model to **${match.provider}/${match.id}**.`,
            replyToId,
          );
        } else {
          await api.sendMessage(
            roomId,
            `❌ Authentication failed for model ${match.provider}/${match.id}.`,
            replyToId,
          );
        }
      } else {
        const availableList = available
          .map((m: any) => `\`${m.provider}/${m.id}\``)
          .join(", ");
        await api.sendMessage(
          roomId,
          `⚠️ Model \`${args}\` not found.\nAvailable models:\n${availableList || "None"}`,
          replyToId,
        );
      }
    } catch (err: any) {
      await api.sendMessage(
        roomId,
        `❌ Error switching model: ${err.message || String(err)}`,
        replyToId,
      );
    }
    return true;
  }

  // 7. /thinking [level]
  if (cmdName === "thinking") {
    if (!args) {
      const currentLevel = pi.getThinkingLevel();
      await api.sendMessage(
        roomId,
        `🧠 **Current Thinking Level:** \`${currentLevel}\``,
        replyToId,
      );
      return true;
    }
    try {
      const level = args.toLowerCase() as any;
      pi.setThinkingLevel(level);
      await api.sendMessage(
        roomId,
        `🧠 Thinking level updated to **${args}**.`,
        replyToId,
      );
    } catch (err: any) {
      await api.sendMessage(
        roomId,
        `❌ Error setting thinking level: ${err.message || String(err)}`,
        replyToId,
      );
    }
    return true;
  }

  // 8. /compact
  if (cmdName === "compact") {
    try {
      if (ctx && typeof ctx.compact === "function") {
        ctx.compact(args ? { customInstructions: args } : undefined);
      } else {
        pi.sendUserMessage(
          args ? `/matrix_compact_session ${args}` : "/matrix_compact_session",
          {
            expandPromptTemplates: true,
            deliverAs: "followUp",
          },
        );
      }
      await api.sendMessage(
        roomId,
        "⏳ **Context compaction initiated.**",
        replyToId,
      );
    } catch (err: any) {
      await api.sendMessage(
        roomId,
        `❌ Compaction error: ${err.message || String(err)}`,
        replyToId,
      );
    }
    return true;
  }

  // 9. /help
  if (cmdName === "help") {
    const helpMsg = [
      `🛠️ **Pi Matrix Bridge Commands:**`,
      `- \`/abort\` or \`/stop\`: Instantly cancel running agent task`,
      `- \`/sh <cmd>\`: Direct zero-token shell execution on host`,
      `- \`/upload <path>\`: Upload host file/image to Matrix`,
      `- \`/new\` or \`/reset\`: Start a fresh session`,
      `- \`/status\`: View connection status, active model, and token stats`,
      `- \`/model [name]\`: View or switch active model`,
      `- \`/thinking [off|low|medium|high|max]\`: Adjust reasoning level`,
      `- \`/compact [instructions]\`: Compact chat context history`,
      `- \`/help\`: View this guide`,
      ``,
      `💡 *Tip: You can also react with 🛑 to abort a running task!*`,
    ].join("\n");
    await api.sendMessage(roomId, helpMsg, replyToId);
    return true;
  }

  return false;
}
