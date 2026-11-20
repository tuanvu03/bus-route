import { dijkstra, reconstructPath, type DijkstraResult } from './dijkstra';
import { bruteForceOrders, solveVisitOrder, type ScoredOrder } from './heldKarp';
import type { Coord, Graph, StopInfo, VertexId } from './types';
import { vertexCoord, vertexCount } from './types';

export const LEG_COLORS = [
  '#2563eb',
  '#e07a1f',
  '#0f9d78',
  '#d6336c',
  '#7c4dff',
  '#0891b2',
  '#b7791f',
  '#c53030',
  '#5b6472',
] as const;

export type KeyKind = 'start' | 'stop' | 'destination';

export interface KeyPoint {
  kind: KeyKind;
  name: string;
  vertex: VertexId;
  stop?: StopInfo;
  /** Original OSM coordinate (may differ from the snapped vertex). */
  coord: Coord;
}

export interface RouteLeg {
  from: number;
  to: number;
  path: VertexId[];
  distance: number;
  color: string;
}

export interface AlternativeOrder {
  order: number[];
  cost: number;
  delta: number;
}

export interface RoutePlan {
  points: KeyPoint[];
  matrix: number[][];
  runs: DijkstraResult[];
  /** Matrix indices: start, stops..., destination. */
  order: number[];
  legs: RouteLeg[];
  totalDistance: number;
  alternatives: AlternativeOrder[];
  geometry: RouteGeometry;
}

export interface SelectedStop {
  stop: StopInfo;
  passengers: number;
}

export interface UnreachableInfo {
  pairs: { from: number; to: number; fromName: string; toName: string }[];
  message: string;
}

export interface OptimizeResult {
  plan: RoutePlan | null;
  unreachable: UnreachableInfo | null;
}

export function keyPoints(graph: Graph, selected: SelectedStop[]): KeyPoint[] {
  const points: KeyPoint[] = [
    {
      kind: 'start',
      name: graph.start.name,
      vertex: graph.start.vertex,
      coord: [graph.start.lon, graph.start.lat],
    },
    ...selected.map((s) => ({
      kind: 'stop' as const,
      name: s.stop.name,
      vertex: s.stop.vertex,
      stop: s.stop,
      coord: [s.stop.lon, s.stop.lat] as Coord,
    })),
    {
      kind: 'destination',
      name: graph.destination.name,
      vertex: graph.destination.vertex,
      coord: [graph.destination.lon, graph.destination.lat],
    },
  ];
  return points;
}

/** Run Dijkstra from every key point and materialise the directed matrix. */
export function buildMatrix(graph: Graph, points: KeyPoint[]): {
  matrix: number[][];
  runs: DijkstraResult[];
} {
  const n = vertexCount(graph);
  const runs = points.map((p) => dijkstra(graph.adj, n, p.vertex));
  const matrix = points.map((_, i) =>
    points.map((target) => runs[i].dist[target.vertex]),
  );
  return { matrix, runs };
}

export function findAllUnreachable(matrix: number[][]): UnreachableInfo['pairs'] {
  const pairs: UnreachableInfo['pairs'] = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix.length; j++) {
      if (i !== j && !Number.isFinite(matrix[i][j])) {
        pairs.push({ from: i, to: j, fromName: '', toName: '' });
      }
    }
  }
  return pairs;
}

export function optimizeRoute(graph: Graph, selected: SelectedStop[]): OptimizeResult {
  const points = keyPoints(graph, selected);
  const { matrix, runs } = buildMatrix(graph, points);
  const solution = solveVisitOrder(matrix);

  if (!solution) {
    const rawPairs = findAllUnreachable(matrix);
    const nameOf = (i: number) => points[i]?.name ?? `#${i}`;
    const pairs = rawPairs.slice(0, 6).map((p) => ({
      ...p,
      fromName: nameOf(p.from),
      toName: nameOf(p.to),
    }));
    return {
      plan: null,
      unreachable: {
        pairs,
        message:
          rawPairs.length > 0
            ? `No visiting order is possible: ${rawPairs.length} directed pair${rawPairs.length === 1 ? ' is' : 's are'} unreachable. One-way streets can make a stop impossible to reach from a particular direction.`
            : 'No complete visiting order exists for the selected stops.',
      },
    };
  }

  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < solution.order.length; i++) {
    const from = solution.order[i];
    const to = solution.order[i + 1];
    const path = reconstructPath(runs[from], points[to].vertex);
    if (!path) {
      return {
        plan: null,
        unreachable: {
          pairs: [
            {
              from,
              to,
              fromName: points[from].name,
              toName: points[to].name,
            },
          ],
          message: `The selected order needs an unreachable leg: ${points[from].name} → ${points[to].name}.`,
        },
      };
    }
    legs.push({
      from,
      to,
      path,
      distance: matrix[from][to],
      color: LEG_COLORS[i % LEG_COLORS.length],
    });
  }

  const geometry = buildRouteGeometry(graph, legs, selected);
  const alternatives: AlternativeOrder[] = [];
  if (points.length - 2 <= 7) {
    const top = bruteForceOrders(matrix, 4);
    for (const alt of top) {
      if (alt.order.join(',') === solution.order.join(',')) continue;
      alternatives.push({
        order: alt.order,
        cost: alt.cost,
        delta: alt.cost - solution.cost,
      });
      if (alternatives.length >= 3) break;
    }
  }

  return {
    plan: {
      points,
      matrix,
      runs,
      order: solution.order,
      legs,
      totalDistance: solution.cost,
      alternatives,
      geometry,
    },
    unreachable: null,
  };
}

