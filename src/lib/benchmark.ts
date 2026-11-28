import { dijkstraDistances, type DistanceResult } from './dijkstra';
import {
  greedyVisitOrder,
  heuristicVisitOrder,
  solveVisitOrder,
  type OrderSolution,
} from './heldKarp';
import type { Graph, StopInfo } from './types';
import { vertexCount } from './types';
import { deriveScenarioSeed } from './random';
import { generateScenario } from './scenario';
import type { AlgorithmKind, KeyPoint } from './route';

export interface BenchmarkConfig {
  /** Stop counts to evaluate, e.g. [2,3,...,15]. */
  kValues: number[];
  scenariosPerK: number;
  baseSeed: number;
  passengersPerStop: number;
  hkLimit: number;
}

export interface ScenarioResult {
  k: number;
  /** 0-based scenario index within this k. */
  index: number;
  /** Benchmark base seed (shown in the export for completeness). */
  baseSeed: number;
  /** Per-scenario seed derived from baseSeed, k and index. */
  seed: number;
  stopIds: string[];
  greedyOrder: string[];
  optimalOrder: string[];
  greedyDistance: number;
  optimalDistance: number;
  gapMeters: number;
  gapPct: number;
  greedyMs: number;
  optimalMs: number;
  algorithm: AlgorithmKind;
  skipped: boolean;
  /** Set when optimal > greedy (+ epsilon) for an exact solve. */
  bug: boolean;
  reason?: string;
}

export interface KSummary {
  k: number;
  scenarios: ScenarioResult[];
  count: number;
  skipped: number;
  violations: number;
  /** Percentage (0..100) of scenarios where greedy == optimal within 0.5 m. */
  greedyOptimalRate: number;
  meanGap: number;
  medianGap: number;
  p90Gap: number;
  maxGap: number;
  meanGapPct: number;
  medianGapPct: number;
  p90GapPct: number;
  maxGapPct: number;
  meanGreedyMs: number;
  meanOptimalMs: number;
  algorithm: AlgorithmKind;
}

export interface BenchmarkProgress {
  phase: 'cache' | 'scenarios' | 'summary';
  progress: number;
  k?: number;
  scenarioIndex?: number;
  cachedSources?: number;
  totalSources?: number;
  detail?: string;
}

export interface CacheEntry {
  dist: Float64Array;
  prev: Int32Array;
}

export type DistanceCache = Map<number, CacheEntry>;

export interface BenchmarkResult {
  config: BenchmarkConfig;
  summaries: KSummary[];
  cacheMs: number;
  totalMs: number;
  skipped: number;
  violations: number;
}

const EPS = 1e-6;
const EQUAL_METERS = 0.5;

/** Run one single-source search per source vertex and keep it for all scenarios. */
export function buildDistanceCache(
  graph: Graph,
  candidates: ReadonlyArray<StopInfo>,
  onProgress?: (progress: BenchmarkProgress) => void,
): { cache: DistanceCache; cacheMs: number } {
  const started = performance.now();
  const n = vertexCount(graph);
  const sourceVertices = new Set<number>([graph.start.vertex]);
  for (const stop of candidates) sourceVertices.add(stop.vertex);
  const targets = new Set<number>([graph.destination.vertex]);
  for (const stop of candidates) targets.add(stop.vertex);

  const sources = [...sourceVertices];
  const cache: DistanceCache = new Map();
  for (let i = 0; i < sources.length; i++) {
    const vertex = sources[i];
    const result: DistanceResult = dijkstraDistances(graph.adj, n, vertex, targets);
    cache.set(vertex, { dist: result.dist, prev: result.prev });
    onProgress?.({
      phase: 'cache',
      progress: (i + 1) / sources.length,
      cachedSources: i + 1,
      totalSources: sources.length,
      detail: `Dijkstra cache ${i + 1}/${sources.length}`,
    });
  }
  return { cache, cacheMs: Math.max(0, performance.now() - started) };
}

function pointsFor(
  graph: Graph,
  stops: ReadonlyArray<StopInfo>,
): KeyPoint[] {
  return [
    {
      kind: 'start',
      name: graph.start.name,
      vertex: graph.start.vertex,
      coord: [graph.start.lon, graph.start.lat],
    },
    ...stops.map((stop) => ({
      kind: 'stop' as const,
      name: stop.name,
      vertex: stop.vertex,
      stop,
      coord: [stop.lon, stop.lat] as [number, number],
    })),
    {
      kind: 'destination',
      name: graph.destination.name,
      vertex: graph.destination.vertex,
      coord: [graph.destination.lon, graph.destination.lat],
    },
  ];
}

