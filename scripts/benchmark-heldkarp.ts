/**
 * Measure Held-Karp time and memory on this map.
 *
 *   npm run benchmark:heldkarp
 *
 * The DP itself is pure; this script uses the same flat typed arrays as the
 * browser worker so the README numbers are representative.
 */
import { loadGraphFromDisk } from '../tests/helpers';
import { computeCandidateStops } from '../src/lib/scenario';
import { buildDistanceCache } from '../src/lib/benchmark';
import { heldKarpMemoryBytes, solveVisitOrder } from '../src/lib/heldKarp';
import type { StopInfo } from '../src/lib/types';

const graph = loadGraphFromDisk();
const candidates = computeCandidateStops(graph);
const { cache } = buildDistanceCache(graph, candidates.stops);

function matrixFor(stops: StopInfo[]): number[][] {
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

console.log('Held-Karp measurements on the SNUST map');
console.log('n\ttime_ms\theap_delta_mb\ttheoretical_dp_mb\ttotal_m');
for (const n of [10, 12, 15]) {
  const stops = candidates.stops.slice(0, n);
  const matrix = matrixFor(stops);
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const solution = solveVisitOrder(matrix);
  const elapsed = performance.now() - started;
  const after = process.memoryUsage().heapUsed;
  console.log(
    [
      n,
      elapsed.toFixed(2),
      ((after - before) / 1024 / 1024).toFixed(2),
      (heldKarpMemoryBytes(n) / 1024 / 1024).toFixed(2),
      solution ? solution.cost.toFixed(1) : 'unreachable',
    ].join('\t'),
  );
}
