import type { TelegramApiClient } from "./api.js";

export class TelegramProgressReporter {
  private api: TelegramApiClient;
  private cooldownSeconds: number;
  private currentChatId: number | null = null;
  private statusMessageId: number | null = null;
  private lastUpdate = 0;
  private timer: NodeJS.Timeout | null = null;
  private pendingText = "";

  constructor(api: TelegramApiClient, cooldownSeconds = 3) {
    this.api = api;
    this.cooldownSeconds = cooldownSeconds;
  }

  setCooldown(seconds: number) {
    this.cooldownSeconds = seconds;
  }

  start(chatId: number, _triggerMessageId?: number): void {
    this.currentChatId = chatId;
    this.statusMessageId = null;
    this.pendingText = "⏳ <i>Pi is thinking...</i>";
    this.lastUpdate = 0;
  }

  async update(status: string): Promise<void> {
    if (!this.currentChatId) return;
    this.pendingText = status;

    const now = Date.now();
    const cooldownMs = this.cooldownSeconds * 1000;

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

  private async flush(): Promise<void> {
    if (!this.currentChatId || !this.pendingText) return;
    this.lastUpdate = Date.now();

    try {
      if (!this.statusMessageId) {
        const res = await this.api.callApi("sendMessage", {
          chat_id: this.currentChatId,
          text: this.pendingText,
          parse_mode: "HTML",
        });
        this.statusMessageId = res.message_id;
      } else {
        await this.api.callApi("editMessageText", {
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

  async cleanup(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.currentChatId && this.statusMessageId) {
      try {
        await this.api.callApi("deleteMessage", {
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
