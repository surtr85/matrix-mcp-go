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

  setActiveTurn(turn: PendingTelegramTurn | null): void {
    this.activeTurn = turn;
  }

  getById(id: string): PendingTelegramTurn | null {
    if (this.activeTurn?.id === id) return this.activeTurn;
    return this.queue.find((t) => t.id === id) || null;
  }

  removeTurn(id: string): void {
    const idx = this.queue.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
    if (this.activeTurn?.id === id) {
      this.activeTurn = null;
    }
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