// --- stitched geometry for map rendering and animation -------------------

export interface RouteGeometry {
  coords: Coord[];
  /** cumulative[i] = distance from route start to coords[i]. */
  cumulative: number[];
  totalDistance: number;
  stopEvents: StopEvent[];
  legRanges: { start: number; end: number; distance: number; color: string; legIndex: number }[];
}

export interface StopEvent {
  /** Distance along the stitched route at which the stop is reached. */
  at: number;
  stopId: string;
  name: string;
  passengers: number;
  coord: Coord;
  order: number;
  isDestination: boolean;
}

export function buildRouteGeometry(
  graph: Graph,
  legs: RouteLeg[],
  selected: SelectedStop[],
): RouteGeometry {
  const coords: Coord[] = [];
  const cumulative: number[] = [];
  const stopEvents: StopEvent[] = [];
  const legRanges: RouteGeometry['legRanges'] = [];
  let distance = 0;

  const push = (c: Coord) => {
    const last = coords[coords.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) return;
    if (last) {
      const [lon1, lat1] = last;
      const [lon2, lat2] = c;
      // Inline haversine to avoid an import cycle in hot animation code.
      const toRad = Math.PI / 180;
      const p1 = lat1 * toRad;
      const p2 = lat2 * toRad;
      const dp = (lat2 - lat1) * toRad;
      const dl = (lon2 - lon1) * toRad;
      const h =
        Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      distance += 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    coords.push(c);
    cumulative.push(distance);
  };

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const legStart = distance;
    for (const v of leg.path) push(vertexCoord(graph, v));
    legRanges.push({
      start: legStart,
      end: distance,
      distance: leg.distance,
      color: leg.color,
      legIndex: i,
    });

    const isLast = i === legs.length - 1;
    if (isLast) {
      stopEvents.push({
        at: distance,
        stopId: 'destination',
        name: graph.destination.name,
        passengers: 0,
        coord: [graph.destination.lon, graph.destination.lat],
        order: i,
        isDestination: true,
      });
    } else {
      // leg.to is the matrix index of the pickup stop reached at the end of this leg.
      const sel = selected[leg.to - 1];
      const point = leg.path[leg.path.length - 1];
      stopEvents.push({
        at: distance,
        stopId: sel?.stop.id ?? `stop-${i}`,
        name: sel?.stop.name ?? `Stop ${i + 1}`,
        passengers: sel?.passengers ?? 0,
        coord: vertexCoord(graph, point),
        order: i,
        isDestination: false,
      });
    }
  }

  return { coords, cumulative, totalDistance: distance, stopEvents, legRanges };
}

export function pointAtDistance(
  geometry: RouteGeometry,
  at: number,
): { coord: Coord; legIndex: number; segmentIndex: number } {
  const total = geometry.totalDistance;
  const d = Math.max(0, Math.min(at, total));
  const cum = geometry.cumulative;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const i = Math.min(lo, geometry.coords.length - 2);
  const a = geometry.coords[i];
  const b = geometry.coords[i + 1] ?? a;
  const span = cum[i + 1] - cum[i];
  const t = span > 0 ? (d - cum[i]) / span : 0;
  const leg = geometry.legRanges.find((r) => d >= r.start && d <= r.end) ?? geometry.legRanges[0];
  return {
    coord: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    legIndex: leg?.legIndex ?? 0,
    segmentIndex: i,
  };
}

export function totalPassengers(selected: SelectedStop[]): number {
  return selected.reduce((sum, s) => sum + s.passengers, 0);
}
