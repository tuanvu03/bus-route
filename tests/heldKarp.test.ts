import { describe, expect, it } from 'vitest';
import { bruteForceOrders, legCost, solveVisitOrder } from '../src/lib/heldKarp';
import { rng } from './helpers';

function randomMatrix(n: number, random: () => number, sparse = false): number[][] {
  const size = n + 2;
  const m: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue;
      m[i][j] = sparse && random() < 0.18 ? Infinity : 1 + Math.floor(random() * 100);
    }
  }
  return m;
}

describe('Held-Karp visiting order', () => {
  it('matches brute force on random asymmetric matrices', () => {
    const random = rng(918273);
    for (let n = 1; n <= 7; n++) {
      for (let trial = 0; trial < 12; trial++) {
        const matrix = randomMatrix(n, random);
        const heldKarp = solveVisitOrder(matrix);
        const best = bruteForceOrders(matrix, 1)[0];
        expect(heldKarp).not.toBeNull();
        expect(heldKarp!.order).toHaveLength(n + 2);
        expect(heldKarp!.order[0]).toBe(0);
        expect(heldKarp!.order[n + 1]).toBe(n + 1);
        expect(new Set(heldKarp!.order.slice(1, n + 1)).size).toBe(n);
        expect(heldKarp!.cost).toBeCloseTo(best.cost, 8);
        expect(legCost(matrix, heldKarp!.order)).toBeCloseTo(heldKarp!.cost, 8);
      }
    }
  });

  it('handles sparse matrices with unreachable pairs', () => {
    const random = rng(551199);
    for (let n = 2; n <= 7; n++) {
      for (let trial = 0; trial < 20; trial++) {
        const matrix = randomMatrix(n, random, true);
        const heldKarp = solveVisitOrder(matrix);
        const best = bruteForceOrders(matrix, 1)[0];
        if (!best) {
          expect(heldKarp).toBeNull();
        } else {
          expect(heldKarp).not.toBeNull();
          expect(heldKarp!.cost).toBeCloseTo(best.cost, 8);
        }
      }
    }
  });

  it('returns null when no complete order exists', () => {
    const matrix = [
      [0, 1, Infinity],
      [1, 0, Infinity],
      [1, 1, 0],
    ];
    expect(solveVisitOrder(matrix)).toBeNull();
  });

  it('handles a zero-stop trip', () => {
    const solution = solveVisitOrder([
      [0, 12],
      [9, 0],
    ]);
    expect(solution).toEqual({ order: [0, 1], cost: 12 });
  });

  it('finds the exact optimum for nine stops quickly', () => {
    const random = rng(77);
    const matrix = randomMatrix(9, random);
    const started = performance.now();
    const solution = solveVisitOrder(matrix);
    const elapsed = performance.now() - started;
    expect(solution).not.toBeNull();
    expect(elapsed).toBeLessThan(100);
    expect(legCost(matrix, solution!.order)).toBeCloseTo(solution!.cost, 8);
  });
});
