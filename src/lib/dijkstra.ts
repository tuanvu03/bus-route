import { MinHeap } from './heap';
import type { Edge, VertexId } from './types';

export interface Relaxation {
  to: VertexId;
  weight: number;
  /** d(u) + w, the candidate distance written to d(v) when `updated`. */
  candidate: number;
  updated: boolean;
}

export interface DijkstraStep {
  /** 1-based settlement index. */
  step: number;
  vertex: VertexId;
  /** d(u) at the moment u was settled. */
  dist: number;
  /** Outgoing edges to unsettled vertices, in adjacency order. */
  relaxed: Relaxation[];
}

export interface DijkstraResult {
  source: VertexId;
  dist: Float64Array;
  prev: Int32Array;
  steps: DijkstraStep[];
  settledCount: number;
  relaxationCount: number;
  updateCount: number;
}

/**
 * Dijkstra with a hand-written binary min-heap and lazy deletion.
 * Records every settlement and relaxation so the run can be replayed in the UI.
 */
export function dijkstra(
  adj: ReadonlyArray<ReadonlyArray<Edge>>,
  vertexCount: number,
  source: VertexId,
): DijkstraResult {
  const dist = new Float64Array(vertexCount).fill(Infinity);
  const prev = new Int32Array(vertexCount).fill(-1);
  const settled = new Uint8Array(vertexCount);
  const steps: DijkstraStep[] = [];
  const heap = new MinHeap();

  dist[source] = 0;
  heap.push(0, source);

  let relaxationCount = 0;
  let updateCount = 0;

  while (!heap.isEmpty()) {
    const top = heap.pop()!;
    const u = top.value;
    if (settled[u] || top.priority !== dist[u]) continue;
    settled[u] = 1;

    const relaxed: Relaxation[] = [];
    for (const [v, weight] of adj[u]) {
      if (settled[v]) continue;
      const candidate = top.priority + weight;
      const updated = candidate < dist[v];
      if (updated) {
        dist[v] = candidate;
        prev[v] = u;
        heap.push(candidate, v);
        updateCount++;
      }
      relaxed.push({ to: v, weight, candidate, updated });
      relaxationCount++;
    }

    steps.push({
      step: steps.length + 1,
      vertex: u,
      dist: top.priority,
      relaxed,
    });
  }

  return {
    source,
    dist,
    prev,
    steps,
    settledCount: steps.length,
    relaxationCount,
    updateCount,
  };
}

export interface DistanceResult {
  source: VertexId;
  dist: Float64Array;
  prev: Int32Array;
  settledCount: number;
  relaxationCount: number;
  updateCount: number;
  /** True when every requested target was settled before the queue emptied. */
  allTargetsSettled: boolean;
}

/**
 * Distance-only Dijkstra used for the large pairwise matrix and the benchmark.
 *
 * Unlike `dijkstra`, this does not allocate a settlement log. When `targets`
 * is supplied the search stops as soon as every target has been settled, which
 * is the important saving when n stops only need n+1 source searches.
 */
export function dijkstraDistances(
  adj: ReadonlyArray<ReadonlyArray<Edge>>,
  vertexCount: number,
  source: VertexId,
  targets?: Iterable<VertexId>,
): DistanceResult {
  const dist = new Float64Array(vertexCount).fill(Infinity);
  const prev = new Int32Array(vertexCount).fill(-1);
  const settled = new Uint8Array(vertexCount);
  const heap = new MinHeap();
  const remaining = new Set<VertexId>();
  const hasTargets = targets !== undefined;
  if (hasTargets) {
    for (const target of targets) if (target !== source) remaining.add(target);
  }

  dist[source] = 0;
  heap.push(0, source);

  let relaxationCount = 0;
  let updateCount = 0;
  let settledCount = 0;

  while (!heap.isEmpty()) {
    if (hasTargets && remaining.size === 0) break;
    const top = heap.pop()!;
    const u = top.value;
    if (settled[u] || top.priority !== dist[u]) continue;
    settled[u] = 1;
    settledCount++;
    remaining.delete(u);

    for (const [v, weight] of adj[u]) {
      if (settled[v]) continue;
      const candidate = top.priority + weight;
      if (candidate < dist[v]) {
        dist[v] = candidate;
        prev[v] = u;
        heap.push(candidate, v);
        updateCount++;
      }
      relaxationCount++;
    }
  }

  return {
    source,
    dist,
    prev,
    settledCount,
    relaxationCount,
    updateCount,
    allTargetsSettled: remaining.size === 0,
  };
}

