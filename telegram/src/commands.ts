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
        { text: "🧹 جلسه جدید", callback_data: "cmd_new" },
        { text: "📊 وضعیت", callback_data: "cmd_status" },
      ],
      [
        { text: "🗜️ فشرده‌سازی", callback_data: "cmd_compact" },
        { text: "🛑 لغو", callback_data: "cmd_abort" },
      ],
    ],
  };
}

export async function handleSlashCommand(
  chatId: number,
  messageId: number,
  text: string,
  _senderId: number,
  ctx: ExtensionContext,
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
    await pi.sendUserMessage("/new", { deliverAs: "followUp" });
    await api.sendMessage(chatId, "🧹 <b>Context cleared. Fresh session started!</b>", messageId, getQuickActionMarkup());
    return true;
  }

  if (cmdName === "compact") {
    await pi.sendUserMessage("/compact", { deliverAs: "followUp" });
    await api.sendMessage(chatId, "🗜️ <b>Session history compaction requested.</b>", messageId);
    return true;
  }

  if (cmdName === "model") {
    if (!args) {
      const activeModel = ctx.model ? `${ctx.model.provider} / ${ctx.model.id}` : "unknown";
      await api.sendMessage(chatId, `🧠 <b>Current Model:</b> <code>${activeModel}</code>\n\nUsage: <code>/model &lt;model-name&gt;</code> to switch.`, messageId);
      return true;
    }
    await pi.sendUserMessage(`/model ${args}`, { deliverAs: "followUp" });
    await api.sendMessage(chatId, `🔄 <b>Model switch requested:</b> <code>${escapeHtml(args)}</code>`, messageId);
    return true;
  }

  if (cmdName === "thinking" || cmdName === "think") {
    if (!args) {
      await api.sendMessage(chatId, `🤔 <b>Thinking Budget:</b> <code>${ctx.thinkingBudget || "default"}</code>\n\nUsage: <code>/thinking &lt;tokens|off&gt;</code>`, messageId);
      return true;
    }
    await pi.sendUserMessage(`/thinking ${args}`, { deliverAs: "followUp" });
    await api.sendMessage(chatId, `🧠 <b>Thinking budget set to:</b> <code>${escapeHtml(args)}</code>`, messageId);
    return true;
  }

  if (cmdName === "status") {
    const activeModel = ctx.model ? `${ctx.model.provider} / ${ctx.model.id}` : "unknown";
    const queueLen = queue.length;
    const active = queue.getActiveTurn();
    const statusMsg = `📊 <b>Pi Telegram Status</b>\n
• <b>Active Model:</b> <code>${activeModel}</code>
• <b>Thinking Budget:</b> <code>${ctx.thinkingBudget || "default"}</code>
• <b>Queue Depth:</b> <code>${queueLen} pending turn(s)</code>
• <b>Active Turn:</b> <code>${active ? active.id : "idle"}</code>`;
    await api.sendMessage(chatId, statusMsg, messageId, getQuickActionMarkup());
    return true;
  }

  if (cmdName === "abort") {
    try {
      await pi.abort();
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
