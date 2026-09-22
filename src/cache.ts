export class BoundedEventCache {
  private set = new Set<string>();
  private list: string[] = [];

  constructor(private maxSize = 1000) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.has(id)) return;
    if (this.list.length >= this.maxSize) {
      const oldest = this.list.shift();
      if (oldest) this.set.delete(oldest);
    }
    this.list.push(id);
    this.set.add(id);
  }
}
