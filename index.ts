/**
 * Matrix Bridge Extension for Pi Coding Agent (v2.0)
 *
 * Dedicated high-performance, token-efficient, zero-cost bridge between Matrix and Pi:
 * - Security First: Zero hardcoded credentials; reads strictly from ~/.pi/agent/matrix.json or environment variables.
 * - Concurrency Safe: Turn Queue (FIFO) mapping each turn to its exact roomId, triggerEventId, and sender.
 * - Outbound Media Uplink: Auto-uploads generated media (images, svg, plots, pdf) & files to Matrix media repo.
 * - Slash Commands: /new, /status, /model, /thinking, /compact, /abort, /sh, /upload, /help.
 * - Interactive Abort: Immediate cancellation via /abort or 🛑 reaction without queue lag.
 * - Direct Shell Execution: /sh <cmd> executes host commands without consuming LLM tokens.
 * - PDU Overflow Protection: Automatic chunking of long messages (>4000 chars) to prevent M_TOO_LARGE errors.
 * - Multimodal Native Vision & Attachments: Images, Videos, Audio, Documents with disk caching.
 * - Intelligent Batch Coalescing: Seamlessly joins text captions + media events.
 * - In-place Matrix live status updates via m.replace (MSC2676) and automatic cleanup on completion.
 * - Enhanced Markdown-to-HTML converter with Persian BiDi (RTL for Persian, LTR for code, links, lists, headers).
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
  homeserver: process.env.MATRIX_HOMESERVER || "",
  accessToken: process.env.MATRIX_ACCESS_TOKEN || "",
  botUserId: process.env.MATRIX_BOT_USER_ID || "",
  allowedUsers: process.env.MATRIX_ALLOWED_USERS
    ? process.env.MATRIX_ALLOWED_USERS.split(",").map((u) => u.trim())
    : [],
  autoStart: true,
  useSubagent: false,
  subagentRole: "delegate",
  progressCooldownSeconds: 5,
  progressMode: "edit",
};

interface PendingTurn {
  id: string;
  roomId: string;
  triggerEventId: string;
  sender: string;
  timestamp: number;
}

function getHomeDir(): string {
  return process.env.HOME || "/home/amadeus";
}

function getSyncTokenPath(): string {
  return path.join(getHomeDir(), ".pi/agent/matrix_sync_token");
}

function getMediaDir(): string {
  const dir = path.join(getHomeDir(), ".pi/agent/media");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".zip":
      return "application/zip";
    case ".txt":
    case ".md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
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

  // Markdown links: [title](url)
  workingText = workingText.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Markdown formatting
  workingText = workingText.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  workingText = workingText.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  // Headers: ###, ##, #
  workingText = workingText.replace(/^### (.*)$/gm, "<h4>$1</h4>");
  workingText = workingText.replace(/^## (.*)$/gm, "<h3>$1</h3>");
  workingText = workingText.replace(/^# (.*)$/gm, "<h2>$1</h2>");

  // Blockquotes: > quote
  workingText = workingText.replace(
    /^> (.*)$/gm,
    "<blockquote>$1</blockquote>",
  );

  // Bullet items: - item
  workingText = workingText.replace(/^[*-] (.*)$/gm, "<li>$1</li>");

  const lines = workingText.split("\n");
  const processedLines = lines.map((line) => {
    if (!line.trim()) return "<br/>";
    if (
      line.includes("@@CODE_BLOCK_") ||
      line.startsWith("<h2>") ||
      line.startsWith("<h3>") ||
      line.startsWith("<h4>") ||
      line.startsWith("<blockquote>") ||
      line.startsWith("<li>")
    ) {
      return line;
    }
    const rtl = isPersian(line);
    const dir = rtl ? "rtl" : "ltr";
    const align = rtl ? "right" : "left";
    return `<div dir="${dir}" style="text-align: ${align};">${line}</div>`;
  });

  let html = processedLines.join("");

  // Wrap consecutive list items in <ul>
  html = html.replace(/(<li>.*?<\/li>)+/g, (match) => `<ul>${match}</ul>`);

  inlineCodes.forEach((code, idx) => {
    html = html.replace(`@@INLINE_CODE_${idx}@@`, code);
  });
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`@@CODE_BLOCK_${idx}@@`, block);
  });

  return html;
}

interface DownloadedMedia {
  data: string; // base64
  buffer: Buffer;
  mimeType: string;
  filename: string;
  localPath: string;
  sizeBytes: number;
}

async function downloadMatrixMedia(
  homeserver: string,
  token: string,
  mxcUrl: string,
  suggestedFilename: string = "file",
): Promise<DownloadedMedia | null> {
  if (!mxcUrl.startsWith("mxc://")) return null;
  const [serverName, mediaId] = mxcUrl.slice(6).split("/");
  if (!serverName || !mediaId) return null;

  const endpoints = [
    `${homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(
      serverName,
    )}/${encodeURIComponent(mediaId)}`,
    `${homeserver}/_matrix/media/v3/download/${encodeURIComponent(
      serverName,
    )}/${encodeURIComponent(mediaId)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;

      const mimeType =
        res.headers.get("content-type") || "application/octet-stream";
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const base64 = buffer.toString("base64");

      const mediaDir = getMediaDir();

      let ext = path.extname(suggestedFilename);
      if (!ext) {
        if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = ".jpg";
        else if (mimeType.includes("png")) ext = ".png";
        else if (mimeType.includes("gif")) ext = ".gif";
        else if (mimeType.includes("webp")) ext = ".webp";
        else if (mimeType.includes("mp4")) ext = ".mp4";
        else if (mimeType.includes("webm")) ext = ".webm";
        else if (mimeType.includes("ogg") || mimeType.includes("opus"))
          ext = ".ogg";
        else if (mimeType.includes("pdf")) ext = ".pdf";
        else ext = ".bin";
      }

      const hasRealExt = path.extname(suggestedFilename).length > 0;
      const isCleanFilename =
        hasRealExt &&
        !/\s/.test(suggestedFilename) &&
        suggestedFilename.length <= 40;

      const safeBase = isCleanFilename
        ? path
            .basename(suggestedFilename, ext)
            .replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_")
            .slice(0, 30) || "attachment"
        : "attachment";
      const finalFilename = `${Date.now()}_${safeBase}${ext}`;
      const localPath = path.join(mediaDir, finalFilename);

      fs.writeFileSync(localPath, buffer);

      return {
        data: base64,
        buffer,
        mimeType,
        filename: finalFilename,
        localPath,
        sizeBytes: buffer.length,
      };
    } catch {
      continue;
    }
  }

  return null;
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

  // Concurrency Queue: Each turn maintains its exact destination room and reply target
  const pendingTurnsQueue: PendingTurn[] = [];
  let currentActiveTurn: PendingTurn | null = null;

  // Track files created or modified during the current turn to send back
  const createdMediaFiles: string[] = [];

  let typingTimer: NodeJS.Timeout | null = null;
  let typingRoomId: string | null = null;
  const processedEventIds = new BoundedEventCache(1000);

  let latestContext: ExtensionContext | null = null;

  // Matrix API Helpers
  const makeTxnId = () =>
    `m${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  /**
   * Uploads local file buffer to Matrix Media Repository
   */
  const uploadMatrixMedia = async (
    localFilePath: string,
  ): Promise<{
    mxcUri: string;
    sizeBytes: number;
    mimeType: string;
  } | null> => {
    if (!fs.existsSync(localFilePath)) return null;
    try {
      const stats = fs.statSync(localFilePath);
      const buffer = fs.readFileSync(localFilePath);
      const mimeType = getMimeType(localFilePath);
      const filename = path.basename(localFilePath);

      const url = `${config.homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(
        filename,
      )}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": mimeType,
        },
        body: buffer,
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (data.content_uri) {
        return {
          mxcUri: data.content_uri,
          sizeBytes: stats.size,
          mimeType,
        };
      }
    } catch {
      // Ignore upload errors
    }
    return null;
  };

  /**
   * Sends native Media (Image/File/Audio) to Matrix Room
   */
  const sendMatrixMedia = async (
    roomId: string,
    localFilePath: string,
    inReplyToEventId?: string,
  ): Promise<string | null> => {
    try {
      const uploadRes = await uploadMatrixMedia(localFilePath);
      if (!uploadRes) return null;

      const filename = path.basename(localFilePath);
      const isImg = uploadRes.mimeType.startsWith("image/");
      const isVideo = uploadRes.mimeType.startsWith("video/");
      const isAudio = uploadRes.mimeType.startsWith("audio/");

      const msgtype = isImg
        ? "m.image"
        : isVideo
          ? "m.video"
          : isAudio
            ? "m.audio"
            : "m.file";

      const txnId = makeTxnId();
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/send/m.room.message/${txnId}`;

      const bodyPayload: any = {
        msgtype,
        body: filename,
        url: uploadRes.mxcUri,
        info: {
          mimetype: uploadRes.mimeType,
          size: uploadRes.sizeBytes,
        },
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

  /**
   * Splits long messages cleanly along newline or paragraph boundaries
   */
  const chunkMessage = (text: string, maxChunkSize = 4000): string[] => {
    if (text.length <= maxChunkSize) return [text];
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxChunkSize) {
        chunks.push(remaining);
        break;
      }

      let splitIdx = remaining.lastIndexOf("\n\n", maxChunkSize);
      if (splitIdx < maxChunkSize * 0.4) {
        splitIdx = remaining.lastIndexOf("\n", maxChunkSize);
      }
      if (splitIdx < maxChunkSize * 0.4) {
        splitIdx = maxChunkSize;
      }

      chunks.push(remaining.slice(0, splitIdx).trim());
      remaining = remaining.slice(splitIdx).trim();
    }

    return chunks.filter((c) => c.length > 0);
  };

  const sendSingleMatrixMessage = async (
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

  /**
   * Safe message dispatcher with automated chunking for PDU limit safety
   */
  const sendMatrixMessage = async (
    roomId: string,
    text: string,
    inReplyToEventId?: string,
  ): Promise<string | null> => {
    const cleanText = cleanAssistantText(text);
    if (!cleanText) return null;

    // If message is exceptionally huge (>25KB), attach as markdown file too
    if (cleanText.length > 25000) {
      try {
        const tempPath = path.join(getMediaDir(), `response_${Date.now()}.md`);
        fs.writeFileSync(tempPath, cleanText, "utf-8");
        await sendMatrixMedia(roomId, tempPath, inReplyToEventId);
      } catch {
        // Fallback to chunks
      }
    }

    const chunks = chunkMessage(cleanText, 4000);
    let firstEventId: string | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const replyTarget = i === 0 ? inReplyToEventId : undefined;
      const evId = await sendSingleMatrixMessage(roomId, chunk, replyTarget);
      if (i === 0) firstEventId = evId;
      if (chunks.length > 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return firstEventId;
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

  const redactMatrixMessage = async (
    roomId: string,
    eventId: string,
  ): Promise<boolean> => {
    try {
      const txnId = makeTxnId();
      const url = `${config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/redact/${encodeURIComponent(eventId)}/${txnId}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
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
      this.lastReportTime = Date.now();
    }

    matchesMessageId(id: string): boolean {
      return this.progressMessageId === id;
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
          this.progressMessageId = await sendSingleMatrixMessage(
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
        await sendSingleMatrixMessage(
          this.roomId,
          formatted,
          this.replyToEventId || undefined,
        );
      }
    }

    async cleanup() {
      if (!this.active) return;
      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
        this.flushTimeout = null;
      }
      this.pendingStatus = null;

      if (this.progressMessageId && this.roomId) {
        await redactMatrixMessage(this.roomId, this.progressMessageId);
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

  // Register internal bridge commands so Pi intercepts them without prompting LLM
  pi.registerCommand("new_session", {
    description: "Start a new session from Matrix bridge",
    handler: async (_args, ctx) => {
      await ctx.newSession();
    },
  });

  pi.registerCommand("compact_session", {
    description: "Compact context from Matrix bridge",
    handler: async (_args, ctx) => {
      ctx.compact();
    },
  });

  pi.registerCommand("reload_session", {
    description: "Reload Pi runtime from Matrix bridge",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });

  // Handle Slash Commands (All in English)
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

    // 1. /abort, /stop, /cancel (Immediate Interruption)
    if (cmdName === "abort" || cmdName === "stop" || cmdName === "cancel") {
      try {
        if (latestContext && typeof latestContext.abort === "function") {
          latestContext.abort();
        }
        stopTypingLoop();
        await progressReporter.cleanup();
        pendingTurnsQueue.length = 0;
        currentActiveTurn = null;
        createdMediaFiles.length = 0;

        await sendReaction(roomId, replyToId, "🛑");
        await sendMatrixMessage(
          roomId,
          "🛑 **Agent execution aborted.**",
          replyToId,
        );
      } catch (err: any) {
        await sendMatrixMessage(
          roomId,
          `❌ Failed to abort: ${err.message || String(err)}`,
          replyToId,
        );
      }
      return true;
    }

    // 2. /sh, /bash, /run (Zero-Token Direct Shell Execution)
    if (cmdName === "sh" || cmdName === "bash" || cmdName === "run") {
      if (!args) {
        await sendMatrixMessage(
          roomId,
          "⚠️ Usage: `/sh <command>` (Executes host command directly without LLM tokens)",
          replyToId,
        );
        return true;
      }

      // Security check
      if (
        config.allowedUsers.length > 0 &&
        !config.allowedUsers.includes(sender)
      ) {
        await sendMatrixMessage(
          roomId,
          "⛔ Permission denied: sender is not in allowedUsers list.",
          replyToId,
        );
        return true;
      }

      await sendReaction(roomId, replyToId, "⚙️");

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
          await sendMatrixMessage(roomId, formatted, replyToId);
          await sendReaction(roomId, replyToId, "✅");
        },
      );
      return true;
    }

    // 3. /upload, /file (Send server file to Matrix)
    if (cmdName === "upload" || cmdName === "file") {
      if (!args) {
        await sendMatrixMessage(
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
        await sendMatrixMessage(
          roomId,
          `❌ File not found: \`${targetPath}\``,
          replyToId,
        );
        return true;
      }

      await sendReaction(roomId, replyToId, "📤");
      const evId = await sendMatrixMedia(roomId, targetPath, replyToId);
      if (evId) {
        await sendReaction(roomId, replyToId, "✅");
      } else {
        await sendMatrixMessage(
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
        pi.sendUserMessage("/new_session", {
          expandPromptTemplates: true,
          deliverAs: "followUp",
        });
        await sendMatrixMessage(
          roomId,
          "✨ **New session started successfully.**",
          replyToId,
        );
      } catch (err: any) {
        await sendMatrixMessage(
          roomId,
          `❌ Failed to start new session: ${err.message || String(err)}`,
          replyToId,
        );
      }
      return true;
    }

    // 5. /status or /info or /session
    if (cmdName === "status" || cmdName === "info" || cmdName === "session") {
      let statsText = "";
      try {
        const session = (latestContext as any)?.session;
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

      const currentModel = latestContext?.model;
      const currentThinking = pi.getThinkingLevel();

      const msg = [
        `📡 **Pi Matrix Bridge Status (v2.0):**`,
        `- Connection: ${isPolling ? "🟢 Connected & Active" : "🔴 Stopped"}`,
        `- Execution Mode: ${config.useSubagent ? `⚡ Subagent (${config.subagentRole})` : "🚀 Direct (Zero Token Bloat)"}`,
        `- Active Model: \`${currentModel ? `${currentModel.provider}/${currentModel.id}` : "Unset"}\``,
        `- Thinking Level: \`${currentThinking}\``,
        `- Progress Cooldown: \`${config.progressCooldownSeconds}s\` (Mode: \`${config.progressMode}\`)`,
        `- Pending Queue: \`${pendingTurnsQueue.length} turns\``,
        statsText,
      ]
        .filter(Boolean)
        .join("\n");

      await sendMatrixMessage(roomId, msg, replyToId);
      return true;
    }

    // 6. /model [model_id]
    if (cmdName === "model") {
      if (!args) {
        const currentModel = latestContext?.model;
        await sendMatrixMessage(
          roomId,
          `🤖 **Active Model:** \`${currentModel ? `${currentModel.provider}/${currentModel.id}` : "Unset"}\``,
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
              `✅ Switched model to **${match.provider}/${match.id}**.`,
              replyToId,
            );
          } else {
            await sendMatrixMessage(
              roomId,
              `❌ Authentication failed for model ${match.provider}/${match.id}.`,
              replyToId,
            );
          }
        } else {
          const availableList = available
            .map((m) => `\`${m.provider}/${m.id}\``)
            .join(", ");
          await sendMatrixMessage(
            roomId,
            `⚠️ Model \`${args}\` not found.\nAvailable models:\n${availableList || "None"}`,
            replyToId,
          );
        }
      } catch (err: any) {
        await sendMatrixMessage(
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
        await sendMatrixMessage(
          roomId,
          `🧠 **Current Thinking Level:** \`${currentLevel}\``,
          replyToId,
        );
        return true;
      }
      try {
        const level = args.toLowerCase() as any;
        pi.setThinkingLevel(level);
        await sendMatrixMessage(
          roomId,
          `🧠 Thinking level updated to **${args}**.`,
          replyToId,
        );
      } catch (err: any) {
        await sendMatrixMessage(
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
        await sendMatrixMessage(
          roomId,
          "⏳ **Context compaction in progress...**",
          replyToId,
        );
        pi.sendUserMessage(
          args ? `/compact_session ${args}` : "/compact_session",
          {
            expandPromptTemplates: true,
            deliverAs: "followUp",
          },
        );
      } catch (err: any) {
        await sendMatrixMessage(
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
        }
      } catch {
        // Ignore join errors
      }
    }
  };

  const syncLoop = async (ctx?: ExtensionContext) => {
    if (isPolling) return;
    if (!config.homeserver || !config.accessToken) {
      if (ctx?.hasUI) {
        ctx.ui.notify(
          "Matrix Bridge: homeserver or accessToken is not configured in ~/.pi/agent/matrix.json",
          "error",
        );
      }
      return;
    }

    isPolling = true;
    abortController = new AbortController();

    // Catch-up sync (timeout=0) if no saved token
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

          // 1. Check for Abort Reactions (🛑 or ⏹️)
          for (const ev of events) {
            if (
              ev.type === "m.reaction" &&
              !processedEventIds.has(ev.event_id) &&
              (config.allowedUsers.length === 0 ||
                config.allowedUsers.includes(ev.sender))
            ) {
              processedEventIds.add(ev.event_id);
              const rel = ev.content?.["m.relates_to"];
              if (rel?.rel_type === "m.annotation") {
                const key = rel.key;
                const targetEventId = rel.event_id;
                if (key === "🛑" || key === "⏹️") {
                  const matchesActive =
                    currentActiveTurn?.triggerEventId === targetEventId ||
                    progressReporter.matchesMessageId(targetEventId) ||
                    pendingTurnsQueue.some(
                      (t) => t.triggerEventId === targetEventId,
                    );

                  if (matchesActive) {
                    if (
                      latestContext &&
                      typeof latestContext.abort === "function"
                    ) {
                      latestContext.abort();
                    }
                    stopTypingLoop();
                    await progressReporter.cleanup();
                    pendingTurnsQueue.length = 0;
                    currentActiveTurn = null;
                    createdMediaFiles.length = 0;

                    await sendMatrixMessage(
                      roomId,
                      "🛑 **Agent task cancelled via reaction.**",
                      targetEventId,
                    );
                  }
                }
              }
            }
          }

          // 2. Filter incoming message events from allowed users
          const candidateEvents = events.filter(
            (ev: any) =>
              ev.type === "m.room.message" &&
              ev.sender !== config.botUserId &&
              !processedEventIds.has(ev.event_id) &&
              (config.allowedUsers.length === 0 ||
                config.allowedUsers.includes(ev.sender)),
          );

          for (let i = 0; i < candidateEvents.length; i++) {
            const ev = candidateEvents[i];
            processedEventIds.add(ev.event_id);

            const msgtype = ev.content?.msgtype;
            const rawBody = ev.content?.body || "";
            const mediaUrl = ev.content?.url || ev.content?.file?.url;

            // 1. Send read receipt & react with '👀'
            sendReadReceipt(roomId, ev.event_id);
            sendReaction(roomId, ev.event_id, "👀");

            // 2. Desktop notification
            const notifTitle = `Matrix: ${ev.sender}`;
            const notifBody = mediaUrl
              ? `📎 [${msgtype || "Media attachment"}] ${rawBody}`
              : rawBody;
            sendDesktopNotification(notifTitle, notifBody.slice(0, 100));

            // 3. Handle commands directly
            if (typeof rawBody === "string" && rawBody.trim().startsWith("/")) {
              const handled = await handleMatrixCommand(
                roomId,
                rawBody.trim(),
                ev.sender,
                ev.event_id,
              );
              if (handled) {
                continue;
              }
            }

            // 4. Intelligent Batch Coalescing: Check for following media event
            let coalescedCaption = rawBody;
            let targetEv = ev;

            if (msgtype === "m.text" && i + 1 < candidateEvents.length) {
              const nextEv = candidateEvents[i + 1];
              const nextMediaUrl =
                nextEv.content?.url || nextEv.content?.file?.url;
              if (nextMediaUrl && nextEv.sender === ev.sender) {
                coalescedCaption = rawBody;
                targetEv = nextEv;
                i++; // Skip merged event
                processedEventIds.add(nextEv.event_id);
                sendReadReceipt(roomId, nextEv.event_id);
                sendReaction(roomId, nextEv.event_id, "👀");
              }
            }

            // 5. Enqueue Turn into Concurrency-Safe Queue
            const turn: PendingTurn = {
              id: makeTxnId(),
              roomId,
              triggerEventId: targetEv.event_id,
              sender: targetEv.sender,
              timestamp: Date.now(),
            };
            pendingTurnsQueue.push(turn);

            startTypingLoop(roomId);

            const targetMsgType = targetEv.content?.msgtype;
            const targetMediaUrl =
              targetEv.content?.url || targetEv.content?.file?.url;
            const targetBody = targetEv.content?.body || "";

            // Handle Media Types: Images, Videos, Audio, Files
            if (targetMediaUrl) {
              const downloaded = await downloadMatrixMedia(
                config.homeserver,
                config.accessToken,
                targetMediaUrl,
                targetBody || "attachment",
              );

              if (downloaded) {
                // Determine user's text prompt:
                const isGenericFilename =
                  /^(image|screenshot|photo|file|media|pasted\s*image|attachment|\d+)[._0-9a-z]*$/i.test(
                    targetBody.trim(),
                  );
                let userPromptText = "";
                if (coalescedCaption && coalescedCaption !== targetBody) {
                  userPromptText = coalescedCaption.trim();
                } else if (targetBody && !isGenericFilename) {
                  userPromptText = targetBody.trim();
                }

                const promptHeader = userPromptText
                  ? `${userPromptText}\n\n`
                  : "";

                if (targetMsgType === "m.image") {
                  const textPrompt = `${promptHeader}[Attached image: ${downloaded.filename} (${formatFileSize(downloaded.sizeBytes)}) saved at ${downloaded.localPath}]`;

                  pi.sendUserMessage(
                    [
                      { type: "text", text: textPrompt },
                      {
                        type: "image",
                        data: downloaded.data,
                        mimeType: downloaded.mimeType,
                      },
                    ],
                    { deliverAs: "followUp" },
                  );
                  continue;
                } else if (targetMsgType === "m.video") {
                  const textPrompt = `${promptHeader}[Attached video: ${downloaded.filename} (${formatFileSize(downloaded.sizeBytes)}) saved at ${downloaded.localPath}]`;

                  pi.sendUserMessage(textPrompt, { deliverAs: "followUp" });
                  continue;
                } else if (targetMsgType === "m.audio") {
                  const textPrompt = `${promptHeader}[Attached audio: ${downloaded.filename} (${formatFileSize(downloaded.sizeBytes)}) saved at ${downloaded.localPath}]`;

                  pi.sendUserMessage(textPrompt, { deliverAs: "followUp" });
                  continue;
                } else {
                  let snippet = "";
                  if (
                    downloaded.mimeType.startsWith("text/") ||
                    downloaded.filename.match(
                      /\.(ts|js|py|go|rs|nix|json|yaml|yml|md|txt|sh|csv)$/i,
                    )
                  ) {
                    if (downloaded.sizeBytes < 64 * 1024) {
                      snippet = `\nFile preview:\n\`\`\`\n${downloaded.buffer.toString("utf-8").slice(0, 2000)}\n\`\`\``;
                    }
                  }

                  const textPrompt = `${promptHeader}[Attached file: ${downloaded.filename} (${downloaded.mimeType}, ${formatFileSize(downloaded.sizeBytes)}) saved at ${downloaded.localPath}]${snippet}`;

                  pi.sendUserMessage(textPrompt, { deliverAs: "followUp" });
                  continue;
                }
              }
            }

            // Normal text injection: clean, direct, with deliverAs: "followUp"
            if (
              typeof coalescedCaption === "string" &&
              coalescedCaption.trim().length > 0
            ) {
              if (config.useSubagent) {
                const subagentPrompt = `[Matrix @${ev.sender}]:\n${coalescedCaption}\n\n[Instruction: Delegate to ${config.subagentRole} subagent and return final answer.]`;
                pi.sendUserMessage(subagentPrompt, { deliverAs: "followUp" });
              } else {
                pi.sendUserMessage(coalescedCaption, { deliverAs: "followUp" });
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
    if (!currentActiveTurn && pendingTurnsQueue.length > 0) {
      currentActiveTurn = pendingTurnsQueue[0];
      progressReporter.start(
        currentActiveTurn.roomId,
        currentActiveTurn.triggerEventId,
      );
    }
    if (currentActiveTurn) {
      progressReporter.report("🧠 Thinking...");
    }
  });

  // Progress Reporting: Tool Execution Start
  pi.on("tool_execution_start", async (event: ToolExecutionStartEvent) => {
    if (!currentActiveTurn && pendingTurnsQueue.length > 0) {
      currentActiveTurn = pendingTurnsQueue[0];
      progressReporter.start(
        currentActiveTurn.roomId,
        currentActiveTurn.triggerEventId,
      );
    }
    if (!currentActiveTurn) return;

    let desc = "";
    switch (event.toolName) {
      case "bash": {
        const cmd = event.args?.command
          ? ` \`${event.args.command.slice(0, 60)}\``
          : "";
        desc = `⚙️ Running bash:${cmd}`;
        break;
      }
      case "read": {
        const p = event.args?.path
          ? ` \`${path.basename(event.args.path)}\``
          : "";
        desc = `📖 Reading${p}`;
        break;
      }
      case "edit":
      case "write": {
        const p = event.args?.path
          ? ` \`${path.basename(event.args.path)}\``
          : "";
        desc = `✏️ Editing${p}`;
        break;
      }
      case "grep":
      case "find":
      case "ls": {
        desc = `🔍 Searching paths (${event.toolName})`;
        break;
      }
      default: {
        desc = `🔧 Executing tool \`${event.toolName}\``;
        break;
      }
    }

    progressReporter.report(desc);
  });

  // Progress Reporting & Media Tracker: Tool Execution End
  pi.on("tool_execution_end", async (event: ToolExecutionEndEvent) => {
    if (currentActiveTurn && event.isError) {
      progressReporter.report(`⚠️ Error executing \`${event.toolName}\``);
    }

    // Auto-detect media files created by tools
    if (!event.isError && event.toolName === "write" && event.args?.path) {
      const p = String(event.args.path);
      const ext = path.extname(p).toLowerCase();
      if (
        [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".pdf"].includes(ext)
      ) {
        createdMediaFiles.push(p);
      }
    }
  });

  // Final Outbound Delivery: Agent End
  pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
    const activeTurn = pendingTurnsQueue.shift() || currentActiveTurn;
    currentActiveTurn = null;

    if (!activeTurn) {
      stopTypingLoop();
      return;
    }

    const { roomId, triggerEventId } = activeTurn;

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
          // Send final text answer
          const sentEventId = await sendMatrixMessage(
            roomId,
            text,
            triggerEventId,
          );

          if (sentEventId) {
            sendReaction(roomId, triggerEventId, "✅");
            await progressReporter.cleanup();

            // Outbound Media Uplink: Send newly created media files
            if (createdMediaFiles.length > 0) {
              const filesToSend = [...createdMediaFiles];
              createdMediaFiles.length = 0;
              for (const filePath of filesToSend) {
                if (fs.existsSync(filePath)) {
                  await sendMatrixMedia(roomId, filePath, sentEventId);
                }
              }
            }

            sendDesktopNotification(
              "Matrix Bridge",
              "Pi response delivered to Matrix 🚀",
            );

            if (ctx.hasUI) {
              ctx.ui.notify("Delivered response to Matrix room", "info");
            }
          }
        }
      }
    } finally {
      if (pendingTurnsQueue.length === 0) {
        stopTypingLoop();
      } else {
        // Start next turn from queue
        currentActiveTurn = pendingTurnsQueue[0];
        progressReporter.start(
          currentActiveTurn.roomId,
          currentActiveTurn.triggerEventId,
        );
        startTypingLoop(currentActiveTurn.roomId);
      }
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
        const targetRoom = currentActiveTurn?.roomId;
        if (!targetRoom) {
          ctx.ui.notify("No active Matrix room set", "error");
          return;
        }
        const ok = await sendMatrixMessage(targetRoom, subarg);
        if (ok) {
          ctx.ui.notify("Message sent to Matrix room", "info");
        } else {
          ctx.ui.notify("Failed to send message to Matrix", "error");
        }
      } else {
        const statusLines = [
          `📡 Status: ${isPolling ? "🟢 Connected & Listening" : "🔴 Stopped"}`,
          `🚀 Mode: ${config.useSubagent ? `Subagent (${config.subagentRole})` : "Direct (Zero Token Bloat)"}`,
          `🏠 Homeserver: ${config.homeserver || "Not configured"}`,
          `🤖 Bot User: ${config.botUserId || "Not configured"}`,
          `💬 Active Queue: ${pendingTurnsQueue.length} turns`,
          `⏱️ Progress Cooldown: ${config.progressCooldownSeconds}s (${config.progressMode})`,
          `👥 Allowed Users: ${config.allowedUsers.join(", ") || "All"}`,
        ].join("\n");
        ctx.ui.notify(statusLines, "info");
      }
    },
  });
}
