/**
 * Find reproducible preset scenarios on the real map.
 *
 *   npm run find-presets
 *
 * The script does not hand-pick stops. It evaluates seeded random scenarios,
 * ranks them by the greedy-vs-Held-Karp gap and geometric category, and writes
 * presets.json (stop ids + seed + measured gap). Run it again to reproduce the
 * same file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadGraphFromDisk } from '../tests/helpers';
import { computeCandidateStops } from '../src/lib/scenario';
import { buildDistanceCache } from '../src/lib/benchmark';
import { greedyVisitOrder, solveVisitOrder } from '../src/lib/heldKarp';
import { deriveScenarioSeed, mulberry32, pickIndices } from '../src/lib/random';
import type { Graph, StopInfo } from '../src/lib/types';

const BASE_SEED = 20261127;
const K_VALUES = [6, 8, 10, 12];
const TRIALS_PER_K = 320;
const PASSENGERS = 1;
const HK_LIMIT = 15;

interface Evaluated {
  k: number;
  index: number;
  seed: number;
  stops: StopInfo[];
  greedyDistance: number;
  optimalDistance: number;
  gapMeters: number;
  gapPct: number;
  lateralSpread: number;
  bothSides: boolean;
  minT: number;
  maxT: number;
  meanAsymmetry: number;
  firstDetourRatio: number;
  lastStopToDestination: number;
  firstStopFromStart: number;
  greedyOrder: number[];
  optimalOrder: number[];
}

const root = process.cwd();
const graph = loadGraphFromDisk();
const candidates = computeCandidateStops(graph);
console.log(
  `Candidates: ${candidates.stops.length} stops (${candidates.mergedCount} merged by vertex, ${candidates.unreachableCount} unreachable excluded)`,
);

const { cache } = buildDistanceCache(graph, candidates.stops);
console.log(`Dijkstra cache ready for ${cache.size} source vertices.`);

function scenarioMatrix(stops: StopInfo[]): number[][] {
  const points = [graph.start, ...stops, graph.destination];
  const size = points.length;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(NaN));
  for (let i = 0; i < size - 1; i++) {
    const entry = cache.get(points[i].vertex);
    if (!entry) continue;
    for (let j = 0; j < size; j++) matrix[i][j] = entry.dist[points[j].vertex];
  }
  return matrix;
}

function metrics(
  k: number,
  index: number,
  seed: number,
  stops: StopInfo[],
  matrix: number[][],
): Evaluated | null {
  const greedy = greedyVisitOrder(matrix, stops.map((stop) => ({ vertex: stop.vertex })));
  const optimal = solveVisitOrder(matrix);
  if (!greedy || !optimal) return null;

  const start = graph.start;
  const dest = graph.destination;
  const toRad = Math.PI / 180;
  const metersPerDegree = 111_320;
  const cosLat = Math.cos(((start.lat + dest.lat) / 2) * toRad);
  const axisX = (dest.lon - start.lon) * cosLat * metersPerDegree;
  const axisY = (dest.lat - start.lat) * metersPerDegree;
  const axisLen2 = axisX * axisX + axisY * axisY;
  const axisLen = Math.sqrt(axisLen2);

  const projections = stops.map((stop) => {
    const relX = (stop.lon - start.lon) * cosLat * metersPerDegree;
    const relY = (stop.lat - start.lat) * metersPerDegree;
    const t = (relX * axisX + relY * axisY) / axisLen2;
    const perp = (relX * axisY - relY * axisX) / axisLen;
    return { t, perp };
  });
  const perps = projections.map((p) => p.perp);
  const ts = projections.map((p) => p.t);

  let asymmetrySum = 0;
  let asymmetryCount = 0;
  for (let i = 1; i < matrix.length - 1; i++) {
    for (let j = 1; j < matrix.length - 1; j++) {
      if (i === j) continue;
      const a = matrix[i][j];
      const b = matrix[j][i];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        asymmetrySum += Math.abs(a - b);
        asymmetryCount++;
      }
    }
  }
  const meanAsymmetry =
    asymmetryCount > 0 ? asymmetrySum / asymmetryCount : 0;

  const n = stops.length;
  const firstStop = stops[greedy.order[1] - 1];
  const lastStop = stops[greedy.order[n] - 1];
  const haversineMeters = (a: StopInfo | typeof start, b: StopInfo | typeof dest) => {
    const lat1 = a.lat * toRad;
    const lat2 = b.lat * toRad;
    const dLat = lat2 - lat1;
    const dLon = (b.lon - a.lon) * toRad;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const firstEuclid = haversineMeters(start, firstStop);

  const gapMeters = greedy.cost - optimal.cost;
  return {
    k,
    index,
    seed,
    stops,
    greedyDistance: greedy.cost,
    optimalDistance: optimal.cost,
    gapMeters,
    gapPct: optimal.cost > 0 ? (gapMeters / optimal.cost) * 100 : 0,
    lateralSpread: Math.max(...perps) - Math.min(...perps),
    bothSides: Math.min(...perps) < -100 && Math.max(...perps) > 100,
    minT: Math.min(...ts),
    maxT: Math.max(...ts),
    meanAsymmetry,
    firstDetourRatio: firstEuclid > 0 ? matrix[0][greedy.order[1]] / firstEuclid : 1,
    lastStopToDestination: matrix[greedy.order[n]][n + 1],
    firstStopFromStart: matrix[0][greedy.order[1]],
    greedyOrder: greedy.order,
    optimalOrder: optimal.order,
  };
}

const all: Evaluated[] = [];
for (const k of K_VALUES) {
  for (let index = 0; index < TRIALS_PER_K; index++) {
    const seed = deriveScenarioSeed(BASE_SEED, k, index);
    const random = mulberry32(seed);
    const chosen = pickIndices(candidates.stops.length, k, random).map(
      (i) => candidates.stops[i],
    );
    const matrix = scenarioMatrix(chosen);
    let reachable = true;
    for (let i = 0; i < matrix.length - 1; i++) {
      for (let j = 0; j < matrix.length; j++) {
        if (i !== j && !Number.isFinite(matrix[i][j])) reachable = false;
      }
    }
    if (!reachable) continue;
    const evaluated = metrics(k, index, seed, chosen, matrix);
    if (evaluated) all.push(evaluated);
  }
  console.log(`Evaluated k=${k}: ${all.filter((s) => s.k === k).length} feasible scenarios`);
}

const best = (score: (s: Evaluated) => number, filter: (s: Evaluated) => boolean = () => true) => {
  const pool = all.filter(filter);
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (score(b) > score(a) ? b : a));
};

// Easy: no meaningful gap, stops close to the start→campus axis and between them.
const easy =
  best(
    (s) =>
      -s.gapMeters * 4 -
      s.lateralSpread * 0.6 -
      Math.max(0, s.minT) * 1000 -
      Math.max(0, 1 - s.maxT) * 1000,
    (s) =>
      s.gapMeters <= 0.5 &&
      s.minT >= -0.05 &&
      s.maxT <= 1.05 &&
      s.lateralSpread < 1500,
  ) ??
  best((s) => -s.gapMeters * 4 - s.lateralSpread * 0.6);

// Opposite sides: stops on both sides of the axis, wide lateral spread.
const opposite =
  best(
    (s) => s.lateralSpread + Math.min(Math.abs(s.minT), Math.abs(s.maxT)) * 10,
    (s) => s.bothSides,
  ) ??
  best((s) => s.lateralSpread);

// One-way trap: positive gap with a long road detour to the first greedy stop.
const oneWay =
  best(
    (s) => s.gapMeters * (1 + s.firstDetourRatio) * (1 + s.meanAsymmetry / 500),
    (s) => s.gapMeters > 1 && s.firstDetourRatio > 1.05,
  ) ??
  best((s) => s.gapMeters * (1 + s.firstDetourRatio), (s) => s.gapMeters > 1);

// Far from campus first: greedy starts cheaply and leaves a far stop that
// forces a long final leg.
const far =
  best(
    (s) =>
      s.gapMeters * 2 +
      s.lastStopToDestination * 0.5 -
      s.firstStopFromStart * 0.25,
    (s) =>
      s.gapMeters > 0.5 &&
      s.lastStopToDestination > 900 &&
      s.firstStopFromStart < 1200,
  ) ??
  best(
    (s) => s.gapMeters * 2 + s.lastStopToDestination * 0.5,
    (s) => s.gapMeters > 0.5,
  );

const worst8 = best((s) => s.gapMeters, (s) => s.k === 8);
const worst12 = best((s) => s.gapMeters, (s) => s.k === 12);

function toPreset(
  id: string,
  name: string,
  description: string,
  scenario: Evaluated | null,
): Record<string, unknown> | null {
  if (!scenario) return null;
  return {
    id,
    name,
    description,
    seed: scenario.seed,
    k: scenario.k,
    index: scenario.index,
    stopIds: scenario.stops.map((stop) => stop.id),
    passengers: PASSENGERS,
    greedyDistance: round(scenario.greedyDistance),
    optimalDistance: round(scenario.optimalDistance),
    gapMeters: round(scenario.gapMeters),
    gapPct: round(scenario.gapPct),
    algorithm: 'exact',
    metrics: {
      lateralSpread: round(scenario.lateralSpread),
      bothSides: scenario.bothSides,
      firstDetourRatio: round(scenario.firstDetourRatio),
      lastStopToDestination: round(scenario.lastStopToDestination),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const presets = [
  toPreset(
    'easy',
    'Easy',
    'Stops lined up close to the start→campus axis; greedy already finds the optimal order.',
    easy,
  ),
  toPreset(
    'opposite-sides',
    'Opposite sides',
    'Stops spread on both sides of the start→campus axis, so the best order is less obvious.',
    opposite,
  ),
  toPreset(
    'one-way-trap',
    'One-way trap',
    'The nearest stop by road still creates a costly detour because of one-way streets.',
    oneWay,
  ),
  toPreset(
    'far-from-campus-first',
    'Far from campus first',
    'Greedy picks nearby stops first and leaves a far stop that forces a long final backtrack.',
    far,
  ),
  toPreset(
    'worst-k8',
    'Worst found (k=8)',
    'Largest greedy gap found by the seeded k=8 search.',
    worst8,
  ),
  toPreset(
    'worst-k12',
    'Worst found (k=12)',
    'Largest greedy gap found by the seeded k=12 search.',
    worst12,
  ),
].filter(Boolean);

const out = {
  generatedBy: 'scripts/find-presets.ts',
  generatedAt: new Date().toISOString(),
  baseSeed: BASE_SEED,
  search: {
    kValues: K_VALUES,
    trialsPerK: TRIALS_PER_K,
    candidates: candidates.stops.length,
    mergedByVertex: candidates.mergedCount,
  },
  presets,
  notes: [
    'All presets were found by seeded search over the candidate stops; none were hand-picked.',
    'measured gaps come from the same greedy and Held-Karp implementations used by the app.',
  ],
};

const outPath = path.resolve(root, 'presets.json');
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nWrote ${presets.length} presets to ${path.relative(root, outPath)}`);
for (const preset of presets as Record<string, unknown>[]) {
  const gap = Number(preset.gapMeters).toFixed(1);
  console.log(
    `  ${String(preset.name).padEnd(24)} k=${preset.k} gap=${gap} m (${Number(
      preset.gapPct,
    ).toFixed(2)}%) seed=${preset.seed}`,
  );
}
