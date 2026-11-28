import { describe, expect, it } from 'vitest';
import type { Edge, Graph, GraphMeta, StopInfo } from '../src/lib/types';
import {
  buildMatrix,
  keyPoints,
  solveRoute,
  totalPassengers,
  type SelectedStop,
} from '../src/lib/route';
import {
  bruteForceOrders,
  greedyVisitOrder,
  legCost,
  solveVisitOrder,
} from '../src/lib/heldKarp';
import { computeCandidateStops, generateScenario } from '../src/lib/scenario';
import { pointLabel } from '../src/lib/labels';
import { deriveScenarioSeed } from '../src/lib/random';
import { loadGraphFromDisk } from './helpers';

function makeGraph(
  adj: Edge[][],
  vertices: [number, number][],
  stopVertices: number[],
  startVertex = 0,
  destinationVertex = vertices.length - 1,
): Graph {
  const meta: GraphMeta = {
    source: 'synthetic',
    featureCount: 0,
    drivableWayCount: 0,
    omittedWays: 0,
    vertexCount: vertices.length,
    edgeCount: adj.reduce((sum, list) => sum + list.length, 0),
    rawVertexCount: vertices.length,
    rawEdgeCount: 0,
    droppedEdgeCount: 0,
    componentSizes: [vertices.length],
    mainComponentSize: vertices.length,
    largestStrongComponentSize: vertices.length,
    droppedVertexCount: 0,
    oneWaySegmentCount: 0,
    stopCount: stopVertices.length,
    droppedFarStops: 0,
    maxStopSnapMeters: 0,
    startSnapMeters: 0,
    destinationSnapMeters: 0,
  };
  const stops: StopInfo[] = stopVertices.map((vertex, index) => ({
    id: `stop/${index}`,
    name: `Stop ${index + 1}`,
    lon: vertices[vertex][0],
    lat: vertices[vertex][1],
    vertex,
    snapDistance: 0,
  }));
  return {
    meta,
    coords: new Float64Array(vertices.flatMap(([lon, lat]) => [lon, lat])),
    adj,
    stops,
    start: {
      id: 'node/start',
      name: 'Start',
      lon: vertices[startVertex][0],
      lat: vertices[startVertex][1],
      vertex: startVertex,
      snapDistance: 0,
    },
    destination: {
      id: 'node/dest',
      name: 'Destination',
      lon: vertices[destinationVertex][0],
      lat: vertices[destinationVertex][1],
      vertex: destinationVertex,
      snapDistance: 0,
    },
    roads: [],
  };
}

const vertices: [number, number][] = [
  [0, 0],
  [0.001, 0],
  [0.002, 0],
  [0.003, 0],
];

// 0=start, 1=stop A, 2=stop B, 3=destination.
// A is nearest from the start, but A→B is the expensive one-way direction.
const suboptimalAdj: Edge[][] = [
  [[1, 1], [2, 10]],
  [[2, 500], [3, 10]],
  [[1, 1], [3, 1000]],
  [],
];

