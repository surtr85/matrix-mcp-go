import * as fs from "node:fs";
import * as path from "node:path";
import type { MatrixConfig, DownloadedMedia, UploadMediaResult } from "./types.js";
import { getMediaDir } from "./config.js";
import {
  cleanAssistantText,
  escapeHtml,
  getMimeType,
  markdownToMatrixHtml,
} from "./formatter.js";

export class MatrixApiClient {
  private typingTimer: NodeJS.Timeout | null = null;
  private typingRoomId: string | null = null;

  constructor(private config: MatrixConfig) {}

  updateConfig(config: MatrixConfig): void {
    this.config = config;
  }

  makeTxnId(): string {
    return `m${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async uploadMedia(localFilePath: string): Promise<UploadMediaResult | null> {
    if (!fs.existsSync(localFilePath)) return null;
    try {
      const stats = fs.statSync(localFilePath);
      const buffer = fs.readFileSync(localFilePath);
      const mimeType = getMimeType(localFilePath);
      const filename = path.basename(localFilePath);

      const url = `${this.config.homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(
        filename,
      )}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
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
  }

  async sendMedia(
    roomId: string,
    localFilePath: string,
    inReplyToEventId?: string,
  ): Promise<string | null> {
    try {
      const uploadRes = await this.uploadMedia(localFilePath);
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

      const txnId = this.makeTxnId();
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
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
          Authorization: `Bearer ${this.config.accessToken}`,
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
  }

  chunkMessage(text: string, maxChunkSize = 4000): string[] {
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
  }

  async sendSingleMessage(
    roomId: string,
    text: string,
    inReplyToEventId?: string,
  ): Promise<string | null> {
    try {
      const cleanText = cleanAssistantText(text);
      if (!cleanText) return null;

      const formattedHtml = markdownToMatrixHtml(cleanText);
      const txnId = this.makeTxnId();
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
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
          Authorization: `Bearer ${this.config.accessToken}`,
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
  }

  async sendMessage(
    roomId: string,
    text: string,
    inReplyToEventId?: string,
  ): Promise<string | null> {
    const cleanText = cleanAssistantText(text);
    if (!cleanText) return null;

    if (cleanText.length > 25000) {
      try {
        const tempPath = path.join(getMediaDir(), `response_${Date.now()}.md`);
        fs.writeFileSync(tempPath, cleanText, "utf-8");
        await this.sendMedia(roomId, tempPath, inReplyToEventId);
      } catch {
        // Fallback to chunks
      }
    }

    const chunks = this.chunkMessage(cleanText, 4000);
    let firstEventId: string | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const replyTarget = i === 0 ? inReplyToEventId : undefined;
      const evId = await this.sendSingleMessage(roomId, chunk, replyTarget);
      if (i === 0) firstEventId = evId;
      if (chunks.length > 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return firstEventId;
  }

  async editMessage(
    roomId: string,
    originalEventId: string,
    newText: string,
  ): Promise<boolean> {
    try {
      const cleanText = cleanAssistantText(newText);
      if (!cleanText) return false;

      const formattedHtml = markdownToMatrixHtml(cleanText);
      const txnId = this.makeTxnId();
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
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
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  async redactMessage(roomId: string, eventId: string): Promise<boolean> {
    try {
      const txnId = this.makeTxnId();
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/redact/${encodeURIComponent(eventId)}/${txnId}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  async sendReaction(
    roomId: string,
    targetEventId: string,
    emoji: string,
  ): Promise<boolean> {
    try {
      const txnId = this.makeTxnId();
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/send/m.reaction/${txnId}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
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
  }

  async sendReadReceipt(roomId: string, eventId: string): Promise<void> {
    try {
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/receipt/m.read/${encodeURIComponent(eventId)}`;
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
    } catch {
      // Ignore receipt errors
    }
  }

  async setTyping(roomId: string, typing: boolean): Promise<void> {
    try {
      const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId,
      )}/typing/${encodeURIComponent(this.config.botUserId)}`;
      await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ typing, timeout: typing ? 30000 : 0 }),
      });
    } catch {
      // Ignore typing errors
    }
  }

  startTypingLoop(roomId: string): void {
    this.stopTypingLoop();
    this.typingRoomId = roomId;
    this.setTyping(roomId, true);
    this.typingTimer = setInterval(() => {
      if (this.typingRoomId) {
        this.setTyping(this.typingRoomId, true);
      }
    }, 20000);
  }

  stopTypingLoop(): void {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
    if (this.typingRoomId) {
      const prevRoom = this.typingRoomId;
      this.typingRoomId = null;
      this.setTyping(prevRoom, false);
    }
  }

  async downloadMedia(
    mxcUrl: string,
    suggestedFilename = "file",
  ): Promise<DownloadedMedia | null> {
    if (!mxcUrl.startsWith("mxc://")) return null;
    const [serverName, mediaId] = mxcUrl.slice(6).split("/");
    if (!serverName || !mediaId) return null;

    const endpoints = [
      `${this.config.homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(
        serverName,
      )}/${encodeURIComponent(mediaId)}`,
      `${this.config.homeserver}/_matrix/media/v3/download/${encodeURIComponent(
        serverName,
      )}/${encodeURIComponent(mediaId)}`,
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.config.accessToken}` },
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

  async joinRoom(roomId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.config.homeserver}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
