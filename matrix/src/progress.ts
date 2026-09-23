import type { MatrixApiClient } from "./api.js";
import type { MatrixConfig } from "./types.js";

export class MatrixProgressReporter {
  private active = false;
  private roomId: string | null = null;
  private replyToEventId: string | null = null;
  private progressMessageId: string | null = null;
  private lastReportTime = 0;
  private cooldownMs: number;
  private pendingStatus: string | null = null;
  private flushTimeout: NodeJS.Timeout | null = null;

  constructor(
    private api: MatrixApiClient,
    private config: MatrixConfig,
  ) {
    this.cooldownMs = Math.max(2, config.progressCooldownSeconds || 5) * 1000;
  }

  setCooldown(seconds: number): void {
    this.cooldownMs = Math.max(2, seconds || 5) * 1000;
  }

  updateConfig(config: MatrixConfig): void {
    this.config = config;
    this.setCooldown(config.progressCooldownSeconds);
  }

  start(roomId: string, replyToEventId: string): void {
    this.reset();
    this.active = true;
    this.roomId = roomId;
    this.replyToEventId = replyToEventId;
    this.lastReportTime = Date.now();
  }

  matchesMessageId(id: string): boolean {
    return this.progressMessageId === id;
  }

  report(statusText: string): void {
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

  private async emitStatus(statusText: string): Promise<void> {
    if (!this.active || !this.roomId) return;
    this.lastReportTime = Date.now();

    const formatted = `⏳ **${statusText}**`;

    if (this.config.progressMode === "edit") {
      if (!this.progressMessageId) {
        this.progressMessageId = await this.api.sendSingleMessage(
          this.roomId,
          formatted,
          this.replyToEventId || undefined,
        );
      } else {
        await this.api.editMessage(
          this.roomId,
          this.progressMessageId,
          formatted,
        );
      }
    } else {
      await this.api.sendSingleMessage(
        this.roomId,
        formatted,
        this.replyToEventId || undefined,
      );
    }
  }

  async cleanup(): Promise<void> {
    if (!this.active) return;
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    this.pendingStatus = null;

    if (this.progressMessageId && this.roomId) {
      await this.api.redactMessage(this.roomId, this.progressMessageId);
    }

    this.reset();
  }

  reset(): void {
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