/** Build the reverse graph once for destination-reachability checks. */
export function reverseAdjacency(
  adj: ReadonlyArray<ReadonlyArray<Edge>>,
  vertexCount: number,
): Edge[][] {
  const reverse: Edge[][] = Array.from({ length: vertexCount }, () => []);
  for (let u = 0; u < adj.length; u++) {
    for (const [v, weight] of adj[u]) reverse[v].push([u, weight]);
  }
  return reverse;
}

/** The subset of a search result needed to reconstruct a path. */
export interface PathSource {
  source: VertexId;
  dist: Float64Array;
  prev: Int32Array;
}

/** Walk `prev` from target back to source. Returns null when unreachable. */
export function reconstructPath(result: PathSource, target: VertexId): VertexId[] | null {
  if (!Number.isFinite(result.dist[target])) return null;
  const path: VertexId[] = [];
  let v = target;
  let guard = result.dist.length + 1;
  while (v !== -1 && guard-- > 0) {
    path.push(v);
    if (v === result.source) return path.reverse();
    v = result.prev[v];
  }
  return null;
}

export interface FrontierEntry {
  vertex: VertexId;
  dist: number;
}

export interface FrontierSnapshot {
  entries: FrontierEntry[];
  settledCount: number;
  /** Heap entries that are settled or superseded by a shorter tentative distance. */
  staleCount: number;
  rawEntryCount: number;
}

/**
 * Replay the deterministic settlement log up to `stepIndex` and return the
 * priority-queue contents at that moment (deduplicated to the best entry per
 * unsettled vertex). stepIndex 0 means "before the first settlement".
 */
export function frontierAtStep(
  adj: ReadonlyArray<ReadonlyArray<Edge>>,
  vertexCount: number,
  source: VertexId,
  steps: DijkstraStep[],
  stepIndex: number,
): FrontierSnapshot {
  const target = Math.max(0, Math.min(stepIndex, steps.length));
  const dist = new Float64Array(vertexCount).fill(Infinity);
  const settled = new Uint8Array(vertexCount);
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(0, source);

  for (let i = 0; i < target; i++) {
    const step = steps[i];
    let top = heap.pop();
    while (top && (settled[top.value] || top.priority !== dist[top.value])) {
      top = heap.pop();
    }
    if (!top || top.value !== step.vertex) {
      // Defensive: a corrupted log should not freeze the UI.
      break;
    }
    settled[top.value] = 1;
    for (const rel of step.relaxed) {
      if (rel.updated) {
        dist[rel.to] = rel.candidate;
        heap.push(rel.candidate, rel.to);
      }
    }
  }

  const raw = heap.entries();
  const best = new Map<VertexId, number>();
  for (const entry of raw) {
    if (settled[entry.value]) continue;
    if (entry.priority !== dist[entry.value]) continue;
    const seen = best.get(entry.value);
    if (seen === undefined || entry.priority < seen) best.set(entry.value, entry.priority);
  }

  const entries = [...best.entries()]
    .map(([vertex, d]) => ({ vertex, dist: d }))
    .sort((a, b) => a.dist - b.dist || a.vertex - b.vertex);

  let settledCount = 0;
  for (let i = 0; i < vertexCount; i++) if (settled[i]) settledCount++;

  return {
    entries,
    settledCount,
    staleCount: raw.length - entries.length,
    rawEntryCount: raw.length,
  };
}
