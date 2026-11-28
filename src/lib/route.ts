import { dijkstraDistances, reconstructPath, type DistanceResult } from './dijkstra';
import {
  bruteForceOrders,
  greedyVisitOrder,
  heuristicVisitOrder,
  legCost,
  solveVisitOrder,
  type HeuristicResult,
  type OrderSolution,
} from './heldKarp';
import type { Coord, Graph, StopInfo, VertexId } from './types';
import { vertexCoord, vertexCount } from './types';
import { BUS_CAPACITY, HELD_KARP_MAX_STOPS } from '../config';

export const LEG_COLORS = [
  '#2563eb',
  '#e07a1f',
  '#0f9d78',
  '#d6336c',
  '#7c4dff',
  '#0891b2',
  '#b7791f',
  '#c53030',
  '#5b6472',
  '#2f855a',
  '#9b2c2c',
  '#4a5568',
] as const;

/** Mode selected by the user. */
export type AlgorithmMode = 'greedy' | 'held-karp' | 'compare';
/** Algorithm that actually produced a particular route. */
export type AlgorithmKind = 'greedy' | 'exact' | 'heuristic';

export const ALGORITHM_LABEL: Record<AlgorithmKind, string> = {
  greedy: 'Greedy',
  exact: 'Exact (Held-Karp)',
  heuristic: 'Heuristic (not proven optimal)',
};

export type KeyKind = 'start' | 'stop' | 'destination';

export interface KeyPoint {
  kind: KeyKind;
  name: string;
  vertex: VertexId;
  stop?: StopInfo;
  /** Original OSM coordinate (may differ from the snapped vertex). */
  coord: Coord;
}

export interface RouteLeg {
  from: number;
  to: number;
  path: VertexId[];
  distance: number;
  color: string;
}

export interface AlternativeOrder {
  order: number[];
  cost: number;
  delta: number;
}

export interface HeuristicInfo {
  initialOrder: number[];
  initialDistance: number;
  improvedOrder: number[];
  improvedDistance: number;
  improvedBy: number;
  passes: number;
}

export interface RoutePlan {
  points: KeyPoint[];
  matrix: number[][];
  /** Matrix indices: start, stops..., destination. */
  order: number[];
  legs: RouteLeg[];
  totalDistance: number;
  alternatives: AlternativeOrder[];
  geometry: RouteGeometry;
  algorithm: AlgorithmKind;
  algorithmLabel: string;
  solveMs: number;
  /** Present when the heuristic fallback produced this plan. */
  heuristic?: HeuristicInfo;
}

export interface SelectedStop {
  stop: StopInfo;
  passengers: number;
}

export interface UnreachableInfo {
  pairs: { from: number; to: number; fromName: string; toName: string }[];
  message: string;
}

export interface DivergenceLeg {
  /** 0-based leg position in both orders. */
  legIndex: number;
  from: number;
  greedyTo: number;
  optimalTo: number;
  greedyDistance: number;
  optimalDistance: number;
}

export interface Comparison {
  greedy: RoutePlan;
  optimal: RoutePlan;
  /** greedy - optimal, in metres. */
  gap: number;
  /** gap as a percentage of the optimal distance. */
  gapPct: number;
  /** True when the two totals agree within 0.5 m. */
  equal: boolean;
  exact: boolean;
  divergence: DivergenceLeg | null;
}

export interface SolveProgress {
  phase: 'matrix' | 'greedy' | 'held-karp' | 'heuristic' | 'building';
  /** 0..1 */
  progress: number;
  detail?: string;
}

export interface SolveOptions {
  mode?: AlgorithmMode;
  hkLimit?: number;
  onProgress?: (progress: SolveProgress) => void;
}

export interface SolveResult {
  mode: AlgorithmMode;
  points: KeyPoint[];
  matrix: number[][];
  /** Primary plan for the selected mode (optimal/heuristic for B and C). */
  plan: RoutePlan | null;
  greedy: RoutePlan | null;
  optimal: RoutePlan | null;
  comparison: Comparison | null;
  unreachable: UnreachableInfo | null;
  matrixMs: number;
  hkLimit: number;
  /** Human-readable warnings, e.g. the exact-solver fallback notice. */
  warnings: string[];
}

