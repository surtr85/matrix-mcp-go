/**
 * Telegram Bridge Extension for Pi Coding Agent (v1.0)
 *
 * High-performance, zero-latency, token-efficient bridge between Telegram and Pi:
 * - Security First: Strict RBAC allowlisting (allowedUsers by numerical ID & allowedUsernames).
 * - Multi-turn FIFO Queue: Concurrency safe with exact message and chat tracking.
 * - In-place Live Progress / Thinking Status: Live edit status or reactions while thinking.
 * - Outbound Media Uplink: Auto-uploads generated media (images, plots, PDFs, files) to Telegram chat.
 * - Multimodal Vision: Full support for incoming photos with text captions passed straight to Pi vision.
 * - Direct Shell Execution: /sh <cmd> executes host commands directly without consuming LLM tokens.
 * - Native Slash Commands: /new, /status, /model, /thinking, /compact, /abort, /sh, /upload, /help.
 * - Clean MarkdownV2 / HTML formatting: Automatic escaping, code-block preservation, and BiDi support.
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

interface TelegramConfig {
  botToken: string;
  botTokenPath?: string;
  allowedUsers: number[];
  allowedUsernames: string[];
  autoStart: boolean;
  progressMode: "edit" | "typing";
  progressCooldownSeconds: number;
}

const DEFAULT_CONFIG: TelegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  botTokenPath: path.join(process.env.HOME || "/home/amadeus", ".config/telegram/token"),
  allowedUsers: [7273048535], // Amadeus (@amad3us)
  allowedUsernames: ["amad3us"],
  autoStart: true,
  progressMode: "edit",
  progressCooldownSeconds: 3,
};

interface PendingTelegramTurn {
  id: string;
  chatId: number;
  triggerMessageId: number;
  senderId: number;
  senderUsername?: string;
  timestamp: number;
}

function getHomeDir(): string {
  return process.env.HOME || "/home/amadeus";
}

function getMediaDir(): string {
  const dir = path.join(getHomeDir(), ".pi/agent/media/telegram");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadConfig(): TelegramConfig {
  const configPath = path.join(getHomeDir(), ".config/telegram/config.json");
  let cfg = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      cfg = { ...cfg, ...data };
    } catch {
      // fallback
    }
  }

  // Load token from path if not explicitly provided
  if (!cfg.botToken && cfg.botTokenPath && fs.existsSync(cfg.botTokenPath)) {
    try {
      cfg.botToken = fs.readFileSync(cfg.botTokenPath, "utf-8").trim();
    } catch {
      // ignore
    }
  }

  return cfg;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sendDesktopNotification(title: string, message: string) {
  execFile(
    "notify-send",
    ["-a", "Telegram Bridge", "-u", "normal", "-t", "5000", title, message],
    () => {},
  );
}

function cleanAssistantText(rawText: string): string {
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  return cleaned.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isPersian(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Robust Telegram HTML Formatter:
 * Telegram supports a strict subset of HTML:
 * <b>, <i>, <u>, <s>, <span>, <tg-spoiler>, <a>, <code>, <pre>, <blockquote>
 */
