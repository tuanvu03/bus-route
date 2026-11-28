/**
 * Visiting-order optimisation for an asymmetric (directed) distance matrix.
 *
 * Matrix layout:
 *   0            = start
 *   1..n         = selected stops
 *   n + 1        = destination
 *
 * One-way streets make d(A,B) ≠ d(B,A), so no symmetry shortcuts are used.
 * Held-Karp is implemented with flat typed arrays: Float64Array for costs and
 * Int8Array (Int16Array above 127 stops) for parent pointers. No Maps or
 * nested state arrays are allocated inside the DP.
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

export interface HeuristicResult {
  solution: OrderSolution;
  initial: OrderSolution;
  improved: OrderSolution;
  passes: number;
  /** initial.cost - improved.cost, in metres. */
  improvedBy: number;
}

export interface HeldKarpOptions {
  /** Called with a fraction in [0, 1] while the DP fills. */
  onProgress?: (fraction: number) => void;
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

/** Held-Karp dynamic programming over stop subsets, using flat typed arrays. */
export function solveVisitOrder(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  options: HeldKarpOptions = {},
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
  const parent =
    n <= 127
      ? new Int8Array((1 << n) * n).fill(-1)
      : new Int16Array((1 << n) * n).fill(-1);
  const progress = options.onProgress;
  const progressEvery = n >= 18 ? 1024 : n >= 14 ? 256 : 64;

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
    if (progress && (mask & (progressEvery - 1)) === 0) {
      progress(mask / full);
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

  progress?.(1);
  return { order: [0, ...stopOrder, n + 1], cost: bestCost };
}

/**
 * Greedy nearest-neighbour order. The next stop is the one with the smallest
 * directed road distance from the current position. Ties are broken by the
 * smaller graph vertex id, then by matrix index — deterministic on every run.
 */
export function greedyVisitOrder(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  points?: ReadonlyArray<{ vertex: number }>,
): OrderSolution | null {
  const size = matrix.length;
  const n = size - 2;
  if (n < 0) return null;
  if (n === 0) {
    const cost = matrix[0][1];
    return Number.isFinite(cost) ? { order: [0, 1], cost } : null;
  }

  const remaining = new Set<number>();
  for (let i = 1; i <= n; i++) remaining.add(i);

  const order = [0];
  let current = 0;
  while (remaining.size > 0) {
    let best = -1;
    let bestDistance = Infinity;
    for (const candidate of remaining) {
      const distance = matrix[current][candidate];
      if (!Number.isFinite(distance)) continue;
      if (distance < bestDistance - 1e-9) {
        bestDistance = distance;
        best = candidate;
      } else if (
        Math.abs(distance - bestDistance) <= 1e-9 &&
        (best === -1 ||
          (points?.[candidate]?.vertex ?? candidate) <
            (points?.[best]?.vertex ?? best))
      ) {
        best = candidate;
      }
    }
    if (best === -1) return null;
    order.push(best);
    remaining.delete(best);
    current = best;
  }

  const destination = n + 1;
  if (!Number.isFinite(matrix[current][destination])) return null;
  order.push(destination);
  return { order, cost: legCost(matrix, order) };
}

/** Deterministic order of a stop sequence after removing `[from, from+length)`. */
function insertSegment(
  stops: number[],
  from: number,
  length: number,
  position: number,
): number[] {
  const segment = stops.slice(from, from + length);
  const without = stops.slice(0, from).concat(stops.slice(from + length));
  const at = Math.min(position, without.length);
  return without.slice(0, at).concat(segment, without.slice(at));
}

/**
 * Or-opt local search: move segments of 1–3 stops to a different position
 * without reversing them. This is valid for an asymmetric matrix; reversal-
 * based 2-opt is deliberately NOT used because it would assume d(i,j)=d(j,i).
 * The start and destination remain fixed.
 */
export function orOptImprove(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  startOrder: OrderSolution,
  options: { onProgress?: (fraction: number) => void; maxPasses?: number } = {},
): { solution: OrderSolution; passes: number } {
  const maxPasses = options.maxPasses ?? 50;
  const n = startOrder.order.length - 2;
  if (n <= 2) return { solution: startOrder, passes: 0 };

  const destination = matrix.length - 1;
  let bestOrder = startOrder.order.slice();
  let bestCost = startOrder.cost;
  let passes = 0;
  const progress = options.onProgress;

  for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1;
    let improvedThisPass = false;

    for (let length = 1; length <= 3; length++) {
      if (length >= n) continue;
      const stops = bestOrder.slice(1, -1);
      for (let from = 0; from + length <= stops.length; from++) {
        const withoutLength = stops.length - length;
        for (let position = 0; position <= withoutLength; position++) {
          if (position === from) continue;
          const candidateStops = insertSegment(stops, from, length, position);
          if (candidateStops.every((value, i) => value === stops[i])) continue;
          const candidateOrder = [0, ...candidateStops, destination];
          const cost = legCost(matrix, candidateOrder);
          if (cost < bestCost - 1e-9) {
            bestCost = cost;
            bestOrder = candidateOrder;
            improvedThisPass = true;
          }
        }
      }
    }

    progress?.(Math.min(1, (pass + 1) / maxPasses));
    if (!improvedThisPass) break;
  }

  progress?.(1);
  return { solution: { order: bestOrder, cost: bestCost }, passes };
}

/**
 * Heuristic used when n exceeds HELD_KARP_MAX_STOPS.
 * Starts from the greedy nearest-neighbour order and improves it with Or-opt.
 * The result is explicitly not proven optimal.
 */
export function heuristicVisitOrder(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  points?: ReadonlyArray<{ vertex: number }>,
  options: { onProgress?: (fraction: number) => void } = {},
): HeuristicResult | null {
  const initial = greedyVisitOrder(matrix, points);
  if (!initial) return null;
  const { solution, passes } = orOptImprove(matrix, initial, {
    onProgress: options.onProgress,
  });
  return {
    solution,
    initial,
    improved: solution,
    passes,
    improvedBy: initial.cost - solution.cost,
  };
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

/** Approximate peak memory of the Held-Karp DP arrays, in bytes. */
export function heldKarpMemoryBytes(n: number): number {
  if (n <= 0) return 0;
  const states = (1 << n) * n;
  return states * 8 + states * (n <= 127 ? 1 : 2);
}
