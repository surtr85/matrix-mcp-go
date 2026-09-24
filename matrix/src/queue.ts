import type { PendingTurn } from "./types.js";

export class MatrixQueue {
  private queue: PendingTurn[] = [];
  private activeTurn: PendingTurn | null = null;

  get length(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  enqueue(turn: PendingTurn): void {
    this.queue.push(turn);
  }

  next(): PendingTurn | null {
    this.activeTurn = this.queue.shift() || null;
    return this.activeTurn;
  }

  getActiveTurn(): PendingTurn | null {
    return this.activeTurn;
  }

  setActiveTurn(turn: PendingTurn | null): void {
    this.activeTurn = turn;
  }

  getById(id: string): PendingTurn | null {
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

  clear(): void {
    this.queue.length = 0;
    this.activeTurn = null;
  }

  matchesTarget(eventId: string): boolean {
    if (this.activeTurn?.triggerEventId === eventId) return true;
    return this.queue.some((t) => t.triggerEventId === eventId);
  }
}