export interface OptimizeResult {
  plan: RoutePlan | null;
  unreachable: UnreachableInfo | null;
}

export function keyPoints(graph: Graph, selected: SelectedStop[]): KeyPoint[] {
  const points: KeyPoint[] = [
    {
      kind: 'start',
      name: graph.start.name,
      vertex: graph.start.vertex,
      coord: [graph.start.lon, graph.start.lat],
    },
    ...selected.map((s) => ({
      kind: 'stop' as const,
      name: s.stop.name,
      vertex: s.stop.vertex,
      stop: s.stop,
      coord: [s.stop.lon, s.stop.lat] as Coord,
    })),
    {
      kind: 'destination',
      name: graph.destination.name,
      vertex: graph.destination.vertex,
      coord: [graph.destination.lon, graph.destination.lat],
    },
  ];
  return points;
}

/**
 * Build the directed distance matrix with n+1 Dijkstra searches for n stops:
 * one from the start and one from each stop. The destination is terminal, so
 * its outgoing row is intentionally not computed (NaN in the matrix).
 *
 * Every search stops as soon as all key-point targets are settled. Only
 * distance and predecessor arrays are kept — no settlement logs — because the
 * inspector computes a log lazily for whichever leg the user opens.
 */
export function buildMatrix(
  graph: Graph,
  points: KeyPoint[],
  onProgress?: (progress: SolveProgress) => void,
): {
  matrix: number[][];
  sources: (DistanceResult | null)[];
} {
  const n = vertexCount(graph);
  const size = points.length;
  const targets = new Set(points.map((p) => p.vertex));
  const sources: (DistanceResult | null)[] = new Array(size).fill(null);
  const matrix: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(NaN),
  );

  // The destination (last row) never needs to be a source for a route.
  const sourceCount = Math.max(0, size - 1);
  for (let i = 0; i < sourceCount; i++) {
    const result = dijkstraDistances(graph.adj, n, points[i].vertex, targets);
    sources[i] = result;
    for (let j = 0; j < size; j++) {
      matrix[i][j] = result.dist[points[j].vertex];
    }
    onProgress?.({
      phase: 'matrix',
      progress: sourceCount === 0 ? 1 : (i + 1) / sourceCount,
      detail: `Dijkstra ${i + 1}/${sourceCount}`,
    });
  }
  return { matrix, sources };
}

export function findAllUnreachable(matrix: number[][]): UnreachableInfo['pairs'] {
  const pairs: UnreachableInfo['pairs'] = [];
  // The last row (destination) is not computed; only rows that can start a leg
  // matter for feasibility.
  for (let i = 0; i < matrix.length - 1; i++) {
    for (let j = 0; j < matrix.length; j++) {
      if (i !== j && !Number.isFinite(matrix[i][j])) {
        pairs.push({ from: i, to: j, fromName: '', toName: '' });
      }
    }
  }
  return pairs;
}

function unreachableResult(points: KeyPoint[], matrix: number[][]): UnreachableInfo {
  const rawPairs = findAllUnreachable(matrix);
  const nameOf = (i: number) => points[i]?.name ?? `#${i}`;
  const pairs = rawPairs.slice(0, 6).map((p) => ({
    ...p,
    fromName: nameOf(p.from),
    toName: nameOf(p.to),
  }));
  return {
    pairs,
    message:
      rawPairs.length > 0
        ? `No visiting order is possible: ${rawPairs.length} directed pair${
            rawPairs.length === 1 ? ' is' : 's are'
          } unreachable. One-way streets can make a stop impossible to reach from a particular direction.`
        : 'No complete visiting order exists for the selected stops.',
  };
}

