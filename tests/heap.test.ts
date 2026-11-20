import { describe, expect, it } from 'vitest';
import { MinHeap } from '../src/lib/heap';

describe('MinHeap', () => {
  it('pops values in ascending priority order', () => {
    const heap = new MinHeap();
    const input = [5, 1, 9, 3, 7, 2, 8, 0, 6, 4];
    for (const v of input) heap.push(v, v);
    const out: number[] = [];
    while (!heap.isEmpty()) out.push(heap.pop()!.value);
    expect(out).toEqual([...input].sort((a, b) => a - b));
  });

  it('breaks priority ties by value', () => {
    const heap = new MinHeap();
    heap.push(1, 9);
    heap.push(1, 2);
    heap.push(1, 5);
    expect(heap.pop()?.value).toBe(2);
    expect(heap.pop()?.value).toBe(5);
    expect(heap.pop()?.value).toBe(9);
  });

  it('returns null when empty', () => {
    const heap = new MinHeap();
    expect(heap.pop()).toBeNull();
    expect(heap.peek()).toBeNull();
  });
});
