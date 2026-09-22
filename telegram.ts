/**
 * Telegram Bridge Extension for Pi Coding Agent (v2.2 Modular Architecture)
 *
 * High-performance, zero-latency, token-efficient bridge between Telegram and Pi:
 * - Security First: Strict RBAC allowlisting (allowedUsers by numerical ID & allowedUsernames).
 * - Multi-turn FIFO Queue: Concurrency safe with exact message and chat tracking.
 * - In-place Live Progress: Live edit status or reactions while thinking.
 * - Outbound Media Uplink: Auto-uploads generated media (images, plots, PDFs, files) to Telegram chat.
 * - Multimodal Vision: Full support for incoming photos with text captions passed straight to Pi vision.
 * - Direct Shell Execution: /sh <cmd> executes host commands directly without consuming LLM tokens.
 * - Native Slash Commands: /new, /status, /model, /thinking, /compact, /abort, /sh, /upload, /help.
 * - Clean MarkdownV2 / HTML formatting: Automatic escaping, code-block preservation, and BiDi support.
 * - IPv4 Network Resilience: Configured setDefaultResultOrder("ipv4first") to eliminate IPv6 ETIMEDOUT on Node 24.
 * - Safe HTML Fallback: Decodes entities and strips raw HTML tags on fallback to avoid sending unescaped markup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
  AgentEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

import { loadConfig, getHomeDir, formatFileSize } from "./src/telegram/config.js";
import { TelegramApiClient } from "./src/telegram/api.js";
import { TelegramProgressReporter } from "./src/telegram/progress.js";
import { TelegramQueue } from "./src/telegram/queue.js";
import { handleSlashCommand } from "./src/telegram/commands.js";
import { cleanAssistantText, escapeHtml } from "./src/telegram/formatter.js";
import type { PendingTelegramTurn } from "./src/telegram/types.js";

function sendDesktopNotification(title: string, message: string) {
  execFile(
    "notify-send",
    ["-a", "Telegram Bridge", "-u", "normal", "-t", "5000", title, message],
    () => {},
  );
}

export default function (pi: ExtensionAPI) {
  let isRunning = false;
  let pollingAbortController: AbortController | null = null;
  let config = loadConfig();

  const api = new TelegramApiClient(config);
  const queue = new TelegramQueue();
  const progressReporter = new TelegramProgressReporter(api, config.progressCooldownSeconds);
  const createdMediaFiles: string[] = [];

  const mediaWatcher = (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".mp4"].includes(ext)) {
      if (!createdMediaFiles.includes(filePath)) {
        createdMediaFiles.push(filePath);
      }
    }
  };

  // Long Polling Loop
  const startPolling = async (ctx: ExtensionContext) => {
    let offset = 0;
    pollingAbortController = new AbortController();

    while (isRunning) {
      try {
        const url = `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${offset}&timeout=25`;
        const res = await fetch(url, { signal: pollingAbortController.signal });
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        const data = await res.json();
        if (!data.ok || !Array.isArray(data.result)) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        for (const update of data.result) {
          offset = Math.max(offset, update.update_id + 1);

          const msg = update.message;
          if (!msg) continue;

          const senderId = msg.from?.id;
          const username = msg.from?.username || "";
          const chatId = msg.chat?.id;
          const messageId = msg.message_id;

          // Security check (RBAC)
          const isAllowedUser =
            config.allowedUsers.includes(senderId) ||
            (username && config.allowedUsernames.includes(username));

          if (!isAllowedUser) {
            await api.sendMessage(
              chatId,
              "⛔ <b>Access Denied:</b> You are not authorized to interact with this agent.",
              messageId,
            );
            continue;
          }

          const text = msg.text || msg.caption || "";

          // Check for slash commands
          if (text.startsWith("/")) {
            const handled = await handleSlashCommand(chatId, messageId, text, senderId, ctx, pi, api, queue);
            if (handled) continue;
          }

          // Handle Photo / Images
          if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
            const highestPhoto = msg.photo[msg.photo.length - 1];
            api.startTypingLoop(chatId);

            const downloaded = await api.downloadFile(
              highestPhoto.file_id,
              `photo_${highestPhoto.file_unique_id}`,
            );

            if (downloaded) {
              const turn: PendingTelegramTurn = {
                id: queue.makeTxnId(),
                chatId,
                triggerMessageId: messageId,
                senderId,
                senderUsername: username,
                timestamp: Date.now(),
              };
              queue.enqueue(turn);

              const captionHeader = text.trim() ? `${text.trim()}\n\n` : "";
              const promptText = `${captionHeader}[Attached photo: ${downloaded.localPath} (${formatFileSize(downloaded.sizeBytes)})]`;

              pi.sendUserMessage(
                [
                  { type: "text", text: promptText },
                  {
                    type: "image",
                    data: downloaded.data,
                    mimeType: downloaded.mimeType,
                  },
                ],
                { deliverAs: "followUp" },
              );
              continue;
            }
          }

          // Handle Documents / Files
          if (msg.document) {
            api.startTypingLoop(chatId);
            const downloaded = await api.downloadFile(
              msg.document.file_id,
              msg.document.file_name,
            );

            if (downloaded) {
              const turn: PendingTelegramTurn = {
                id: queue.makeTxnId(),
                chatId,
                triggerMessageId: messageId,
                senderId,
                senderUsername: username,
                timestamp: Date.now(),
              };
              queue.enqueue(turn);

              const captionHeader = text.trim() ? `${text.trim()}\n\n` : "";
              const promptText = `${captionHeader}[Attached document: ${downloaded.localPath} (${formatFileSize(downloaded.sizeBytes)})]`;

              pi.sendUserMessage(promptText, { deliverAs: "followUp" });
              continue;
            }
          }

          // Standard Text Message
          if (text) {
            const turn: PendingTelegramTurn = {
              id: queue.makeTxnId(),
              chatId,
              triggerMessageId: messageId,
              senderId,
              senderUsername: username,
              timestamp: Date.now(),
            };
            queue.enqueue(turn);
            api.startTypingLoop(chatId);

            pi.sendUserMessage(text, { deliverAs: "followUp" });
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  // Pi Lifecycle Hooks
  pi.on("turn_start", async (_event: TurnStartEvent, _ctx: ExtensionContext) => {
    if (!queue.isEmpty() && !queue.getActiveTurn()) {
      const active = queue.next();
      if (active) {
        progressReporter.start(active.chatId, active.triggerMessageId);
        api.startTypingLoop(active.chatId);
      }
    }
  });

  pi.on("tool_execution_start", async (event: ToolExecutionStartEvent) => {
    if (!queue.getActiveTurn()) return;
    const argsSummary = event.args ? JSON.stringify(event.args).slice(0, 80) : "";
    await progressReporter.update(
      `⚙️ <b>Executing tool:</b> <code>${escapeHtml(event.toolName)}</code>\n<code>${escapeHtml(argsSummary)}</code>`,
    );
  });

  pi.on("tool_execution_end", async (event: ToolExecutionEndEvent) => {
    if (!queue.getActiveTurn()) return;
    if (event.result && typeof event.result === "string") {
      const match = event.result.match(/(?:\/|~)[^\s"']+\.(?:png|jpe?g|gif|webp|svg|pdf)/gi);
      if (match) {
        for (const p of match) {
          mediaWatcher(p.replace(/~/g, getHomeDir()));
        }
      }
    }
  });

  pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
    const activeTurn = queue.getActiveTurn();
    queue.clearActiveTurn();

    if (!activeTurn) {
      api.stopTypingLoop();
      await progressReporter.cleanup();
      return;
    }

    const { chatId, triggerMessageId } = activeTurn;

    try {
      const assistantMessages = event.messages.filter((m) => m.role === "assistant");
      const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];

      if (lastAssistantMsg) {
        let text = "";
        if (typeof lastAssistantMsg.content === "string") {
          text = lastAssistantMsg.content;
        } else if (Array.isArray(lastAssistantMsg.content)) {
          text = lastAssistantMsg.content
            .filter((part: any) => part.type === "text")
            .map((part: any) => part.text)
            .join("\n");
        }

        const cleaned = cleanAssistantText(text);

        if (cleaned) {
          await progressReporter.cleanup();

          const sentMsgId = await api.sendMessage(
            chatId,
            cleaned,
            triggerMessageId,
          );

          // Upload any media created during turn
          if (createdMediaFiles.length > 0) {
            const files = [...createdMediaFiles];
            createdMediaFiles.length = 0;
            for (const f of files) {
              if (fs.existsSync(f)) {
                await api.sendDocument(chatId, f, `📎 ${path.basename(f)}`, sentMsgId || triggerMessageId);
              }
            }
          }

          sendDesktopNotification("Telegram Bridge", "Pi response delivered to Telegram 🚀");
          if (ctx.hasUI) {
            ctx.ui.notify("Delivered response to Telegram", "info");
          }
        }
      }
    } finally {
      if (queue.isEmpty()) {
        api.stopTypingLoop();
      } else {
        const nextTurn = queue.next();
        if (nextTurn) {
          progressReporter.start(nextTurn.chatId, nextTurn.triggerMessageId);
          api.startTypingLoop(nextTurn.chatId);
        }
      }
    }
  });

  // Start command / auto-start
  const startBridge = (ctx: ExtensionContext) => {
    if (isRunning) return;
    config = loadConfig();
    api.updateConfig(config);
    progressReporter.setCooldown(config.progressCooldownSeconds);

    if (!config.botToken) {
      if (ctx.hasUI) ctx.ui.notify("Telegram bot token not found in config", "error");
      return;
    }
    isRunning = true;
    startPolling(ctx);
    if (ctx.hasUI) ctx.ui.notify("Telegram Bridge started", "info");
  };

  const stopBridge = (ctx: ExtensionContext) => {
    if (!isRunning) return;
    isRunning = false;
    if (pollingAbortController) {
      pollingAbortController.abort();
      pollingAbortController = null;
    }
    api.stopTypingLoop();
    progressReporter.cleanup();
    if (ctx.hasUI) ctx.ui.notify("Telegram Bridge stopped", "info");
  };

  pi.registerCommand("telegram-start", {
    description: "Start Telegram Bridge long-polling service",
    handler: async (_args, ctx) => startBridge(ctx),
  });

  pi.registerCommand("telegram-stop", {
    description: "Stop Telegram Bridge service",
    handler: async (_args, ctx) => stopBridge(ctx),
  });

  pi.registerCommand("telegram-status", {
    description: "Check Telegram Bridge status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Telegram Bridge: ${isRunning ? "RUNNING" : "STOPPED"} (Bot: @pi_miku_bot)`,
        isRunning ? "info" : "warning",
      );
    },
  });

  // Auto-start if enabled
  if (config.autoStart) {
    setTimeout(() => {
      // @ts-ignore
      startBridge({ hasUI: false, ui: { notify: () => {} } });
    }, 1000);
  }
}