function matrixFromCache(
  cache: DistanceCache,
  points: ReadonlyArray<KeyPoint>,
): number[][] {
  const size = points.length;
  const matrix: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(NaN),
  );
  for (let i = 0; i < size - 1; i++) {
    const entry = cache.get(points[i].vertex);
    if (!entry) continue;
    for (let j = 0; j < size; j++) {
      matrix[i][j] = entry.dist[points[j].vertex];
    }
  }
  return matrix;
}

function matrixReachable(matrix: number[][]): boolean {
  for (let i = 0; i < matrix.length - 1; i++) {
    for (let j = 0; j < matrix.length; j++) {
      if (i !== j && !Number.isFinite(matrix[i][j])) return false;
    }
  }
  return true;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function summarize(k: number, scenarios: ScenarioResult[]): KSummary {
  const valid = scenarios.filter((scenario) => !scenario.skipped);
  const gaps = valid.map((scenario) => scenario.gapMeters);
  const gapsPct = valid.map((scenario) => scenario.gapPct);
  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const sortedGapsPct = gapsPct.slice().sort((a, b) => a - b);
  const equalCount = valid.filter(
    (scenario) => Math.abs(scenario.gapMeters) <= EQUAL_METERS,
  ).length;
  const violations = scenarios.filter((scenario) => scenario.bug).length;
  const algorithm: AlgorithmKind = valid[0]?.algorithm ?? 'exact';

  return {
    k,
    scenarios,
    count: valid.length,
    skipped: scenarios.filter((scenario) => scenario.skipped).length,
    violations,
    greedyOptimalRate: valid.length > 0 ? (equalCount / valid.length) * 100 : 0,
    meanGap: mean(gaps),
    medianGap: percentile(sortedGaps, 0.5),
    p90Gap: percentile(sortedGaps, 0.9),
    maxGap: sortedGaps.length > 0 ? sortedGaps[sortedGaps.length - 1] : 0,
    meanGapPct: mean(gapsPct),
    medianGapPct: percentile(sortedGapsPct, 0.5),
    p90GapPct: percentile(sortedGapsPct, 0.9),
    maxGapPct: sortedGapsPct.length > 0 ? sortedGapsPct[sortedGapsPct.length - 1] : 0,
    meanGreedyMs: mean(valid.map((scenario) => scenario.greedyMs)),
    meanOptimalMs: mean(valid.map((scenario) => scenario.optimalMs)),
    algorithm,
  };
}

/** Run one seeded scenario using the shared cache. */
export function runScenario(
  graph: Graph,
  cache: DistanceCache,
  candidates: ReadonlyArray<StopInfo>,
  k: number,
  index: number,
  config: BenchmarkConfig,
): ScenarioResult {
  const seed = deriveScenarioSeed(config.baseSeed, k, index);
  const scenario = generateScenario(candidates, k, seed, config.passengersPerStop);
  const stops = scenario.stops.map((selected) => selected.stop);
  const points = pointsFor(graph, stops);
  const matrix = matrixFromCache(cache, points);
  const stopIds = stops.map((stop) => stop.id);

  const base: Omit<ScenarioResult, 'greedyDistance' | 'optimalDistance' | 'gapMeters' | 'gapPct' | 'greedyMs' | 'optimalMs' | 'algorithm'> = {
    k,
    index,
    baseSeed: config.baseSeed,
    seed,
    stopIds,
    greedyOrder: [],
    optimalOrder: [],
    skipped: false,
    bug: false,
  };

  if (!matrixReachable(matrix)) {
    return {
      ...base,
      greedyDistance: Infinity,
      optimalDistance: Infinity,
      gapMeters: Infinity,
      gapPct: 0,
      greedyMs: 0,
      optimalMs: 0,
      algorithm: k <= config.hkLimit ? 'exact' : 'heuristic',
      skipped: true,
      reason: 'unreachable directed pair',
    };
  }

  const greedyStarted = performance.now();
  const greedy = greedyVisitOrder(matrix, points);
  const greedyMs = Math.max(0, performance.now() - greedyStarted);

  const optimalStarted = performance.now();
  let optimal: OrderSolution | null = null;
  let algorithm: AlgorithmKind;
  if (k <= config.hkLimit) {
    optimal = solveVisitOrder(matrix);
    algorithm = 'exact';
  } else {
    const heuristic = heuristicVisitOrder(matrix, points);
    optimal = heuristic?.solution ?? null;
    algorithm = 'heuristic';
  }
  const optimalMs = Math.max(0, performance.now() - optimalStarted);

  if (!greedy || !optimal) {
    return {
      ...base,
      greedyDistance: greedy?.cost ?? Infinity,
      optimalDistance: optimal?.cost ?? Infinity,
      gapMeters: Infinity,
      gapPct: 0,
      greedyMs,
      optimalMs,
      algorithm,
      skipped: true,
      reason: 'no complete visiting order',
    };
  }

  const gapMeters = greedy.cost - optimal.cost;
  const gapPct = optimal.cost > 0 ? (gapMeters / optimal.cost) * 100 : 0;
  // The heuristic starts from greedy and only accepts improvements, so this
  // assertion is valid for both exact and heuristic rows.
  const bug = optimal.cost > greedy.cost + EPS;

  const stopName = (matrixIndex: number) =>
    matrixIndex === 0
      ? graph.start.id
      : matrixIndex === points.length - 1
        ? graph.destination.id
        : points[matrixIndex].stop?.id ?? `#${matrixIndex}`;

  return {
    ...base,
    greedyOrder: greedy.order.map(stopName),
    optimalOrder: optimal.order.map(stopName),
    greedyDistance: greedy.cost,
    optimalDistance: optimal.cost,
    gapMeters,
    gapPct,
    greedyMs,
    optimalMs,
    algorithm,
    bug,
  };
}

/** Synchronous benchmark run used by tests and scripts. */
export function runBenchmark(
  graph: Graph,
  candidates: ReadonlyArray<StopInfo>,
  config: BenchmarkConfig,
  onProgress?: (progress: BenchmarkProgress) => void,
  onSummary?: (summary: KSummary) => void,
): BenchmarkResult {
  const overallStart = performance.now();
  const { cache, cacheMs } = buildDistanceCache(graph, candidates, onProgress);
  const summaries: KSummary[] = [];
  const totalScenarios = config.kValues.length * config.scenariosPerK;
  let done = 0;

  for (const k of config.kValues) {
    const scenarios: ScenarioResult[] = [];
    for (let index = 0; index < config.scenariosPerK; index++) {
      scenarios.push(runScenario(graph, cache, candidates, k, index, config));
      done++;
      onProgress?.({
        phase: 'scenarios',
        progress: totalScenarios === 0 ? 1 : done / totalScenarios,
        k,
        scenarioIndex: index,
        detail: `k = ${k}, scenario ${index + 1}/${config.scenariosPerK}`,
      });
    }
    const summary = summarize(k, scenarios);
    summaries.push(summary);
    onSummary?.(summary);
  }

  return {
    config,
    summaries,
    cacheMs,
    totalMs: Math.max(0, performance.now() - overallStart),
    skipped: summaries.reduce((sum, summary) => sum + summary.skipped, 0),
    violations: summaries.reduce((sum, summary) => sum + summary.violations, 0),
  };
}

export function benchmarkToCsv(result: BenchmarkResult): string {
  const header = [
    'k',
    'index',
    'base_seed',
    'scenario_seed',
    'stop_ids',
    'greedy_order',
    'optimal_order',
    'greedy_distance_m',
    'optimal_distance_m',
    'gap_m',
    'gap_pct',
    'greedy_ms',
    'optimal_ms',
    'algorithm',
    'skipped',
    'bug',
  ];
  const rows = result.summaries.flatMap((summary) =>
    summary.scenarios.map((scenario) =>
      [
        scenario.k,
        scenario.index,
        scenario.baseSeed,
        scenario.seed,
        scenario.stopIds.join('|'),
        scenario.greedyOrder.join('>'),
        scenario.optimalOrder.join('>'),
        finite(scenario.greedyDistance),
        finite(scenario.optimalDistance),
        finite(scenario.gapMeters),
        scenario.gapPct.toFixed(4),
        scenario.greedyMs.toFixed(3),
        scenario.optimalMs.toFixed(3),
        scenario.algorithm,
        scenario.skipped ? 1 : 0,
        scenario.bug ? 1 : 0,
      ].join(','),
    ),
  );
  return [header.join(','), ...rows].join('\n');
}

function finite(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '';
}
