import * as fs from "node:fs";
import * as path from "node:path";
import type { TelegramConfig, DownloadedFile, InlineKeyboardMarkup } from "./types.js";
import { getMediaDir } from "./config.js";
import { markdownToTelegramHtml, stripHtmlToPlainText } from "./formatter.js";

export class TelegramApiClient {
  private config: TelegramConfig;
  private typingInterval: NodeJS.Timeout | null = null;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  updateConfig(config: TelegramConfig) {
    this.config = config;
  }

  async callApi(method: string, bodyObj?: any, signal?: AbortSignal, retries = 2): Promise<any> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/${method}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyObj ? JSON.stringify(bodyObj) : undefined,
          signal,
        });

        const data = await res.json();

        // Handle Telegram 429 Too Many Requests (Rate limit)
        if (!data.ok && data.error_code === 429) {
          const retryAfter = (data.parameters?.retry_after || 2) * 1000;
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, retryAfter));
            continue;
          }
        }

        if (!data.ok) {
          throw new Error(`Telegram API [${method}] Error: ${data.description}`);
        }
        return data.result;
      } catch (err: any) {
        if (signal?.aborted || attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  async setMessageReaction(chatId: number, messageId: number, emoji: string): Promise<boolean> {
    try {
      await this.callApi("setMessageReaction", {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    try {
      await this.callApi("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
      });
      return true;
    } catch {
      return false;
    }
  }

  async acknowledgeOffset(offset: number): Promise<void> {
    try {
      await this.callApi("getUpdates", { offset, limit: 1, timeout: 0 });
    } catch {
      // Ignore acknowledgment network errors
    }
  }

  async sendChatAction(chatId: number, action = "typing"): Promise<void> {
    try {
      await this.callApi("sendChatAction", { chat_id: chatId, action });
    } catch {
      // ignore
    }
  }

  startTypingLoop(chatId: number): void {
    this.stopTypingLoop();
    this.sendChatAction(chatId);
    this.typingInterval = setInterval(() => {
      this.sendChatAction(chatId);
    }, 4500);
  }

  stopTypingLoop(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  chunkText(text: string, maxLen = 4000): string[] {
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
  }

  async sendMessage(
    chatId: number,
    text: string,
    replyToMessageId?: number,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<number | null> {
    const chunks = this.chunkText(text);
    let lastMessageId: number | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;
      const htmlText = markdownToTelegramHtml(chunk);

      try {
        const res = await this.callApi("sendMessage", {
          chat_id: chatId,
          text: htmlText,
          parse_mode: "HTML",
          reply_to_message_id: i === 0 ? replyToMessageId : lastMessageId,
          allow_sending_without_reply: true,
          disable_web_page_preview: true,
          reply_markup: isLastChunk ? replyMarkup : undefined,
        });
        lastMessageId = res.message_id;
      } catch {
        // Fallback to safe plain text: strip HTML tags and decode entities so no raw tags leak into chat
        const safePlainText = stripHtmlToPlainText(htmlText);
        try {
          const res = await this.callApi("sendMessage", {
            chat_id: chatId,
            text: safePlainText,
            reply_to_message_id: i === 0 ? replyToMessageId : lastMessageId,
            allow_sending_without_reply: true,
            reply_markup: isLastChunk ? replyMarkup : undefined,
          });
          lastMessageId = res.message_id;
        } catch {
          // ignore error on fallback
        }
      }
    }

    return lastMessageId;
  }

  async sendPhoto(
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<boolean> {
    if (!fs.existsSync(filePath)) return false;
    try {
      const filename = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer]);

      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("photo", blob, filename);
      if (caption) form.append("caption", caption);
      if (replyToMessageId) form.append("reply_to_message_id", String(replyToMessageId));

      const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendPhoto`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  async sendDocument(
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<boolean> {
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

      const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendDocument`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  async sendMediaAuto(
    chatId: number,
    filePath: string,
    caption?: string,
    replyToMessageId?: number,
  ): Promise<boolean> {
    const ext = path.extname(filePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      const ok = await this.sendPhoto(chatId, filePath, caption, replyToMessageId);
      if (ok) return true;
    }
    return this.sendDocument(chatId, filePath, caption, replyToMessageId);
  }

  async downloadFile(
    fileId: string,
    suggestedName?: string,
  ): Promise<DownloadedFile | null> {
    try {
      const fileInfo = await this.callApi("getFile", { file_id: fileId });
      const filePathOnServer = fileInfo.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${filePathOnServer}`;

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
  }
}