/** A few valid alternative visiting orders, useful for teaching. */
function buildAlternatives(
  matrix: number[][],
  chosen: OrderSolution,
  limit = 3,
): AlternativeOrder[] {
  const n = matrix.length - 2;
  const alternatives: AlternativeOrder[] = [];
  const seen = new Set<string>([chosen.order.join(',')]);

  if (n <= 7) {
    const top = bruteForceOrders(matrix, limit + 1);
    for (const alt of top) {
      if (seen.has(alt.order.join(','))) continue;
      seen.add(alt.order.join(','));
      alternatives.push({
        order: alt.order,
        cost: alt.cost,
        delta: alt.cost - chosen.cost,
      });
      if (alternatives.length >= limit) break;
    }
    return alternatives;
  }

  const candidates: ScoredCandidate[] = [];
  const stops = chosen.order.slice(1, -1);
  const destination = matrix.length - 1;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const swapped = stops.slice();
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      const order = [0, ...swapped, destination];
      const key = order.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const cost = legCost(matrix, order);
      if (Number.isFinite(cost)) candidates.push({ order, cost });
    }
  }
  for (let i = 0; i < stops.length; i++) {
    for (let j = 0; j < stops.length; j++) {
      if (i === j) continue;
      const moved = stops.slice();
      const [value] = moved.splice(i, 1);
      moved.splice(j, 0, value);
      const order = [0, ...moved, destination];
      const key = order.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const cost = legCost(matrix, order);
      if (Number.isFinite(cost)) candidates.push({ order, cost });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  for (const alt of candidates) {
    if (!(alt.cost > chosen.cost + 1e-9)) continue;
    alternatives.push({
      order: alt.order,
      cost: alt.cost,
      delta: alt.cost - chosen.cost,
    });
    if (alternatives.length >= limit) break;
  }
  return alternatives;
}

interface ScoredCandidate {
  order: number[];
  cost: number;
}

function buildPlan(
  graph: Graph,
  selected: SelectedStop[],
  points: KeyPoint[],
  matrix: number[][],
  sources: (DistanceResult | null)[],
  solution: OrderSolution,
  algorithm: AlgorithmKind,
  solveMs: number,
  heuristic?: HeuristicInfo,
): RoutePlan | null {
  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < solution.order.length; i++) {
    const from = solution.order[i];
    const to = solution.order[i + 1];
    const source = sources[from];
    if (!source) return null;
    const path = reconstructPath(source, points[to].vertex);
    if (!path) return null;
    legs.push({
      from,
      to,
      path,
      distance: matrix[from][to],
      color: LEG_COLORS[i % LEG_COLORS.length],
    });
  }

  const geometry = buildRouteGeometry(graph, legs, selected);
  const alternatives =
    algorithm === 'greedy' ? [] : buildAlternatives(matrix, solution, 3);

  return {
    points,
    matrix,
    order: solution.order,
    legs,
    totalDistance: solution.cost,
    alternatives,
    geometry,
    algorithm,
    algorithmLabel: ALGORITHM_LABEL[algorithm],
    solveMs,
    heuristic,
  };
}

function findDivergence(
  greedy: RoutePlan,
  optimal: RoutePlan,
  matrix: number[][],
): DivergenceLeg | null {
  const length = Math.min(greedy.order.length, optimal.order.length);
  for (let i = 1; i < length; i++) {
    if (greedy.order[i] !== optimal.order[i]) {
      const legIndex = i - 1;
      const from = greedy.order[legIndex];
      return {
        legIndex,
        from,
        greedyTo: greedy.order[i],
        optimalTo: optimal.order[i],
        greedyDistance: matrix[from][greedy.order[i]],
        optimalDistance: matrix[from][optimal.order[i]],
      };
    }
  }
  return null;
}

/**
 * Compute the selected mode from one shared distance matrix.
 *
 * Mode A: greedy nearest stop (Dijkstra-only).
 * Mode B: exact Held-Karp, or the nearest-neighbour + Or-opt heuristic when
 *         the selected stop count exceeds hkLimit.
 * Mode C: both from the exact same matrix, with a comparison.
 */