describe('algorithm modes', () => {
  it('Mode A returns the expected greedy order on a one-way graph', () => {
    const graph = makeGraph(suboptimalAdj, vertices, [1, 2]);
    const selected: SelectedStop[] = [
      { stop: graph.stops[0], passengers: 1 },
      { stop: graph.stops[1], passengers: 1 },
    ];
    const result = solveRoute(graph, selected, { mode: 'greedy', hkLimit: 15 });
    expect(result.plan).not.toBeNull();
    expect(result.plan!.order).toEqual([0, 1, 2, 3]);
    // B→destination is 1000 directly, but B→A→destination is 1 + 10 = 11.
    expect(result.plan!.totalDistance).toBeCloseTo(1 + 500 + 11, 6);

    const matrix = buildMatrix(graph, keyPoints(graph, selected)).matrix;
    expect(matrix[1][2]).toBe(500);
    expect(matrix[2][1]).toBe(1);
  });

  it('Mode C exposes the greedy gap on a provably suboptimal graph', () => {
    const graph = makeGraph(suboptimalAdj, vertices, [1, 2]);
    const selected: SelectedStop[] = [
      { stop: graph.stops[0], passengers: 1 },
      { stop: graph.stops[1], passengers: 1 },
    ];
    const result = solveRoute(graph, selected, { mode: 'compare', hkLimit: 15 });
    expect(result.comparison).not.toBeNull();
    const comparison = result.comparison!;
    expect(comparison.greedy.order).toEqual([0, 1, 2, 3]);
    expect(comparison.optimal.order).toEqual([0, 2, 1, 3]);
    expect(comparison.greedy.totalDistance).toBeCloseTo(512, 6);
    expect(comparison.optimal.totalDistance).toBeCloseTo(21, 6);
    expect(comparison.gap).toBeCloseTo(491, 6);
    expect(comparison.gap).toBeCloseTo(
      comparison.greedy.totalDistance - comparison.optimal.totalDistance,
      6,
    );
    expect(comparison.divergence?.legIndex).toBe(0);
  });

  it('breaks greedy ties by the smaller graph vertex id', () => {
    const matrix = [
      [0, 10, 10, 0],
      [0, 0, 5, 5],
      [0, 5, 0, 5],
      [0, 0, 0, 0],
    ];
    const points = [
      { vertex: 0 },
      { vertex: 42 }, // larger vertex id
      { vertex: 7 }, // smaller vertex id
      { vertex: 99 },
    ];
    const solution = greedyVisitOrder(matrix, points);
    expect(solution!.order).toEqual([0, 2, 1, 3]);
    expect(solution!.cost).toBe(legCost(matrix, [0, 2, 1, 3]));
  });

  it('Mode B is never worse than Mode A for random real-map subsets up to 8 stops', () => {
    const graph = loadGraphFromDisk();
    const candidates = computeCandidateStops(graph);
    for (let k = 4; k <= 8; k++) {
      for (let index = 0; index < 2; index++) {
        const seed = deriveScenarioSeed(9001, k, index);
        const scenario = generateScenario(candidates.stops, k, seed, 1);
        const result = solveRoute(graph, scenario.stops, { mode: 'compare', hkLimit: 15 });
        expect(result.unreachable).toBeNull();
        expect(result.comparison).not.toBeNull();
        expect(result.comparison!.optimal.totalDistance).toBeLessThanOrEqual(
          result.comparison!.greedy.totalDistance + 1e-6,
        );
        expect(result.comparison!.optimal.algorithm).toBe('exact');

        if (k === 8) {
          const matrix = buildMatrix(graph, keyPoints(graph, scenario.stops)).matrix;
          const brute = bruteForceOrders(matrix, 1)[0];
          expect(brute).toBeDefined();
          expect(result.comparison!.optimal.totalDistance).toBeCloseTo(brute.cost, 6);
        }
      }
    }
  });

  it('uses the heuristic with the required warning above HELD_KARP_MAX_STOPS', () => {
    const graph = loadGraphFromDisk();
    const candidates = computeCandidateStops(graph);
    const selected = candidates.stops.slice(0, 18).map((stop) => ({ stop, passengers: 1 }));
    const result = solveRoute(graph, selected, { mode: 'compare', hkLimit: 15 });
    expect(result.plan).not.toBeNull();
    expect(result.optimal?.algorithm).toBe('heuristic');
    expect(result.optimal?.algorithmLabel).toBe('Heuristic (not proven optimal)');
    expect(result.warnings.join(' ')).toContain(
      'Exact optimization (Held-Karp) is not available for n > 15 stops',
    );
  });

  it('handles 12, 15, 25 and 40 selected stops without a stop-count cap', () => {
    const graph = loadGraphFromDisk();
    const candidates = computeCandidateStops(graph);
    for (const count of [12, 15, 25, 40]) {
      const selected = candidates.stops.slice(0, count).map((stop) => ({
        stop,
        passengers: 1,
      }));
      const result = solveRoute(graph, selected, { mode: 'compare', hkLimit: 15 });
      expect(result.plan).not.toBeNull();
      expect(result.plan!.order.length).toBe(count + 2);
      expect(totalPassengers(selected)).toBe(count);
      expect(result.optimal?.algorithm).toBe(count <= 15 ? 'exact' : 'heuristic');
      expect(result.comparison).not.toBeNull();
    }
  });

  it('keeps comparison totals equal to the drawn route geometry', () => {
    const graph = loadGraphFromDisk();
    const candidates = computeCandidateStops(graph);
    const selected = candidates.stops.slice(0, 5).map((stop) => ({
      stop,
      passengers: 1,
    }));
    const result = solveRoute(graph, selected, { mode: 'compare', hkLimit: 15 });
    const comparison = result.comparison!;
    for (const plan of [comparison.greedy, comparison.optimal]) {
      expect(plan.geometry.totalDistance).toBeCloseTo(plan.totalDistance, 5);
      expect(plan.legs.reduce((sum, leg) => sum + leg.distance, 0)).toBeCloseTo(
        plan.totalDistance,
        5,
      );
      expect(legCost(plan.matrix, plan.order)).toBeCloseTo(plan.totalDistance, 5);
    }
  });

  it('keeps point labels readable beyond 26 stops', () => {
    expect(pointLabel(0, 30)).toBe('S');
    expect(pointLabel(1, 30)).toBe('A');
    expect(pointLabel(26, 30)).toBe('Z');
    expect(pointLabel(27, 30)).toBe('AA');
    expect(pointLabel(29, 30)).toBe('T');
  });

  it('matches brute force for small exact solves', () => {
    const matrix = [
      [0, 7, 4, 0],
      [0, 0, 3, 9],
      [0, 5, 0, 2],
      [0, 0, 0, 0],
    ];
    const solution = solveVisitOrder(matrix);
    expect(solution).not.toBeNull();
    expect(solution!.order).toEqual([0, 1, 2, 3]);
    expect(solution!.cost).toBeCloseTo(12, 6);
    expect(solution!.cost).toBeLessThanOrEqual(legCost(matrix, [0, 2, 1, 3]));
  });
});
