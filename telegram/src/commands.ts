import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TelegramApiClient } from "./api.js";
import type { TelegramQueue } from "./queue.js";
import type { InlineKeyboardMarkup } from "./types.js";
import { getHomeDir } from "./config.js";
import { escapeHtml } from "./formatter.js";

export function getQuickActionMarkup(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🧹 New Session", callback_data: "cmd_new" },
        { text: "📊 Status", callback_data: "cmd_status" },
      ],
      [
        { text: "🗜️ Compact", callback_data: "cmd_compact" },
        { text: "🛑 Abort", callback_data: "cmd_abort" },
      ],
    ],
  };
}

export async function handleSlashCommand(
  chatId: number,
  messageId: number,
  text: string,
  _senderId: number,
  ctx: ExtensionContext | null,
  pi: ExtensionAPI,
  api: TelegramApiClient,
  queue: TelegramQueue,
): Promise<boolean> {
  const parts = text.trim().split(/\s+/);
  const cmdName = parts[0].replace("/", "").toLowerCase();
  const args = parts.slice(1).join(" ").trim();

  if (cmdName === "help") {
    const helpMsg = `🤖 <b>Pi Telegram Bridge Commands:</b>\n
• <code>/new</code> - Clear context & start a fresh session
• <code>/status</code> - Show current agent, model, and queue status
• <code>/model &lt;name&gt;</code> - Switch or view active model
• <code>/thinking &lt;budget&gt;</code> - Configure thinking token budget
• <code>/compact</code> - Compact conversation history
• <code>/sh &lt;cmd&gt;</code> - Zero-token direct shell execution
• <code>/upload &lt;path&gt;</code> - Send a file/photo from host to Telegram
• <code>/abort</code> - Abort current thinking / execution
• <code>/help</code> - Show this menu`;
    await api.sendMessage(chatId, helpMsg, messageId, getQuickActionMarkup());
    return true;
  }

  if (cmdName === "new" || cmdName === "reset" || cmdName === "clear") {
    try {
      pi.sendUserMessage("/new_session", {
        expandPromptTemplates: true,
        deliverAs: "followUp",
      });
      await api.sendMessage(chatId, "✨ <b>New session started successfully.</b>", messageId, getQuickActionMarkup());
    } catch (err: any) {
      await api.sendMessage(chatId, `❌ Failed to start new session: ${err.message}`, messageId);
    }
    return true;
  }

  if (cmdName === "compact") {
    try {
      await api.sendMessage(chatId, "⏳ <b>Context compaction in progress...</b>", messageId);
      pi.sendUserMessage(
        args ? `/compact_session ${args}` : "/compact_session",
        {
          expandPromptTemplates: true,
          deliverAs: "followUp",
        },
      );
    } catch (err: any) {
      await api.sendMessage(chatId, `❌ Compaction error: ${err.message}`, messageId);
    }
    return true;
  }

  if (cmdName === "model") {
    if (!args) {
      const currentModel = ctx?.model;
      const modelStr = currentModel ? `${currentModel.provider}/${currentModel.id}` : "Unset";
      await api.sendMessage(chatId, `🧠 <b>Current Model:</b> <code>${modelStr}</code>\n\nUsage: <code>/model &lt;model-name&gt;</code> to switch.`, messageId);
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
          await api.sendMessage(chatId, `✅ Switched model to <b>${match.provider}/${match.id}</b>.`, messageId);
        } else {
          await api.sendMessage(chatId, `❌ Authentication failed for model ${match.provider}/${match.id}.`, messageId);
        }
      } else {
        const list = available.map((m: any) => `<code>${m.provider}/${m.id}</code>`).join(", ");
        await api.sendMessage(chatId, `⚠️ Model <code>${escapeHtml(args)}</code> not found.\nAvailable models:\n${list || "None"}`, messageId);
      }
    } catch (err: any) {
      await api.sendMessage(chatId, `❌ Error switching model: ${err.message}`, messageId);
    }
    return true;
  }

  if (cmdName === "thinking" || cmdName === "think") {
    if (!args) {
      const currentLevel = pi.getThinkingLevel();
      await api.sendMessage(chatId, `🧠 <b>Current Thinking Level:</b> <code>${currentLevel}</code>\n\nUsage: <code>/thinking &lt;off|low|medium|high|max&gt;</code>`, messageId);
      return true;
    }
    try {
      pi.setThinkingLevel(args.toLowerCase() as any);
      await api.sendMessage(chatId, `🧠 Thinking level updated to <b>${escapeHtml(args)}</b>.`, messageId);
    } catch (err: any) {
      await api.sendMessage(chatId, `❌ Error setting thinking level: ${err.message}`, messageId);
    }
    return true;
  }

  if (cmdName === "status") {
    const currentModel = ctx?.model;
    const modelStr = currentModel ? `${currentModel.provider}/${currentModel.id}` : "Unset";
    const currentThinking = pi.getThinkingLevel();
    const queueLen = queue.length;
    const active = queue.getActiveTurn();
    const statusMsg = `📊 <b>Pi Telegram Status</b>\n
• <b>Active Model:</b> <code>${modelStr}</code>
• <b>Thinking Budget:</b> <code>${currentThinking}</code>
• <b>Queue Depth:</b> <code>${queueLen} pending turn(s)</code>
• <b>Active Turn:</b> <code>${active ? active.id : "idle"}</code>`;
    await api.sendMessage(chatId, statusMsg, messageId, getQuickActionMarkup());
    return true;
  }

  if (cmdName === "abort") {
    try {
      if (ctx && typeof (ctx as any).abort === "function") {
        (ctx as any).abort();
      }
      queue.clearActiveTurn();
      await api.sendMessage(chatId, "🛑 <b>Agent execution aborted.</b>", messageId);
    } catch (err: any) {
      await api.sendMessage(chatId, `❌ Failed to abort: ${err.message}`, messageId);
    }
    return true;
  }

  if (cmdName === "sh" || cmdName === "bash") {
    if (!args) {
      await api.sendMessage(chatId, "⚠️ Usage: <code>/sh &lt;command&gt;</code>", messageId);
      return true;
    }

    execFile(
      "/bin/sh",
      ["-c", args],
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        cwd: getHomeDir(),
      },
      async (error, stdout, stderr) => {
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
        if (error && !output) output = `Process error: ${error.message}`;
        if (!output.trim()) output = "Command completed with no output.";

        if (output.length > 3500) {
          output = output.slice(0, 3500) + "\n... (truncated)";
        }

        const formatted = `💻 <b>Exec:</b> <code>${escapeHtml(args.slice(0, 80))}</code>\n<pre>${escapeHtml(output)}</pre>`;
        await api.sendMessage(chatId, formatted, messageId);
      },
    );
    return true;
  }

  if (cmdName === "upload" || cmdName === "file") {
    if (!args) {
      await api.sendMessage(chatId, "⚠️ Usage: <code>/upload &lt;filepath&gt;</code>", messageId);
      return true;
    }
    const resolved = path.isAbsolute(args) ? args : path.join(getHomeDir(), args);
    if (!fs.existsSync(resolved)) {
      await api.sendMessage(chatId, `❌ File not found: <code>${escapeHtml(resolved)}</code>`, messageId);
      return true;
    }

    await api.sendMediaAuto(chatId, resolved, `📎 ${path.basename(resolved)}`, messageId);
    return true;
  }

  return false;
}