export function solveRoute(
  graph: Graph,
  selected: SelectedStop[],
  options: SolveOptions = {},
): SolveResult {
  const mode = options.mode ?? 'compare';
  const hkLimit = Math.max(0, Math.floor(options.hkLimit ?? HELD_KARP_MAX_STOPS));
  const points = keyPoints(graph, selected);
  const n = selected.length;
  const warnings: string[] = [];

  const matrixStarted = performance.now();
  const { matrix, sources } = buildMatrix(graph, points, options.onProgress);
  const matrixMs = Math.max(0, performance.now() - matrixStarted);

  const exactRequested = mode === 'held-karp' || mode === 'compare';
  const exactAvailable = n <= hkLimit;
  if (exactRequested && !exactAvailable) {
    warnings.push(
      `Exact optimization (Held-Karp) is not available for n > ${hkLimit} stops. Using a heuristic instead; the result is NOT guaranteed optimal.`,
    );
  }

  const solveGreedy = (): RoutePlan | null => {
    if (mode !== 'greedy' && mode !== 'compare') return null;
    const started = performance.now();
    const solution = greedyVisitOrder(matrix, points);
    const solveMs = Math.max(0, performance.now() - started);
    if (!solution) return null;
    return buildPlan(
      graph,
      selected,
      points,
      matrix,
      sources,
      solution,
      'greedy',
      solveMs,
    );
  };

  const solveOptimal = (): RoutePlan | null => {
    if (mode !== 'held-karp' && mode !== 'compare') return null;
    const started = performance.now();
    let solution: OrderSolution | null = null;
    let heuristic: HeuristicInfo | undefined;
    if (exactAvailable) {
      options.onProgress?.({ phase: 'held-karp', progress: 0, detail: `n = ${n}` });
      solution = solveVisitOrder(matrix, {
        onProgress: (fraction) =>
          options.onProgress?.({
            phase: 'held-karp',
            progress: fraction,
            detail: `n = ${n}`,
          }),
      });
    } else {
      options.onProgress?.({ phase: 'heuristic', progress: 0, detail: `n = ${n}` });
      const result: HeuristicResult | null = heuristicVisitOrder(matrix, points, {
        onProgress: (fraction) =>
          options.onProgress?.({
            phase: 'heuristic',
            progress: fraction,
            detail: `n = ${n}`,
          }),
      });
      if (result) {
        solution = result.solution;
        heuristic = {
          initialOrder: result.initial.order,
          initialDistance: result.initial.cost,
          improvedOrder: result.improved.order,
          improvedDistance: result.improved.cost,
          improvedBy: result.improvedBy,
          passes: result.passes,
        };
      }
    }
    const solveMs = Math.max(0, performance.now() - started);
    if (!solution) return null;
    return buildPlan(
      graph,
      selected,
      points,
      matrix,
      sources,
      solution,
      exactAvailable ? 'exact' : 'heuristic',
      solveMs,
      heuristic,
    );
  };

  const greedy = solveGreedy();
  const optimal = solveOptimal();

  if (!greedy && !optimal) {
    return {
      mode,
      points,
      matrix,
      plan: null,
      greedy: null,
      optimal: null,
      comparison: null,
      unreachable: unreachableResult(points, matrix),
      matrixMs,
      hkLimit,
      warnings,
    };
  }

  // A mode that was requested but could not build its plan means at least one
  // directed leg is unreachable; report it instead of silently swapping modes.
  if ((mode === 'greedy' && !greedy) || (mode === 'held-karp' && !optimal)) {
    return {
      mode,
      points,
      matrix,
      plan: null,
      greedy,
      optimal,
      comparison: null,
      unreachable: unreachableResult(points, matrix),
      matrixMs,
      hkLimit,
      warnings,
    };
  }

  let comparison: Comparison | null = null;
  if (mode === 'compare') {
    if (!greedy || !optimal) {
      return {
        mode,
        points,
        matrix,
        plan: optimal ?? greedy,
        greedy,
        optimal,
        comparison: null,
        unreachable: unreachableResult(points, matrix),
        matrixMs,
        hkLimit,
        warnings,
      };
    }
    const gap = greedy.totalDistance - optimal.totalDistance;
    comparison = {
      greedy,
      optimal,
      gap,
      gapPct:
        optimal.totalDistance > 0
          ? (gap / optimal.totalDistance) * 100
          : 0,
      equal: Math.abs(gap) <= 0.5,
      exact: optimal.algorithm === 'exact',
      divergence: findDivergence(greedy, optimal, matrix),
    };
  }

  const plan = mode === 'greedy' ? greedy : optimal;
  return {
    mode,
    points,
    matrix,
    plan,
    greedy,
    optimal,
    comparison,
    unreachable: null,
    matrixMs,
    hkLimit,
    warnings,
  };
}

