import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  keyPoints,
  optimizeRoute,
  pointAtDistance,
  totalPassengers,
  type SelectedStop,
} from '../src/lib/route';
import { bruteForceOrders, solveVisitOrder } from '../src/lib/heldKarp';
import { loadGraphFromDisk, rng } from './helpers';

const DEMO_IDS = [
  'node/357826339', // 공릉역1번출구
  'node/357826470', // 묵동삼거리.먹골역
  'node/357821942', // 서울과학기술대입구교차로
  'node/357826337', // 공릉시장
  'node/357821806', // 태릉입구역3번출구
  'node/357829497', // 하계역3번출구.을지병원
  'node/357826081', // 장위사거리
  'node/357825878', // 장위자이레디언트아파트
  'node/357826299', // 하계미성아파트
];

describe('route optimisation over the real network', () => {
  const graph = loadGraphFromDisk();
  const stops = DEMO_IDS.map((id) => {
    const stop = graph.stops.find((s) => s.id === id);
    if (!stop) throw new Error(`Missing demo stop ${id}`);
    return stop;
  });
  const selected: SelectedStop[] = stops.map((stop, i) => ({ stop, passengers: i + 1 }));

  it('routes 9 stops in under two seconds', () => {
    const started = performance.now();
    const { plan, unreachable } = optimizeRoute(graph, selected);
    const elapsed = performance.now() - started;
    expect(unreachable).toBeNull();
    expect(plan).not.toBeNull();
    expect(elapsed).toBeLessThan(2000);
    expect(plan!.legs).toHaveLength(10);
    expect(plan!.order[0]).toBe(0);
    expect(plan!.order[plan!.order.length - 1]).toBe(10);
    expect(plan!.totalDistance).toBeGreaterThan(0);
  });

  it('stitches a geometry with ten stops including the destination', () => {
    const { plan } = optimizeRoute(graph, selected);
    expect(plan).not.toBeNull();
    const geometry = plan!.geometry;
    expect(geometry.stopEvents).toHaveLength(10);
    expect(geometry.stopEvents[9].isDestination).toBe(true);
    expect(geometry.stopEvents[9].name).toBe(graph.destination.name);
    expect(geometry.totalDistance).toBeCloseTo(plan!.totalDistance, 0);
    expect(geometry.coords.length).toBeGreaterThan(10);

    const middle = pointAtDistance(geometry, geometry.totalDistance / 2);
    expect(Number.isFinite(middle.coord[0])).toBe(true);
    const end = pointAtDistance(geometry, geometry.totalDistance);
    expect(end.coord[0]).toBeCloseTo(graph.destination.lon, 1);
    expect(end.coord[1]).toBeCloseTo(graph.destination.lat, 1);

    // Pickup events must carry the right passengers for the optimised order.
    const stopByMatrixIndex = new Map(
      plan!.points.map((p, i) => [i, p.stop?.id ?? null]),
    );
    plan!.legs.forEach((leg, i) => {
      if (i === plan!.legs.length - 1) return;
      expect(geometry.stopEvents[i].stopId).toBe(stopByMatrixIndex.get(leg.to));
    });
  });

  it('has an asymmetric matrix because of one-way streets', () => {
    const { plan } = optimizeRoute(graph, selected.slice(0, 4));
    let asymmetric = 0;
    for (let i = 0; i < plan!.matrix.length; i++) {
      for (let j = 0; j < plan!.matrix.length; j++) {
        const a = plan!.matrix[i][j];
        const b = plan!.matrix[j][i];
        if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1) asymmetric++;
      }
    }
    expect(asymmetric).toBeGreaterThan(0);
  });

  it('matches brute force on random real-graph subsets of 4–7 stops', () => {
    const random = rng(424242);
    for (let trial = 0; trial < 6; trial++) {
      const count = 4 + Math.floor(random() * 4); // 4..7
      const chosen: SelectedStop[] = [];
      const used = new Set<number>();
      while (chosen.length < count) {
        const index = Math.floor(random() * graph.stops.length);
        if (used.has(index)) continue;
        used.add(index);
        chosen.push({ stop: graph.stops[index], passengers: 1 });
      }
      const { matrix } = buildMatrix(graph, keyPoints(graph, chosen));
      const heldKarp = solveVisitOrder(matrix);
      const brute = bruteForceOrders(matrix, 1)[0];
      if (!brute) {
        expect(heldKarp).toBeNull();
      } else {
        expect(heldKarp).not.toBeNull();
        expect(heldKarp!.cost).toBeCloseTo(brute.cost, 6);
      }
    }
  });

  it('sums passengers', () => {
    expect(totalPassengers(selected)).toBe(45);
  });

  it('reports unreachable pairs instead of throwing', () => {
    const fromStop = graph.stops.find((s) => s.name === '서울시립북미술관');
    // That stop is one of the two outside the main strong component; allow
    // either a valid route or a clean unreachable report.
    if (fromStop) {
      const result = optimizeRoute(graph, [{ stop: fromStop, passengers: 1 }]);
      expect(result.plan !== null || result.unreachable !== null).toBe(true);
    }
  });
});
