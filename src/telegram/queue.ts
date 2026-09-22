import type { PendingTelegramTurn } from "./types.js";

export class TelegramQueue {
  private queue: PendingTelegramTurn[] = [];
  private activeTurn: PendingTelegramTurn | null = null;

  makeTxnId(): string {
    return `tg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  enqueue(turn: PendingTelegramTurn): void {
    this.queue.push(turn);
  }

  next(): PendingTelegramTurn | null {
    this.activeTurn = this.queue.shift() || null;
    return this.activeTurn;
  }

  getActiveTurn(): PendingTelegramTurn | null {
    return this.activeTurn;
  }

  clearActiveTurn(): void {
    this.activeTurn = null;
  }

  get length(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
