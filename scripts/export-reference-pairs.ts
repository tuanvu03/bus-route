/**
 * Export 20 random directed vertex pairs with distances computed by the app's
 * Dijkstra. Pair with scripts/verify-networkx.py for an external reference
 * check against networkx.
 *
 *   npx tsx scripts/export-reference-pairs.ts [out.json]
 *   python3 scripts/verify-networkx.py [out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { dijkstra, reconstructPath } from '../src/lib/dijkstra';
import type { Graph, SerializedGraph } from '../src/lib/types';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const root = process.cwd();
const raw = JSON.parse(
  fs.readFileSync(path.resolve(root, 'public/graph.json'), 'utf8'),
) as SerializedGraph;
const graph: Graph = {
  meta: raw.meta,
  coords: new Float64Array(raw.vertices),
  adj: raw.adj.map((list) => list.map(([to, weight]) => [to, weight] as const)),
  stops: raw.stops,
  start: raw.start,
  destination: raw.destination,
  roads: raw.roads,
};

const n = graph.coords.length / 2;
const random = rng(20261120);
const pairs: { source: number; target: number }[] = [];
for (let i = 0; i < 20; i++) {
  pairs.push({
    source: Math.floor(random() * n),
    target: Math.floor(random() * n),
  });
}
// Include the trip's fixed endpoints in both directions.
pairs.push({ source: graph.start.vertex, target: graph.destination.vertex });
pairs.push({ source: graph.destination.vertex, target: graph.start.vertex });

const cache = new Map<number, ReturnType<typeof dijkstra>>();
const results = pairs.map(({ source, target }) => {
  let run = cache.get(source);
  if (!run) {
    run = dijkstra(graph.adj, n, source);
    cache.set(source, run);
  }
  const path = reconstructPath(run, target);
  let pathDistance = 0;
  if (path) {
    for (let i = 0; i + 1 < path.length; i++) {
      const edge = graph.adj[path[i]].find(([to]) => to === path[i + 1]);
      if (edge) pathDistance += edge[1];
    }
  }
  return {
    source,
    target,
    distance: run.dist[target],
    pathDistance,
    pathLength: path?.length ?? 0,
  };
});

const outPath = path.resolve(process.argv[2] ?? '/tmp/busway-reference-pairs.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      graph: 'public/graph.json',
      vertexCount: n,
      generatedBy: 'src/lib/dijkstra.ts',
      pairs: results,
    },
    null,
    2,
  ),
);

const reachable = results.filter((r) => Number.isFinite(r.distance)).length;
console.log(`Wrote ${results.length} pairs to ${outPath} (${reachable} reachable).`);
for (const r of results.slice(0, 5)) {
  console.log(
    `  v${r.source} → v${r.target}: ${
      Number.isFinite(r.distance) ? `${r.distance.toFixed(2)} m / ${r.pathLength} vertices` : 'unreachable'
    }`,
  );
}
