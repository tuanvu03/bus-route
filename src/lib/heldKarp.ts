/**
 * Exact visiting-order optimisation.
 *
 * Key-point matrix layout:
 *   0            = start
 *   1..n         = selected stops
 *   n + 1        = destination
 *
 * Held-Karp runs over subsets of stops, fixing start as the origin and
 * destination as the final node. The matrix may be asymmetric (one-way
 * streets), so no symmetry shortcuts are used.
 */
export interface OrderSolution {
  /** Matrix indices: [start, ...stops, destination]. */
  order: number[];
  cost: number;
}

export interface ScoredOrder {
  order: number[];
  cost: number;
}

export function legCost(matrix: ReadonlyArray<ReadonlyArray<number>>, order: number[]): number {
  let total = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    const c = matrix[order[i]][order[i + 1]];
    if (!Number.isFinite(c)) return Infinity;
    total += c;
  }
  return total;
}

/** Held-Karp dynamic programming over stop subsets. */
export function solveVisitOrder(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
): OrderSolution | null {
  const size = matrix.length;
  const n = size - 2;
  if (n < 0) return null;
  if (n === 0) {
    const cost = matrix[0][1];
    return Number.isFinite(cost) ? { order: [0, 1], cost } : null;
  }

  const full = (1 << n) - 1;
  const dp = new Float64Array((1 << n) * n).fill(Infinity);
  const parent = new Int16Array((1 << n) * n).fill(-1);

  for (let j = 0; j < n; j++) {
    const cost = matrix[0][j + 1];
    if (Number.isFinite(cost)) dp[(1 << j) * n + j] = cost;
  }

  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const current = dp[mask * n + j];
      if (!Number.isFinite(current)) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const step = matrix[j + 1][k + 1];
        if (!Number.isFinite(step)) continue;
        const nextMask = mask | (1 << k);
        const candidate = current + step;
        if (candidate < dp[nextMask * n + k]) {
          dp[nextMask * n + k] = candidate;
          parent[nextMask * n + k] = j;
        }
      }
    }
  }

  let bestCost = Infinity;
  let bestEnd = -1;
  for (let j = 0; j < n; j++) {
    const partial = dp[full * n + j];
    if (!Number.isFinite(partial)) continue;
    const finish = matrix[j + 1][n + 1];
    if (!Number.isFinite(finish)) continue;
    const total = partial + finish;
    if (total < bestCost) {
      bestCost = total;
      bestEnd = j;
    }
  }

  if (bestEnd === -1) return null;

  const stopOrder: number[] = [];
  let mask = full;
  let j = bestEnd;
  while (j !== -1) {
    stopOrder.push(j + 1);
    const p = parent[mask * n + j];
    mask ^= 1 << j;
    j = p;
  }
  stopOrder.reverse();

  return { order: [0, ...stopOrder, n + 1], cost: bestCost };
}

/** All permutations (used by unit tests and, for small n, alternative orders). */
export function bruteForceOrders(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  limit = Infinity,
): ScoredOrder[] {
  const n = matrix.length - 2;
  const results: ScoredOrder[] = [];
  const used = new Uint8Array(n);
  const current: number[] = [];

  const visit = () => {
    if (current.length === n) {
      const order = [0, ...current.map((i) => i + 1), n + 1];
      const cost = legCost(matrix, order);
      if (Number.isFinite(cost)) results.push({ order, cost });
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = 1;
      current.push(i);
      visit();
      current.pop();
      used[i] = 0;
    }
  };

  visit();
  results.sort((a, b) => a.cost - b.cost);
  return Number.isFinite(limit) ? results.slice(0, limit) : results;
}