/** Backwards-compatible helper used by tests and scripts. */
export function optimizeRoute(
  graph: Graph,
  selected: SelectedStop[],
  options: { hkLimit?: number; onProgress?: (progress: SolveProgress) => void } = {},
): OptimizeResult {
  const result = solveRoute(graph, selected, {
    mode: 'held-karp',
    hkLimit: options.hkLimit ?? HELD_KARP_MAX_STOPS,
    onProgress: options.onProgress,
  });
  return { plan: result.plan, unreachable: result.unreachable };
}

// --- stitched geometry for map rendering and animation -------------------

export interface RouteGeometry {
  coords: Coord[];
  /** cumulative[i] = distance from route start to coords[i]. */
  cumulative: number[];
  totalDistance: number;
  stopEvents: StopEvent[];
  legRanges: { start: number; end: number; distance: number; color: string; legIndex: number }[];
}

export interface StopEvent {
  /** Distance along the stitched route at which the stop is reached. */
  at: number;
  stopId: string;
  name: string;
  passengers: number;
  coord: Coord;
  order: number;
  isDestination: boolean;
}

export function buildRouteGeometry(
  graph: Graph,
  legs: RouteLeg[],
  selected: SelectedStop[],
): RouteGeometry {
  const coords: Coord[] = [];
  const cumulative: number[] = [];
  const stopEvents: StopEvent[] = [];
  const legRanges: RouteGeometry['legRanges'] = [];
  let distance = 0;

  const push = (c: Coord) => {
    const last = coords[coords.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) return;
    if (last) {
      const [lon1, lat1] = last;
      const [lon2, lat2] = c;
      // Inline haversine to avoid an import cycle in hot animation code.
      const toRad = Math.PI / 180;
      const p1 = lat1 * toRad;
      const p2 = lat2 * toRad;
      const dp = (lat2 - lat1) * toRad;
      const dl = (lon2 - lon1) * toRad;
      const h =
        Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      distance += 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    coords.push(c);
    cumulative.push(distance);
  };

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const legStart = distance;
    for (const v of leg.path) push(vertexCoord(graph, v));
    legRanges.push({
      start: legStart,
      end: distance,
      distance: leg.distance,
      color: leg.color,
      legIndex: i,
    });

    const isLast = i === legs.length - 1;
    if (isLast) {
      stopEvents.push({
        at: distance,
        stopId: 'destination',
        name: graph.destination.name,
        passengers: 0,
        coord: [graph.destination.lon, graph.destination.lat],
        order: i,
        isDestination: true,
      });
    } else {
      // leg.to is the matrix index of the pickup stop reached at the end of this leg.
      const sel = selected[leg.to - 1];
      const point = leg.path[leg.path.length - 1];
      stopEvents.push({
        at: distance,
        stopId: sel?.stop.id ?? `stop-${i}`,
        name: sel?.stop.name ?? `Stop ${i + 1}`,
        passengers: sel?.passengers ?? 0,
        coord: vertexCoord(graph, point),
        order: i,
        isDestination: false,
      });
    }
  }

  return { coords, cumulative, totalDistance: distance, stopEvents, legRanges };
}

export function pointAtDistance(
  geometry: RouteGeometry,
  at: number,
): { coord: Coord; legIndex: number; segmentIndex: number } {
  const total = geometry.totalDistance;
  const d = Math.max(0, Math.min(at, total));
  const cum = geometry.cumulative;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const i = Math.min(lo, geometry.coords.length - 2);
  const a = geometry.coords[i];
  const b = geometry.coords[i + 1] ?? a;
  const span = cum[i + 1] - cum[i];
  const t = span > 0 ? (d - cum[i]) / span : 0;
  const leg = geometry.legRanges.find((r) => d >= r.start && d <= r.end) ?? geometry.legRanges[0];
  return {
    coord: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    legIndex: leg?.legIndex ?? 0,
    segmentIndex: i,
  };
}

export function totalPassengers(selected: SelectedStop[]): number {
  return selected.reduce((sum, s) => sum + s.passengers, 0);
}

/**
 * The only hard limit on a run is bus capacity. There is deliberately no
 * stop-count cap; this helper keeps the existing validation message in one
 * place for the UI and tests.
 */
export function selectionCapacityError(selected: SelectedStop[]): string | null {
  const total = totalPassengers(selected);
  if (total <= BUS_CAPACITY) return null;
  return `Total passengers exceed the bus capacity by ${total - BUS_CAPACITY}.`;
}
