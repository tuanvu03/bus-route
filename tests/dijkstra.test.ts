import { describe, expect, it } from 'vitest';
import { dijkstra, frontierAtStep, reconstructPath } from '../src/lib/dijkstra';
import type { Edge } from '../src/lib/types';
import { loadGraphFromDisk, referenceShortestPaths, rng } from './helpers';

function buildAdj(n: number, edges: [number, number, number][]): Edge[][] {
  const adj: Edge[][] = Array.from({ length: n }, () => []);
  for (const [a, b, w] of edges) adj[a].push([b, w]);
  return adj;
}

describe('Dijkstra on directed graphs', () => {
  it('respects one-way streets (reverse direction is longer)', () => {
    // 0 -> 1 is a 10 m one-way shortcut. Returning 1 -> 0 needs the 40 m loop.
    const adj = buildAdj(4, [
      [0, 1, 10],
      [1, 2, 20],
      [2, 0, 20],
      [0, 3, 6],
      [3, 1, 6],
      [1, 0, 40],
    ]);
    const from0 = dijkstra(adj, 4, 0);
    const from1 = dijkstra(adj, 4, 1);
    expect(from0.dist[1]).toBe(10);
    expect(from1.dist[0]).toBe(40);
    expect(reconstructPath(from0, 1)).toEqual([0, 1]);
    expect(reconstructPath(from1, 0)).toEqual([1, 0]);
  });

  it('does not invent reversed edges for a pure one-way graph', () => {
    const adj = buildAdj(3, [
      [0, 1, 1],
      [1, 2, 1],
    ]);
    const result = dijkstra(adj, 3, 2);
    expect(result.dist[0]).toBe(Infinity);
    expect(reconstructPath(result, 0)).toBeNull();
    expect(result.steps).toHaveLength(1);
  });

  it('finds the same distances as the SPFA reference on random graphs', () => {
    const random = rng(123456);
    for (let trial = 0; trial < 60; trial++) {
      const n = 6 + Math.floor(random() * 10);
      const edges: [number, number, number][] = [];
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          if (a !== b && random() < 0.22) {
            edges.push([a, b, 1 + random() * 50]);
          }
        }
      }
      const adj = buildAdj(n, edges);
      for (let source = 0; source < n; source++) {
        const mine = dijkstra(adj, n, source);
        const reference = referenceShortestPaths(adj, n, source);
        for (let target = 0; target < n; target++) {
          expect(mine.dist[target]).toBeCloseTo(reference[target], 6);
        }
      }
    }
  });

  it('matches the reference on 20 random real-network pairs', () => {
    const graph = loadGraphFromDisk();
    const n = graph.coords.length / 2;
    const random = rng(20261120);
    const pairs: [number, number][] = [];
    for (let i = 0; i < 20; i++) {
      pairs.push([Math.floor(random() * n), Math.floor(random() * n)]);
    }

    const cache = new Map<number, Float64Array>();
    for (const [source, target] of pairs) {
      let reference = cache.get(source);
      if (!reference) {
        reference = referenceShortestPaths(graph.adj, n, source);
        cache.set(source, reference);
      }
      const result = dijkstra(graph.adj, n, source);
      expect(result.dist[target]).toBeCloseTo(reference[target], 5);

      const path = reconstructPath(result, target);
      if (Number.isFinite(reference[target])) {
        expect(path).not.toBeNull();
        expect(path![0]).toBe(source);
        expect(path![path!.length - 1]).toBe(target);
        // Path length must equal the shortest distance.
        let sum = 0;
        for (let i = 0; i + 1 < path!.length; i++) {
          const edge = graph.adj[path![i]].find(([to]) => to === path![i + 1]);
          expect(edge).toBeDefined();
          sum += edge![1];
        }
        expect(sum).toBeCloseTo(reference[target], 5);
      } else {
        expect(path).toBeNull();
      }
    }
    expect(cache.size).toBeGreaterThan(0);
  });

  it('produces a monotone, replayable settlement log', () => {
    const graph = loadGraphFromDisk();
    const n = graph.coords.length / 2;
    const result = dijkstra(graph.adj, n, graph.start.vertex);

    expect(result.steps).toHaveLength(result.settledCount);
    let previous = -Infinity;
    for (const step of result.steps) {
      expect(step.dist).toBeGreaterThanOrEqual(previous);
      previous = step.dist;
    }

    const initial = frontierAtStep(graph.adj, n, graph.start.vertex, result.steps, 0);
    expect(initial.entries).toEqual([{ vertex: graph.start.vertex, dist: 0 }]);

    const halfway = Math.floor(result.steps.length / 2);
    const snapshot = frontierAtStep(graph.adj, n, graph.start.vertex, result.steps, halfway);
    expect(snapshot.settledCount).toBe(halfway);
    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(snapshot.entries.every((e) => Number.isFinite(e.dist))).toBe(true);

    const end = frontierAtStep(
      graph.adj,
      n,
      graph.start.vertex,
      result.steps,
      result.steps.length,
    );
    expect(end.entries).toHaveLength(0);
  });
});
