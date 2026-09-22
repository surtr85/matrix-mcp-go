export class BoundedEventCache {
  private set = new Set<string | number>();
  private list: (string | number)[] = [];

  constructor(private maxSize = 2000) {}

  has(id: string | number): boolean {
    return this.set.has(id);
  }

  add(id: string | number): void {
    if (this.set.has(id)) return;
    if (this.list.length >= this.maxSize) {
      const oldest = this.list.shift();
      if (oldest !== undefined) this.set.delete(oldest);
    }
    this.list.push(id);
    this.set.add(id);
  }
}
