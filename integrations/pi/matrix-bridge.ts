/**
 * Matrix Bridge Extension for Pi Coding Agent
 *
 * Dedicated high-performance, token-efficient, zero-cost bridge between Matrix (matrix.kurisu.ir) and Pi:
 * - Direct session injection via `pi.sendUserMessage()` with zero subagent token bloat.
 * - Long-polling Matrix sync with persistent disk-backed sync tokens (~/.pi/agent/matrix_sync_token).
 * - Real-time progress reporter with debounced cooldown for tool calls (`bash`, `read`, `write`, `edit`) & thinking.
 * - In-place Matrix live status updates via `m.replace` (MSC2676) to avoid room spam.
 * - Immediate read receipts (`m.read`) and receipt reaction (`👀`).
 * - Multimodal support: automatically downloads `mxc://` media and attaches native ImageContent.
 * - Matrix control commands: `/new`, `/status`, `/model`, `/thinking`, `/compact`, `/help`.
 * - Clean Markdown-to-HTML converter with Persian BiDi (RTL for Persian, LTR for code blocks).
 * - Automatic thinking tag `<think>...</think>` sanitization.
 * - Task completion reaction (`✅`) and secure desktop notifications via `execFile`.
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

interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  botUserId: string;
  allowedUsers: string[];
  autoStart: boolean;
  useSubagent: boolean;
  subagentRole?: "delegate" | "worker";
  progressCooldownSeconds: number;
  progressMode: "edit" | "message";
}

const DEFAULT_CONFIG: MatrixConfig = {
  homeserver: "https://matrix.kurisu.ir",
  accessToken: "OQ2ggM7Yj7IMDM9Ir92ChMrSV8MMMubp",
  botUserId: "@miku:matrix.kurisu.ir",
  allowedUsers: ["@amadeus:matrix.kurisu.ir"],
  autoStart: true,
  useSubagent: false,
  subagentRole: "delegate",
  progressCooldownSeconds: 5,
  progressMode: "edit",
};

function getHomeDir(): string {
  return process.env.HOME || "/home/amadeus";
}

function getSyncTokenPath(): string {
  return path.join(getHomeDir(), ".pi/agent/matrix_sync_token");
}

function loadConfig(): MatrixConfig {
  const configPath = path.join(getHomeDir(), ".pi/agent/matrix.json");
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return { ...DEFAULT_CONFIG, ...data };
    } catch {
      // Fallback to defaults
    }
  }
  return DEFAULT_CONFIG;
}

function loadSavedSyncToken(): string | null {
  const tokenFile = getSyncTokenPath();
  try {
    if (fs.existsSync(tokenFile)) {
      const token = fs.readFileSync(tokenFile, "utf-8").trim();
      return token.length > 0 ? token : null;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

function saveSyncToken(token: string) {
  try {
    const tokenFile = getSyncTokenPath();
    fs.writeFileSync(tokenFile, token.trim(), "utf-8");
  } catch {
    // Ignore write errors
  }
}

function sendDesktopNotification(title: string, message: string) {
  execFile(
    "notify-send",
    ["-a", "Matrix Bridge", "-u", "normal", "-t", "5000", title, message],
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isPersian(text: string): boolean {
  const textWithoutCode = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/https?:\/\/\S+/g, "");

  const persianRegex = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const firstStrong = textWithoutCode.match(
    /[A-Za-z]|[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/,
  );
  if (firstStrong) {
    return persianRegex.test(firstStrong[0]);
  }
  return persianRegex.test(textWithoutCode);
}

function markdownToMatrixHtml(md: string): string {
  const codeBlocks: string[] = [];
  let workingText = md.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      const idx = codeBlocks.length;
      const escapedCode = escapeHtml(code);
      codeBlocks.push(
        `<div dir="ltr" style="text-align: left;"><pre><code${
          lang ? ` class="language-${lang}"` : ""
        }>${escapedCode}</code></pre></div>`,
      );
      return `@@CODE_BLOCK_${idx}@@`;
    },
  );

  const inlineCodes: string[] = [];
  workingText = workingText.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code dir="ltr">${escapeHtml(code)}</code>`);
    return `@@INLINE_CODE_${idx}@@`;
  });

  workingText = escapeHtml(workingText);

  // Markdown formats
  workingText = workingText.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  workingText = workingText.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const lines = workingText.split("\n");
  const processedLines = lines.map((line) => {
    if (!line.trim()) return "<br/>";
    if (line.includes("@@CODE_BLOCK_")) return line;
    const rtl = isPersian(line);
    const dir = rtl ? "rtl" : "ltr";
    const align = rtl ? "right" : "left";
    return `<div dir="${dir}" style="text-align: ${align};">${line}</div>`;
  });

  let html = processedLines.join("");

  inlineCodes.forEach((code, idx) => {
    html = html.replace(`@@INLINE_CODE_${idx}@@`, code);
  });
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`@@CODE_BLOCK_${idx}@@`, block);
  });

  return html;
}

async function downloadMatrixMedia(
  homeserver: string,
  token: string,
  mxcUrl: string,
): Promise<{ data: string; mimeType: string } | null> {
  if (!mxcUrl.startsWith("mxc://")) return null;
  const [serverName, mediaId] = mxcUrl.slice(6).split("/");
  if (!serverName || !mediaId) return null;

  try {
    const downloadUrl = `${homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(
      serverName,
    )}/${encodeURIComponent(mediaId)}`;
    const res = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const mimeType = res.headers.get("content-type") || "image/png";
    const arrayBuf = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    return { data: base64, mimeType };
  } catch {
    return null;
  }
}

class BoundedEventCache {
  private set = new Set<string>();
  private list: string[] = [];
  constructor(private maxSize = 1000) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string) {
    if (this.set.has(id)) return;
    if (this.list.length >= this.maxSize) {
      const oldest = this.list.shift();
      if (oldest) this.set.delete(oldest);
    }
    this.list.push(id);
    this.set.add(id);
  }
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  let isPolling = false;
  let abortController: AbortController | null = null;
  let lastSyncBatch: string | null = loadSavedSyncToken();
  let activeRoomId: string | null = null;
  let currentTriggerEventId: string | null = null;
  let pendingResponse = false;
  let typingTimer: NodeJS.Timeout | null = null;
  let typingRoomId: string | null = null;
  const processedEventIds = new BoundedEventCache(1000);

  let latestContext: ExtensionContext | null = null;

  // Matrix API Helpers
  const makeTxnId = () =>
    `m${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const sendMatrixMessage = async (
    roomId: string,
    text: string,
    inReplyToEventId?: string,
  ): Promise<string | null> => {
    try {
      const cleanText = cleanAssistantText(text);
      if (!cleanText) return null;

      const formattedHtml = markdownToMatrixHtml(cleanText);
      const txnId = makeTxnId();
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/send/m.room.message/${txnId}`;

      const bodyPayload: any = {
        msgtype: "m.text",
        body: cleanText,
        format: "org.matrix.custom.html",
        formatted_body: formattedHtml,
      };

      if (inReplyToEventId) {
        bodyPayload["m.relates_to"] = {
          "m.in_reply_to": {
            event_id: inReplyToEventId,
          },
        };
      }

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.event_id || null;
    } catch {
      return null;
    }
  };

  const editMatrixMessage = async (
    roomId: string,
    originalEventId: string,
    newText: string,
  ): Promise<boolean> => {
    try {
      const cleanText = cleanAssistantText(newText);
      if (!cleanText) return false;

      const formattedHtml = markdownToMatrixHtml(cleanText);
      const txnId = makeTxnId();
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/send/m.room.message/${txnId}`;

      const payload = {
        msgtype: "m.text",
        body: `* ${cleanText}`,
        format: "org.matrix.custom.html",
        formatted_body: `* ${formattedHtml}`,
        "m.new_content": {
          msgtype: "m.text",
          body: cleanText,
          format: "org.matrix.custom.html",
          formatted_body: formattedHtml,
        },
        "m.relates_to": {
          rel_type: "m.replace",
          event_id: originalEventId,
        },
      };

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return res.ok;
    } catch {
      return false;
    }
  };

  const sendReaction = async (
    roomId: string,
    targetEventId: string,
    emoji: string,
  ): Promise<boolean> => {
    try {
      const txnId = makeTxnId();
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/send/m.reaction/${txnId}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          "m.relates_to": {
            rel_type: "m.annotation",
            event_id: targetEventId,
            key: emoji,
          },
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  };

  const sendReadReceipt = async (
    roomId: string,
    eventId: string,
  ): Promise<void> => {
    try {
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/receipt/m.read/${encodeURIComponent(eventId)}`;
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
    } catch {
      // Ignore receipt errors
    }
  };

  const setTyping = async (roomId: string, typing: boolean): Promise<void> => {
    try {
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/typing/${encodeURIComponent(config.botUserId)}`;
      await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ typing, timeout: typing ? 30000 : 0 }),
      });
    } catch {
      // Ignore typing errors
    }
  };

  const startTypingLoop = (roomId: string) => {
    stopTypingLoop();
    typingRoomId = roomId;
    setTyping(roomId, true);
    typingTimer = setInterval(() => {
      if (typingRoomId) {
        setTyping(typingRoomId, true);
      }
    }, 20000);
  };

  const stopTypingLoop = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (typingRoomId) {
      const prevRoom = typingRoomId;
      typingRoomId = null;
      setTyping(prevRoom, false);
    }
  };

  /**
   * Real-time Progress Reporter with Cooldown/Debounce
   */
  class ProgressReporter {
    private active = false;
    private roomId: string | null = null;
    private replyToEventId: string | null = null;
    private progressMessageId: string | null = null;
    private lastReportTime = 0;
    private cooldownMs: number;
    private pendingStatus: string | null = null;
    private flushTimeout: NodeJS.Timeout | null = null;

    constructor() {
      this.cooldownMs = Math.max(2, config.progressCooldownSeconds || 5) * 1000;
    }

    start(roomId: string, replyToEventId: string) {
      this.reset();
      this.active = true;
      this.roomId = roomId;
      this.replyToEventId = replyToEventId;
      this.lastReportTime = 0;
    }

    report(statusText: string) {
      if (!this.active || !this.roomId) return;

      const now = Date.now();
      const elapsed = now - this.lastReportTime;

      if (elapsed >= this.cooldownMs) {
        this.emitStatus(statusText);
      } else {
        this.pendingStatus = statusText;
        if (!this.flushTimeout) {
          const remaining = this.cooldownMs - elapsed;
          this.flushTimeout = setTimeout(() => {
            this.flushTimeout = null;
            if (this.pendingStatus && this.active) {
              const text = this.pendingStatus;
              this.pendingStatus = null;
              this.emitStatus(text);
            }
          }, remaining);
        }
      }
    }

    private async emitStatus(statusText: string) {
      if (!this.active || !this.roomId) return;
      this.lastReportTime = Date.now();

      const formatted = `⏳ **${statusText}**`;

      if (config.progressMode === "edit") {
        if (!this.progressMessageId) {
          this.progressMessageId = await sendMatrixMessage(
            this.roomId,
            formatted,
            this.replyToEventId || undefined,
          );
        } else {
          await editMatrixMessage(
            this.roomId,
            this.progressMessageId,
            formatted,
          );
        }
      } else {
        // Message mode: post fresh message if cooldown elapsed
        await sendMatrixMessage(
          this.roomId,
          formatted,
          this.replyToEventId || undefined,
        );
      }
    }

    async finish(completedMessage?: string) {
      if (!this.active) return;
      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
        this.flushTimeout = null;
      }
      this.pendingStatus = null;

      if (
        this.progressMessageId &&
        config.progressMode === "edit" &&
        this.roomId
      ) {
        const text = completedMessage || "✅ **پردازش به اتمام رسید.**";
        await editMatrixMessage(this.roomId, this.progressMessageId, text);
      }

      this.reset();
    }

    reset() {
      this.active = false;
      this.roomId = null;
      this.replyToEventId = null;
      this.progressMessageId = null;
      this.pendingStatus = null;
      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
        this.flushTimeout = null;
      }
    }
  }

  const progressReporter = new ProgressReporter();

  // Handle Slash Commands
  const handleMatrixCommand = async (
    roomId: string,
    commandText: string,
    sender: string,
    replyToId: string,
  ): Promise<boolean> => {
    const trimmed = commandText.trim();
    if (!trimmed.startsWith("/")) return false;

    const [cmdNameRaw, ...restParts] = trimmed.slice(1).split(" ");
    const cmdName = cmdNameRaw.toLowerCase();
    const args = restParts.join(" ").trim();

    // 1. /new, /reset, /clear
    if (cmdName === "new" || cmdName === "reset" || cmdName === "clear") {
      try {
        pi.sendUserMessage("/new_session", { expandPromptTemplates: true });
        await sendMatrixMessage(
          roomId,
          "✨ **جلسه جدید با موفقیت آغاز شد.** (New session started)",
          replyToId,
        );
      } catch (err: any) {
        await sendMatrixMessage(
          roomId,
          `❌ خطا در ایجاد جلسه جدید: ${err.message || String(err)}`,
          replyToId,
        );
      }
      return true;
    }

    // 2. /status or /info or /session
    if (cmdName === "status" || cmdName === "info" || cmdName === "session") {
      let statsText = "";
      try {
        const session = (latestContext as any)?.session;
        if (session && typeof session.getSessionStats === "function") {
          const stats = session.getSessionStats();
          statsText = [
            `📊 **آمار نشست:**`,
            `- پیام‌ها: ${stats.totalMessages} (کاربر: ${stats.userMessages}, پاسخ: ${stats.assistantMessages})`,
            `- ابزارها: ${stats.toolCalls} فراخوانی`,
            `- توکن‌ها: مجموعاً ${stats.tokens?.total?.toLocaleString() || 0}`,
          ].join("\n");
        }
      } catch {}

      const currentModel = latestContext?.model;
      const currentThinking = pi.getThinkingLevel();

      const msg = [
        `📡 **وضعیت ماتریکس بریج اختصاصی Pi:**`,
        `- اتصال: ${isPolling ? "🟢 متصل و فعال" : "🔴 متوقف"}`,
        `- حالت اجرا: ${config.useSubagent ? `⚡ ساب‌ایجنت (${config.subagentRole})` : "🚀 مستقیم و سبک (Direct)"}`,
        `- مدل جاری: \`${currentModel ? `${currentModel.provider}/${currentModel.id}` : "تنظیم‌نشده"}\``,
        `- سطح تفکر (Thinking): \`${currentThinking}\``,
        `- کول‌داون پیشرفت: \`${config.progressCooldownSeconds}s\` (حالت: \`${config.progressMode}\`)`,
        statsText,
      ]
        .filter(Boolean)
        .join("\n");

      await sendMatrixMessage(roomId, msg, replyToId);
      return true;
    }

    // 3. /model [model_id]
    if (cmdName === "model") {
      if (!args) {
        const currentModel = latestContext?.model;
        await sendMatrixMessage(
          roomId,
          `🤖 **مدل فعلی:** \`${currentModel ? `${currentModel.provider}/${currentModel.id}` : "تنظیم‌نشده"}\``,
          replyToId,
        );
        return true;
      }
      try {
        const available =
          latestContext?.scopedModels && latestContext.scopedModels.length > 0
            ? latestContext.scopedModels.map((sm) => sm.model)
            : latestContext?.modelRegistry?.getAvailable() || [];

        const match = available.find(
          (m) =>
            m.id.toLowerCase() === args.toLowerCase() ||
            `${m.provider}/${m.id}`.toLowerCase() === args.toLowerCase(),
        );
        if (match) {
          const success = await pi.setModel(match);
          if (success) {
            await sendMatrixMessage(
              roomId,
              `✅ مدل به **${match.provider}/${match.id}** تغییر یافت.`,
              replyToId,
            );
          } else {
            await sendMatrixMessage(
              roomId,
              `❌ احراز هویت برای مدل ${match.provider}/${match.id} ناموفق بود.`,
              replyToId,
            );
          }
        } else {
          const availableList = available
            .map((m) => `\`${m.provider}/${m.id}\``)
            .join(", ");
          await sendMatrixMessage(
            roomId,
            `⚠️ مدل \`${args}\` یافت نشد.\nمدل‌های در دسترس:\n${availableList || "موردی یافت نشد"}`,
            replyToId,
          );
        }
      } catch (err: any) {
        await sendMatrixMessage(
          roomId,
          `❌ خطا در تغییر مدل: ${err.message || String(err)}`,
          replyToId,
        );
      }
      return true;
    }

    // 4. /thinking [level]
    if (cmdName === "thinking") {
      if (!args) {
        const currentLevel = pi.getThinkingLevel();
        await sendMatrixMessage(
          roomId,
          `🧠 **سطح تفکر فعلی:** \`${currentLevel}\``,
          replyToId,
        );
        return true;
      }
      try {
        const level = args.toLowerCase() as any;
        pi.setThinkingLevel(level);
        await sendMatrixMessage(
          roomId,
          `🧠 سطح تفکر به **${args}** تغییر یافت.`,
          replyToId,
        );
      } catch (err: any) {
        await sendMatrixMessage(
          roomId,
          `❌ خطا در تنظیم سطح تفکر: ${err.message || String(err)}`,
          replyToId,
        );
      }
      return true;
    }

    // 5. /compact
    if (cmdName === "compact") {
      try {
        await sendMatrixMessage(
          roomId,
          "⏳ **فرآیند خلاصه‌سازی کانتکست (Compact) آغاز شد...**",
          replyToId,
        );
        pi.sendUserMessage(args ? `/compact ${args}` : "/compact", {
          expandPromptTemplates: true,
        });
      } catch (err: any) {
        await sendMatrixMessage(
          roomId,
          `❌ خطا در فشرده‌سازی: ${err.message || String(err)}`,
          replyToId,
        );
      }
      return true;
    }

    // 6. /help
    if (cmdName === "help") {
      const helpMsg = [
        `🛠️ **دستورات کنترلی ماتریکس برای Pi:**`,
        `- \`/new\` یا \`/reset\`: شروع یک جلسه تازه`,
        `- \`/status\`: وضعیت اتصال، مدل و آمار توکن‌ها`,
        `- \`/model [نام]\`: مشاهده یا تغییر مدل جاری`,
        `- \`/thinking [off|low|medium|high|max]\`: تنظیم سطح تفکر`,
        `- \`/compact [دستور]\`: خلاصه‌سازی تاریخچه چت`,
        `- \`/help\`: مشاهده این راهنما`,
      ].join("\n");
      await sendMatrixMessage(roomId, helpMsg, replyToId);
      return true;
    }

    return false;
  };

  const handleInvites = async (invites: Record<string, any>) => {
    for (const roomId of Object.keys(invites)) {
      try {
        const inviteEvents = invites[roomId]?.invite_state?.events || [];
        const joinRule = inviteEvents.find(
          (e: any) =>
            e.type === "m.room.member" && e.state_key === config.botUserId,
        );
        const inviter = joinRule?.sender;

        if (
          inviter &&
          (config.allowedUsers.length === 0 ||
            config.allowedUsers.includes(inviter))
        ) {
          await fetch(
            `${config.homeserver}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            },
          );
          activeRoomId = roomId;
        }
      } catch {
        // Ignore join errors
      }
    }
  };

  const syncLoop = async (ctx?: ExtensionContext) => {
    if (isPolling) return;
    isPolling = true;
    abortController = new AbortController();

    // If no saved sync token, perform quick catch-up sync (timeout=0)
    if (!lastSyncBatch) {
      try {
        const initialRes = await fetch(
          `${config.homeserver}/_matrix/client/v3/sync?timeout=0`,
          {
            headers: { Authorization: `Bearer ${config.accessToken}` },
            signal: abortController.signal,
          },
        );
        if (initialRes.ok) {
          const initialData = await initialRes.json();
          if (initialData.next_batch) {
            lastSyncBatch = initialData.next_batch;
            saveSyncToken(lastSyncBatch);
          }
        }
      } catch {
        // Fallback to regular sync
      }
    }

    if (ctx?.hasUI) {
      ctx.ui.notify(
        `Matrix Bridge connected (${config.useSubagent ? `Subagent: ${config.subagentRole}` : "Direct Mode"})`,
        "info",
      );
    }

    while (isPolling) {
      try {
        const syncUrl = new URL(`${config.homeserver}/_matrix/client/v3/sync`);
        syncUrl.searchParams.set("timeout", "30000");
        if (lastSyncBatch) {
          syncUrl.searchParams.set("since", lastSyncBatch);
        }

        const res = await fetch(syncUrl.toString(), {
          headers: { Authorization: `Bearer ${config.accessToken}` },
          signal: abortController?.signal,
        });

        if (!res.ok) {
          let waitMs = 5000;
          if (res.status === 429) {
            try {
              const errJson = await res.json();
              if (errJson.retry_after_ms) {
                waitMs = errJson.retry_after_ms;
              }
            } catch {}
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        const data = await res.json();

        if (data.rooms?.invite) {
          await handleInvites(data.rooms.invite);
        }

        const joinedRooms = data.rooms?.join || {};
        for (const roomId of Object.keys(joinedRooms)) {
          const events = joinedRooms[roomId]?.timeline?.events || [];
          for (const ev of events) {
            if (
              ev.type === "m.room.message" &&
              ev.sender !== config.botUserId
            ) {
              if (processedEventIds.has(ev.event_id)) continue;
              processedEventIds.add(ev.event_id);

              if (
                config.allowedUsers.length > 0 &&
                !config.allowedUsers.includes(ev.sender)
              ) {
                continue;
              }

              const msgtype = ev.content?.msgtype;
              const rawBody = ev.content?.body || "";
              const mxcUrl = ev.content?.url;

              activeRoomId = roomId;
              currentTriggerEventId = ev.event_id;
              pendingResponse = true;

              // 1. Send read receipt & react with '👀'
              sendReadReceipt(roomId, ev.event_id);
              sendReaction(roomId, ev.event_id, "👀");

              // 2. Start typing indicator
              startTypingLoop(roomId);

              // 3. Desktop notification
              sendDesktopNotification(
                `Matrix: ${ev.sender}`,
                msgtype === "m.image"
                  ? "📷 [Image attachment]"
                  : rawBody.slice(0, 100),
              );

              // 4. Handle commands
              if (
                typeof rawBody === "string" &&
                rawBody.trim().startsWith("/")
              ) {
                stopTypingLoop();
                pendingResponse = false;
                const handled = await handleMatrixCommand(
                  roomId,
                  rawBody.trim(),
                  ev.sender,
                  ev.event_id,
                );
                if (handled) {
                  continue;
                }
                pendingResponse = true;
                startTypingLoop(roomId);
              }

              // 5. Initialize Progress Reporter for this turn
              progressReporter.start(roomId, ev.event_id);

              // 6. Multimodal Image or Text Injection
              if (msgtype === "m.image" && mxcUrl) {
                const media = await downloadMatrixMedia(
                  config.homeserver,
                  config.accessToken,
                  mxcUrl,
                );
                if (media) {
                  pi.sendUserMessage([
                    {
                      type: "text",
                      text: rawBody
                        ? `[Matrix Image: ${rawBody}]`
                        : "[Matrix Image]",
                    },
                    {
                      type: "image",
                      data: media.data,
                      mimeType: media.mimeType,
                    },
                  ]);
                  continue;
                }
              }

              // Normal text injection: clean, direct, zero subagent overhead
              if (typeof rawBody === "string" && rawBody.trim().length > 0) {
                if (config.useSubagent) {
                  const subagentPrompt = `[Matrix @${ev.sender}]:\n${rawBody}\n\n[Instruction: Delegate to ${config.subagentRole} subagent and return final answer.]`;
                  pi.sendUserMessage(subagentPrompt);
                } else {
                  pi.sendUserMessage(rawBody);
                }
              }
            }
          }
        }

        if (data.next_batch) {
          lastSyncBatch = data.next_batch;
          saveSyncToken(lastSyncBatch);
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || !isPolling) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  };

  const stopSyncLoop = () => {
    isPolling = false;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    stopTypingLoop();
    progressReporter.reset();
  };

  // --- Pi Lifecycle Hooks ---

  // Progress Reporting: Turn Start (Thinking)
  pi.on("turn_start", async (_event: TurnStartEvent) => {
    if (pendingResponse && activeRoomId) {
      progressReporter.report("🧠 در حال بررسی و پردازش درخواست...");
    }
  });

  // Progress Reporting: Tool Execution Start
  pi.on("tool_execution_start", async (event: ToolExecutionStartEvent) => {
    if (!pendingResponse || !activeRoomId) return;

    let desc = "";
    switch (event.toolName) {
      case "bash": {
        const cmd = event.args?.command
          ? ` \`${event.args.command.slice(0, 60)}\``
          : "";
        desc = `⚙️ اجرای دستور شل:${cmd}`;
        break;
      }
      case "read": {
        const p = event.args?.path
          ? ` \`${path.basename(event.args.path)}\``
          : "";
        desc = `📖 خواندن فایل${p}`;
        break;
      }
      case "edit":
      case "write": {
        const p = event.args?.path
          ? ` \`${path.basename(event.args.path)}\``
          : "";
        desc = `✏️ ویرایش فایل${p}`;
        break;
      }
      case "grep":
      case "find":
      case "ls": {
        desc = `🔍 جستجو و بازرسی در مسیرها (${event.toolName})`;
        break;
      }
      default: {
        desc = `🔧 اجرای ابزار \`${event.toolName}\``;
        break;
      }
    }

    progressReporter.report(desc);
  });

  // Progress Reporting: Tool Execution End (Error flag)
  pi.on("tool_execution_end", async (event: ToolExecutionEndEvent) => {
    if (pendingResponse && activeRoomId && event.isError) {
      progressReporter.report(
        `⚠️ بروز خطا در اجرای ابزار \`${event.toolName}\``,
      );
    }
  });

  // Final Outbound Delivery: Agent End
  pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
    if (!pendingResponse || !activeRoomId || !currentTriggerEventId) return;

    const targetRoomId = activeRoomId;
    const targetTriggerId = currentTriggerEventId;

    try {
      const assistantMessages = event.messages.filter(
        (m) => m.role === "assistant",
      );
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

        if (text) {
          // Send final answer as in_reply_to
          const sentEventId = await sendMatrixMessage(
            targetRoomId,
            text,
            targetTriggerId,
          );

          if (sentEventId) {
            // Mark original message with ✅
            sendReaction(targetRoomId, targetTriggerId, "✅");

            // Finalize progress message
            await progressReporter.finish("✅ **پاسخ آماده و ارسال شد.**");

            // Safe desktop notification
            sendDesktopNotification(
              "Matrix Bridge",
              "پاسخ دستیار Pi به ماتریکس ارسال شد 🚀",
            );

            if (ctx.hasUI) {
              ctx.ui.notify("Delivered response to Matrix room", "info");
            }
          }
        }
      }
    } finally {
      stopTypingLoop();
      pendingResponse = false;
      currentTriggerEventId = null;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
    if (config.autoStart && !isPolling) {
      syncLoop(ctx);
    }
  });

  pi.on("session_shutdown", async () => {
    stopSyncLoop();
  });

  // TUI Command: /matrix
  pi.registerCommand("matrix", {
    description:
      "Manage Matrix Bridge (/matrix [start|stop|send <msg>|status])",
    handler: async (args, ctx) => {
      const trimmed = args?.trim() || "";
      const [cmd, ...rest] = trimmed.split(" ");
      const subarg = rest.join(" ").trim();

      if (cmd === "start" || cmd === "on") {
        if (isPolling) {
          ctx.ui.notify("Matrix bridge is already running", "info");
        } else {
          syncLoop(ctx);
          ctx.ui.notify("Matrix bridge listener started", "info");
        }
      } else if (cmd === "stop" || cmd === "off") {
        stopSyncLoop();
        ctx.ui.notify("Matrix bridge stopped", "info");
      } else if (cmd === "send") {
        if (!subarg) {
          ctx.ui.notify("Usage: /matrix send <message>", "warning");
          return;
        }
        if (!activeRoomId) {
          ctx.ui.notify("No active Matrix room set", "error");
          return;
        }
        const ok = await sendMatrixMessage(activeRoomId, subarg);
        if (ok) {
          ctx.ui.notify("Message sent to Matrix room", "info");
        } else {
          ctx.ui.notify("Failed to send message to Matrix", "error");
        }
      } else {
        const statusLines = [
          `📡 Status: ${isPolling ? "🟢 Connected & Listening" : "🔴 Stopped"}`,
          `🚀 Mode: ${config.useSubagent ? `Subagent (${config.subagentRole})` : "Direct (Zero Token Bloat)"}`,
          `🏠 Homeserver: ${config.homeserver}`,
          `🤖 Bot User: ${config.botUserId}`,
          `💬 Active Room: ${activeRoomId || "None"}`,
          `⏱️ Progress Cooldown: ${config.progressCooldownSeconds}s (${config.progressMode})`,
          `👥 Allowed Users: ${config.allowedUsers.join(", ") || "All"}`,
        ].join("\n");
        ctx.ui.notify(statusLines, "info");
      }
    },
  });
}
