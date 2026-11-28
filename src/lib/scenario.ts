import { dijkstraDistances, reverseAdjacency } from './dijkstra';
import type { Graph, StopInfo } from './types';
import { vertexCount } from './types';
import type { SelectedStop } from './route';
import { mulberry32, pickIndices } from './random';

export interface CandidateSet {
  /** Valid stops, deduplicated by snapped graph vertex. */
  stops: StopInfo[];
  /** Number of stop records removed because they shared another stop's vertex. */
  mergedCount: number;
  /** Stops that fail start→stop or stop→destination reachability. */
  unreachableCount: number;
  totalStops: number;
}

/**
 * A stop is a valid random-scenario candidate when:
 *  - it belongs to the main connected component (all graph.json stops do),
 *  - it is reachable from the start, and
 *  - the destination is reachable from it.
 * Stops that snap to the same graph vertex are merged into one candidate.
 */
export function computeCandidateStops(graph: Graph): CandidateSet {
  const n = vertexCount(graph);
  const targets = new Set<number>();
  for (const stop of graph.stops) targets.add(stop.vertex);

  const fromStart = dijkstraDistances(graph.adj, n, graph.start.vertex, targets);
  const reverse = reverseAdjacency(graph.adj, n);
  const toDestination = dijkstraDistances(
    reverse,
    n,
    graph.destination.vertex,
    targets,
  );

  const byVertex = new Map<number, StopInfo>();
  let mergedCount = 0;
  for (const stop of graph.stops) {
    const reachableFromStart = Number.isFinite(fromStart.dist[stop.vertex]);
    const reachesDestination = Number.isFinite(toDestination.dist[stop.vertex]);
    if (!reachableFromStart || !reachesDestination) continue;
    if (byVertex.has(stop.vertex)) {
      mergedCount++;
      continue;
    }
    byVertex.set(stop.vertex, stop);
  }

  const stops = [...byVertex.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id),
  );

  return {
    stops,
    mergedCount,
    unreachableCount: graph.stops.length - mergedCount - stops.length,
    totalStops: graph.stops.length,
  };
}

export interface RandomScenario {
  seed: number;
  k: number;
  passengersPerStop: number;
  stops: SelectedStop[];
}

/**
 * Reproduce a random scenario from a seed. The same candidate list order, k
 * and seed always yield the same stops, in the browser and in Node.
 */
export function generateScenario(
  candidates: ReadonlyArray<StopInfo>,
  k: number,
  seed: number,
  passengersPerStop = 1,
): RandomScenario {
  if (!Number.isInteger(k) || k < 0) throw new Error(`Invalid stop count ${k}`);
  if (k > candidates.length) {
    throw new Error(`Only ${candidates.length} candidate stops are available`);
  }
  const random = mulberry32(seed);
  const indices = pickIndices(candidates.length, k, random);
  const stops: SelectedStop[] = indices.map((index) => ({
    stop: candidates[index],
    passengers: Math.max(0, Math.round(passengersPerStop)),
  }));
  return { seed: seed >>> 0, k, passengersPerStop, stops };
}
