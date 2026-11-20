/**
 * Minimal binary min-heap (priority queue) implemented from scratch.
 * Ties are broken by insertion value to keep Dijkstra step logs deterministic.
 * Dijkstra uses lazy deletion: stale entries are ignored when popped.
 */
export class MinHeap {
  private priorities: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  isEmpty(): boolean {
    return this.values.length === 0;
  }

  peek(): { priority: number; value: number } | null {
    if (this.values.length === 0) return null;
    return { priority: this.priorities[0], value: this.values[0] };
  }

  push(priority: number, value: number): void {
    this.priorities.push(priority);
    this.values.push(value);
    this.siftUp(this.values.length - 1);
  }

  pop(): { priority: number; value: number } | null {
    const n = this.values.length;
    if (n === 0) return null;
    const top = { priority: this.priorities[0], value: this.values[0] };
    const lastPriority = this.priorities.pop()!;
    const lastValue = this.values.pop()!;
    if (n > 1) {
      this.priorities[0] = lastPriority;
      this.values[0] = lastValue;
      this.siftDown(0);
    }
    return top;
  }

  /** Snapshot of the raw heap array (unsorted, may contain stale entries). */
  entries(): { priority: number; value: number }[] {
    return this.values.map((value, i) => ({ priority: this.priorities[i], value }));
  }

  private less(i: number, j: number): boolean {
    const a = this.priorities[i];
    const b = this.priorities[j];
    return a < b || (a === b && this.values[i] < this.values[j]);
  }

  private swap(i: number, j: number): void {
    const p = this.priorities[i];
    this.priorities[i] = this.priorities[j];
    this.priorities[j] = p;
    const v = this.values[i];
    this.values[i] = this.values[j];
    this.values[j] = v;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.values.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}
