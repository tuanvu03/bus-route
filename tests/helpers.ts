import fs from 'node:fs';
import path from 'node:path';
import type { Edge, Graph, SerializedGraph } from '../src/lib/types';

/** Load the preprocessed graph straight from disk for Node-based tests. */
export function loadGraphFromDisk(): Graph {
  const file = path.resolve(process.cwd(), 'public/graph.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SerializedGraph;
  return {
    meta: raw.meta,
    coords: new Float64Array(raw.vertices),
    adj: raw.adj.map((list) => list.map(([to, weight]) => [to, weight] as const)),
    stops: raw.stops,
    start: raw.start,
    destination: raw.destination,
    roads: raw.roads,
  };
}

/** Independent SPFA / label-correcting reference implementation. */
export function referenceShortestPaths(
  adj: ReadonlyArray<ReadonlyArray<Edge>>,
  n: number,
  source: number,
): Float64Array {
  const dist = new Float64Array(n).fill(Infinity);
  const inQueue = new Uint8Array(n);
  const queue: number[] = [source];
  let head = 0;
  dist[source] = 0;
  inQueue[source] = 1;
  while (head < queue.length) {
    const u = queue[head++];
    inQueue[u] = 0;
    for (const [v, w] of adj[u]) {
      const candidate = dist[u] + w;
      if (candidate < dist[v]) {
        dist[v] = candidate;
        if (!inQueue[v]) {
          inQueue[v] = 1;
          queue.push(v);
        }
      }
    }
  }
  return dist;
}

/** Seeded PRNG (mulberry32) so failures are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
