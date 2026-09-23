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