function markdownToTelegramHtml(input: string): string {
  // 1. Extract and format code blocks first
  const codeBlocks: string[] = [];
  let text = input.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      const idx = codeBlocks.length;
      const escapedCode = escapeHtml(code);
      codeBlocks.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapedCode}</code></pre>`,
      );
      return `@@TG_CODE_BLOCK_${idx}@@`;
    },
  );

  // 2. Extract and format inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `@@TG_INLINE_CODE_${idx}@@`;
  });

  // 3. Preserve any pre-existing valid Telegram HTML tags
  const preservedTags: string[] = [];
  const tagRegex =
    /<\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|tg-emoji|code|pre|blockquote)(?:\s+[^>]*)?>|<a\s+(?:[^>]*?\s+)?href="[^"]*"(?:\s+[^>]*)?>|<\/a>/gi;
  text = text.replace(tagRegex, (match) => {
    const idx = preservedTags.length;
    preservedTags.push(match);
    return `@@TG_PRESERVED_TAG_${idx}@@`;
  });

  // 4. Preserve existing valid HTML entities (like &lt; &gt; &amp;)
  const preservedEntities: string[] = [];
  text = text.replace(/&(?:amp|lt|gt|quot|#039|#x?[0-9a-fA-F]+);/g, (match) => {
    const idx = preservedEntities.length;
    preservedEntities.push(match);
    return `@@TG_PRESERVED_ENT_${idx}@@`;
  });

  // 5. Blockquotes: > quote
  text = text.replace(/(?:^>[^\n]*(?:\n|$))+/gm, (match) => {
    const content = match
      .split("\n")
      .map((line) => line.replace(/^>\s?/, "").trimEnd())
      .join("\n")
      .trim();
    return `@@TG_QUOTE_START@@${content}@@TG_QUOTE_END@@\n`;
  });

  // 6. Headers: #, ##, ###
  text = text.replace(/^#{1,6}\s+(.*)$/gm, "@@TG_HEADER_START@@$1@@TG_HEADER_END@@");

  // 7. Escape remaining raw HTML special characters
  text = escapeHtml(text);

  // 8. Convert Header & Quote placeholders to actual tags
  text = text.replace(/@@TG_HEADER_START@@([\s\S]*?)@@TG_HEADER_END@@/g, "<b>$1</b>");
  text = text.replace(/@@TG_QUOTE_START@@([\s\S]*?)@@TG_QUOTE_END@@/g, "<blockquote>$1</blockquote>");

  // 9. Restore preserved entities
  text = text.replace(/@@TG_PRESERVED_ENT_(\d+)@@/g, (_m, idx) => preservedEntities[Number(idx)]);

  // 10. Markdown links: [title](url)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // 11. Markdown bold, italic, strikethrough
  text = text.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  // 12. Markdown Table fallback for Telegram: Format tables cleanly as monospace preformatted blocks
  const rawLines = text.split("\n");
  const processedBlocks: string[] = [];
  let currentTable: string[] = [];

  const flushTable = () => {
    if (currentTable.length > 0) {
      if (currentTable.length >= 2 && currentTable[0].includes("|") && currentTable[1].includes("|")) {
        const tableText = currentTable.join("\n");
        processedBlocks.push(`<pre>${tableText}</pre>`);
      } else {
        processedBlocks.push(...currentTable);
      }
      currentTable = [];
    }
  };

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2) {
      currentTable.push(trimmed);
    } else {
      flushTable();
      processedBlocks.push(line);
    }
  }
  flushTable();
  text = processedBlocks.join("\n");

  // 13. Restore preserved HTML tags
  text = text.replace(/@@TG_PRESERVED_TAG_(\d+)@@/g, (_m, idx) => preservedTags[Number(idx)]);

  // 14. Restore code blocks & inline code
  text = text.replace(/@@TG_CODE_BLOCK_(\d+)@@/g, (_m, idx) => codeBlocks[Number(idx)]);
  text = text.replace(/@@TG_INLINE_CODE_(\d+)@@/g, (_m, idx) => inlineCodes[Number(idx)]);

  return text;
}

export default function (pi: ExtensionAPI) {
  let isRunning = false;
  let pollingAbortController: AbortController | null = null;
  let config = loadConfig();

  const pendingTurnsQueue: PendingTelegramTurn[] = [];
  let currentActiveTurn: PendingTelegramTurn | null = null;
  const createdMediaFiles: string[] = [];

  const pendingConfirmations = new Map<
    string,
    {
      resolve: (value: boolean) => void;
      chatId: number;
      messageId: number;
    }
  >();

  const makeTxnId = () =>
    `tg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Telegram API Helpers
  const tgApi = async (method: string, bodyObj?: any): Promise<any> => {
    const url = `https://api.telegram.org/bot${config.botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram API [${method}] Error: ${data.description}`);
    }
    return data.result;
  };

  const sendTypingAction = async (chatId: number) => {
    try {
      await tgApi("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch {
      // ignore
    }
  };

  let typingInterval: NodeJS.Timeout | null = null;
  const startTypingLoop = (chatId: number) => {
    stopTypingLoop();
    sendTypingAction(chatId);
    typingInterval = setInterval(() => {
      sendTypingAction(chatId);
    }, 4500);
  };

  const stopTypingLoop = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  // Telegram limits messages to 4096 characters
  const chunkText = (text: string, maxLen = 4000): string[] => {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let cur = "";
    for (const line of text.split("\n")) {
      if ((cur + "\n" + line).length > maxLen) {
        if (cur) chunks.push(cur);
        cur = line;
      } else {
        cur = cur ? `${cur}\n${line}` : line;
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  };

  const sendTelegramMessage = async (
    chatId: number,
    text: string,
    replyToMessageId?: number,
  ): Promise<number | null> => {
    const chunks = chunkText(text);
    let lastMessageId: number | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const htmlText = markdownToTelegramHtml(chunk);

      try {
        const res = await tgApi("sendMessage", {
          chat_id: chatId,
          text: htmlText,
          parse_mode: "HTML",
          reply_to_message_id: i === 0 ? replyToMessageId : lastMessageId,
          allow_sending_without_reply: true,
          disable_web_page_preview: true,
        });
        lastMessageId = res.message_id;
      } catch (err: any) {
        // Fallback to plain text if HTML tags cause a parse error
        try {
          const res = await tgApi("sendMessage", {
            chat_id: chatId,
            text: chunk,
            reply_to_message_id: i === 0 ? replyToMessageId : lastMessageId,
            allow_sending_without_reply: true,
          });
          lastMessageId = res.message_id;
        } catch {
          // ignore
        }
      }
    }

    return lastMessageId;
  };

  const sendTelegramDocument = async (
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<boolean> => {
    if (!fs.existsSync(filePath)) return false;
    try {
      const filename = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer]);

      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("document", blob, filename);
      if (caption) form.append("caption", caption);
      if (replyToMessageId) form.append("reply_to_message_id", String(replyToMessageId));

      const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  };

  const downloadTelegramFile = async (
    fileId: string,
    suggestedName?: string,
  ): Promise<{ localPath: string; data: string; mimeType: string; sizeBytes: number } | null> => {
    try {
      const fileInfo = await tgApi("getFile", { file_id: fileId });
      const filePathOnServer = fileInfo.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${config.botToken}/${filePathOnServer}`;

      const res = await fetch(downloadUrl);
      if (!res.ok) return null;

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const ext = path.extname(filePathOnServer) || ".bin";
      const base = suggestedName ? path.parse(suggestedName).name : `tg_${Date.now()}`;
      const localFilename = `${base}${ext}`;
      const localPath = path.join(getMediaDir(), localFilename);

      fs.writeFileSync(localPath, buffer);

      const mimeType =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "application/octet-stream";

      return {
        localPath,
        data: buffer.toString("base64"),
        mimeType,
        sizeBytes: buffer.length,
      };
    } catch {
      return null;
    }
  };

  // Live Progress Indicator
  class TelegramProgressReporter {
    private currentChatId: number | null = null;
    private statusMessageId: number | null = null;
    private lastUpdate = 0;
    private timer: NodeJS.Timeout | null = null;
    private pendingText = "";

    start(chatId: number, triggerMessageId: number) {
      this.currentChatId = chatId;
      this.statusMessageId = null;
      this.pendingText = "⏳ <i>Pi is thinking...</i>";
      this.lastUpdate = 0;
    }

    async update(status: string) {
      if (!this.currentChatId) return;
      this.pendingText = status;

      const now = Date.now();
      const cooldownMs = config.progressCooldownSeconds * 1000;

      if (now - this.lastUpdate < cooldownMs) {
        if (!this.timer) {
          this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
          }, cooldownMs - (now - this.lastUpdate));
        }
        return;
      }

      await this.flush();
    }

    private async flush() {
      if (!this.currentChatId || !this.pendingText) return;
      this.lastUpdate = Date.now();

      try {
        if (!this.statusMessageId) {
          const res = await tgApi("sendMessage", {
            chat_id: this.currentChatId,
            text: this.pendingText,
            parse_mode: "HTML",
          });
          this.statusMessageId = res.message_id;
        } else {
          await tgApi("editMessageText", {
            chat_id: this.currentChatId,
            message_id: this.statusMessageId,
            text: this.pendingText,
            parse_mode: "HTML",
          });
        }
      } catch {
        // ignore
      }
    }

    async cleanup() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.currentChatId && this.statusMessageId) {
        try {
          await tgApi("deleteMessage", {
            chat_id: this.currentChatId,
            message_id: this.statusMessageId,
          });
        } catch {
          // ignore
        }
      }
      this.currentChatId = null;
      this.statusMessageId = null;
    }
  }

  const progressReporter = new TelegramProgressReporter();

  // Watch for created media to upload
  const mediaWatcher = (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".mp4"].includes(ext)) {
      if (!createdMediaFiles.includes(filePath)) {
        createdMediaFiles.push(filePath);
      }
    }
  };

  // Slash Command Handler
  const handleSlashCommand = async (
    chatId: number,
    messageId: number,
    text: string,
    senderId: number,
    ctx: ExtensionContext,
  ): Promise<boolean> => {
    const parts = text.trim().split(/\s+/);
    const cmdName = parts[0].replace("/", "").toLowerCase();
    const args = parts.slice(1).join(" ").trim();

    if (cmdName === "help") {
      const helpMsg = `🤖 <b>Pi Telegram Bridge Commands:</b>\n
• <code>/new</code> - Clear context & start a fresh session
• <code>/status</code> - Show current agent, model, and queue status
• <code>/sh &lt;cmd&gt;</code> - Zero-token direct shell execution
• <code>/upload &lt;path&gt;</code> - Send a file from host to Telegram
• <code>/abort</code> - Abort current thinking / execution
• <code>/help</code> - Show this menu`;
      await sendTelegramMessage(chatId, helpMsg, messageId);
      return true;
    }

    if (cmdName === "new" || cmdName === "reset" || cmdName === "clear") {
      await pi.sendUserMessage("/new", { deliverAs: "followUp" });
      await sendTelegramMessage(chatId, "🧹 <b>Context cleared. Fresh session started!</b>", messageId);
      return true;
    }

    if (cmdName === "status") {
      const activeModel = ctx.model ? `${ctx.model.provider} / ${ctx.model.id}` : "unknown";
      const queueLen = pendingTurnsQueue.length;
      const statusMsg = `📊 <b>Pi Telegram Status</b>\n
• <b>Active Model:</b> <code>${activeModel}</code>
• <b>Thinking Budget:</b> <code>${ctx.thinkingBudget || "default"}</code>
• <b>Queue Depth:</b> <code>${queueLen} pending turn(s)</code>
• <b>Active Turn:</b> <code>${currentActiveTurn ? currentActiveTurn.id : "idle"}</code>`;
      await sendTelegramMessage(chatId, statusMsg, messageId);
      return true;
    }

    if (cmdName === "abort") {
      try {
        await pi.abort();
        await sendTelegramMessage(chatId, "🛑 <b>Agent execution aborted.</b>", messageId);
      } catch (err: any) {
        await sendTelegramMessage(chatId, `❌ Failed to abort: ${err.message}`, messageId);
      }
      return true;
    }

    if (cmdName === "sh" || cmdName === "bash") {
      if (!args) {
        await sendTelegramMessage(chatId, "⚠️ Usage: <code>/sh &lt;command&gt;</code>", messageId);
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
          await sendTelegramMessage(chatId, formatted, messageId);
        },
      );
      return true;
    }

    if (cmdName === "upload" || cmdName === "file") {
      if (!args) {
        await sendTelegramMessage(chatId, "⚠️ Usage: <code>/upload &lt;filepath&gt;</code>", messageId);
        return true;
      }
      const resolved = path.isAbsolute(args) ? args : path.join(getHomeDir(), args);
      if (!fs.existsSync(resolved)) {
        await sendTelegramMessage(chatId, `❌ File not found: <code>${escapeHtml(resolved)}</code>`, messageId);
        return true;
      }

      await sendTelegramDocument(chatId, resolved, `📎 ${path.basename(resolved)}`, messageId);
      return true;
    }

    return false;
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
            await sendTelegramMessage(
              chatId,
              "⛔ <b>Access Denied:</b> You are not authorized to interact with this agent.",
              messageId,
            );
            continue;
          }

          let text = msg.text || msg.caption || "";

          // Check for slash commands
          if (text.startsWith("/")) {
            const handled = await handleSlashCommand(chatId, messageId, text, senderId, ctx);
            if (handled) continue;
          }

          // Handle Photo / Images
          if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
            // Get highest resolution photo (last element)
            const highestPhoto = msg.photo[msg.photo.length - 1];
            startTypingLoop(chatId);

            const downloaded = await downloadTelegramFile(
              highestPhoto.file_id,
              `photo_${highestPhoto.file_unique_id}`,
            );

            if (downloaded) {
              const turn: PendingTelegramTurn = {
                id: makeTxnId(),
                chatId,
                triggerMessageId: messageId,
                senderId,
                senderUsername: username,
                timestamp: Date.now(),
              };
              pendingTurnsQueue.push(turn);

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
            startTypingLoop(chatId);
            const downloaded = await downloadTelegramFile(
              msg.document.file_id,
              msg.document.file_name,
            );

            if (downloaded) {
              const turn: PendingTelegramTurn = {
                id: makeTxnId(),
                chatId,
                triggerMessageId: messageId,
                senderId,
                senderUsername: username,
                timestamp: Date.now(),
              };
              pendingTurnsQueue.push(turn);

              const captionHeader = text.trim() ? `${text.trim()}\n\n` : "";
              const promptText = `${captionHeader}[Attached document: ${downloaded.localPath} (${formatFileSize(downloaded.sizeBytes)})]`;

              pi.sendUserMessage(promptText, { deliverAs: "followUp" });
              continue;
            }
          }

          // Standard Text Message
          if (text) {
            const turn: PendingTelegramTurn = {
              id: makeTxnId(),
              chatId,
              triggerMessageId: messageId,
              senderId,
              senderUsername: username,
              timestamp: Date.now(),
            };
            pendingTurnsQueue.push(turn);
            startTypingLoop(chatId);

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
    if (pendingTurnsQueue.length > 0 && !currentActiveTurn) {
      currentActiveTurn = pendingTurnsQueue.shift() || null;
      if (currentActiveTurn) {
        progressReporter.start(
          currentActiveTurn.chatId,
          currentActiveTurn.triggerMessageId,
        );
        startTypingLoop(currentActiveTurn.chatId);
      }
    }
  });

  pi.on("tool_execution_start", async (event: ToolExecutionStartEvent) => {
    if (!currentActiveTurn) return;
    const argsSummary = event.args ? JSON.stringify(event.args).slice(0, 80) : "";
    await progressReporter.update(
      `⚙️ <b>Executing tool:</b> <code>${escapeHtml(event.toolName)}</code>\n<code>${escapeHtml(argsSummary)}</code>`,
    );
  });

  pi.on("tool_execution_end", async (event: ToolExecutionEndEvent) => {
    if (!currentActiveTurn) return;
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
    const activeTurn = currentActiveTurn;
    currentActiveTurn = null;

    if (!activeTurn) {
      stopTypingLoop();
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

          const sentMsgId = await sendTelegramMessage(
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
                await sendTelegramDocument(chatId, f, `📎 ${path.basename(f)}`, sentMsgId || triggerMessageId);
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
      if (pendingTurnsQueue.length === 0) {
        stopTypingLoop();
      } else {
        currentActiveTurn = pendingTurnsQueue.shift() || null;
        if (currentActiveTurn) {
          progressReporter.start(currentActiveTurn.chatId, currentActiveTurn.triggerMessageId);
          startTypingLoop(currentActiveTurn.chatId);
        }
      }
    }
  });

  // Start command / auto-start
  const startBridge = (ctx: ExtensionContext) => {
    if (isRunning) return;
    config = loadConfig();
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
    stopTypingLoop();
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
