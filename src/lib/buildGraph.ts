import { coordKey, haversine, planarDist2 } from './geo';
import type {
  Coord,
  Edge,
  EndpointInfo,
  GraphMeta,
  RoadLine,
  SerializedGraph,
  StopInfo,
} from './types';

const DRIVABLE_HIGHWAYS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
]);

export interface RawFeature {
  type?: string;
  id?: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

export interface RawGeoJSON {
  type: string;
  features: RawFeature[];
}

export interface BuildOptions {
  startNodeId: string;
  destinationNodeId: string;
  maxStopSnapMeters: number;
  sourceName: string;
}

interface RawWay {
  id: string;
  props: Record<string, unknown>;
  coords: Coord[];
}

interface Segment {
  from: number;
  to: number;
  weight: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

export function isDrivable(props: Record<string, unknown>): boolean {
  const highway = str(props.highway);
  if (!highway || !DRIVABLE_HIGHWAYS.has(highway)) return false;
  if (str(props.service) === 'parking_aisle') return false;
  if (str(props.motor_vehicle) === 'no' || str(props.access) === 'no') return false;
  return true;
}

/** 1 = along coordinate order, -1 = against, 0 = both directions. */
export function travelDirection(props: Record<string, unknown>): 0 | 1 | -1 {
  const oneway = str(props.oneway);
  if (oneway === 'no' || oneway === 'false' || oneway === '0') return 0;
  if (oneway === '-1' || oneway === 'reverse') return -1;
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') return 1;
  if (str(props.junction) === 'roundabout' || str(props.junction) === 'circular') return 1;
  return 0;
}

export function featureId(f: RawFeature): string {
  return String(f.properties['@id'] ?? f.id ?? '');
}

function pointOf(f: RawFeature): Coord | null {
  if (!f.geometry || f.geometry.type !== 'Point') return null;
  const c = f.geometry.coordinates as unknown;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lon = num(c[0]);
  const lat = num(c[1]);
  return lon === undefined || lat === undefined ? null : [lon, lat];
}

function lineOf(f: RawFeature): Coord[] | null {
  if (!f.geometry || f.geometry.type !== 'LineString') return null;
  const coords = f.geometry.coordinates as unknown;
  if (!Array.isArray(coords)) return null;
  const out: Coord[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lon = num(c[0]);
    const lat = num(c[1]);
    if (lon !== undefined && lat !== undefined) out.push([lon, lat]);
  }
  return out.length >= 2 ? out : null;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    let root = a;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[a] !== a) {
      const next = this.parent[a];
      this.parent[a] = root;
      a = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Largest strongly connected component size, via iterative Kosaraju. */
function largestStrongComponentSize(adj: ReadonlyArray<ReadonlyArray<Edge>>): number {
  const n = adj.length;
  const seen = new Uint8Array(n);
  const order: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const stack: { v: number; i: number }[] = [{ v: start, i: 0 }];
    seen[start] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < adj[top.v].length) {
        const next = adj[top.v][top.i++][0];
        if (!seen[next]) {
          seen[next] = 1;
          stack.push({ v: next, i: 0 });
        }
      } else {
        order.push(top.v);
        stack.pop();
      }
    }
  }

  const reverse: number[][] = Array.from({ length: n }, () => []);
  for (let u = 0; u < n; u++) for (const [v] of adj[u]) reverse[v].push(u);

  seen.fill(0);
  let largest = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const start = order[i];
    if (seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of reverse[u]) {
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    if (size > largest) largest = size;
  }
  return largest;
}

export class GraphBuildError extends Error {}

export function buildGraph(data: RawGeoJSON, options: BuildOptions): SerializedGraph {
  const ways: RawWay[] = [];
  const stopsRaw: { id: string; name: string; lon: number; lat: number; ref?: string; routeRef?: string }[] = [];
  let startFeature: { id: string; name: string; coord: Coord } | null = null;
  let destinationFeature: { id: string; name: string; coord: Coord } | null = null;
  let featureCount = 0;
  let omittedWays = 0;

  for (const f of data.features) {
    featureCount++;
    const id = featureId(f);
    const props = f.properties ?? {};
    if (f.geometry?.type === 'LineString') {
      const coords = lineOf(f);
      if (!coords) continue;
      if (!isDrivable(props)) {
        omittedWays++;
        continue;
      }
      ways.push({ id: id || `way/${ways.length}`, props, coords });
    } else if (f.geometry?.type === 'Point') {
      const coord = pointOf(f);
      if (!coord) continue;
      if (id === options.startNodeId) {
        startFeature = { id, name: str(props.name) ?? 'Start', coord };
      }
      if (id === options.destinationNodeId) {
        destinationFeature = { id, name: str(props.name) ?? 'Destination', coord };
      }
      if (str(props.highway) === 'bus_stop') {
        stopsRaw.push({
          id,
          name: str(props.name) ?? `Bus stop ${id}`,
          lon: coord[0],
          lat: coord[1],
          ref: str(props.ref) ?? str(props.local_ref),
          routeRef: str(props.route_ref),
        });
      }
    }
  }

  if (!startFeature) throw new GraphBuildError(`Start node ${options.startNodeId} not found`);
  if (!destinationFeature) {
    throw new GraphBuildError(`Destination node ${options.destinationNodeId} not found`);
  }

  // --- vertices & directed segments -------------------------------------
  const vertexByKey = new Map<string, number>();
  const rawCoords: Coord[] = [];
  const segments: Segment[] = [];
  const roads: RoadLine[] = [];
  let oneWaySegmentCount = 0;

  const vertexIndex = (c: Coord): number => {
    const key = coordKey(c[0], c[1]);
    const existing = vertexByKey.get(key);
    if (existing !== undefined) return existing;
    const id = rawCoords.length;
    vertexByKey.set(key, id);
    rawCoords.push(c);
    return id;
  };

  for (const way of ways) {
    const direction = travelDirection(way.props);
    const ids = way.coords.map(vertexIndex);
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      if (a === b) continue;
      const weight = haversine(rawCoords[a], rawCoords[b]);
      if (direction >= 0) segments.push({ from: a, to: b, weight });
      if (direction <= 0) segments.push({ from: b, to: a, weight });
      if (direction !== 0) oneWaySegmentCount++;
    }
    roads.push({
      highway: str(way.props.highway) ?? 'unclassified',
      name: str(way.props.name),
      oneway: direction,
      layer: num(way.props.layer),
      bridge: way.props.bridge === 'yes' || way.props.bridge === 'viaduct',
      tunnel: way.props.tunnel === 'yes' || way.props.tunnel === 'building_passage',
      coords: way.coords,
    });
  }

  // --- largest weakly connected component -------------------------------
  const uf = new UnionFind(rawCoords.length);
  for (const s of segments) uf.union(s.from, s.to);
  const sizes = new Map<number, number>();
  for (let i = 0; i < rawCoords.length; i++) {
    const root = uf.find(i);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const componentSizes = [...sizes.values()].sort((a, b) => b - a);
  let mainRoot = -1;
  let mainSize = 0;
  for (const [root, size] of sizes) {
    if (size > mainSize) {
      mainSize = size;
      mainRoot = root;
    }
  }

  const remap = new Int32Array(rawCoords.length).fill(-1);
  const mainCoords: Coord[] = [];
  for (let i = 0; i < rawCoords.length; i++) {
    if (uf.find(i) === mainRoot) {
      remap[i] = mainCoords.length;
      mainCoords.push(rawCoords[i]);
    }
  }

  const edgeMaps: Map<number, number>[] = Array.from({ length: mainCoords.length }, () => new Map());
  let mainSegmentCount = 0;
  for (const s of segments) {
    const a = remap[s.from];
    const b = remap[s.to];
    if (a < 0 || b < 0) continue;
    mainSegmentCount++;
    const bucket = edgeMaps[a];
    const existing = bucket.get(b);
    if (existing === undefined || s.weight < existing) bucket.set(b, s.weight);
  }

  const adj: Edge[][] = edgeMaps.map((m) =>
    [...m.entries()].map(([to, weight]) => [to, weight] as const),
  );
  let edgeCount = 0;
  for (const list of adj) edgeCount += list.length;

  // --- snap endpoints and stops ----------------------------------------
  const snap = (lon: number, lat: number): { vertex: number; distance: number } => {
    let best = 0;
    let bestPlanar = Infinity;
    for (let i = 0; i < mainCoords.length; i++) {
      const c = mainCoords[i];
      const d = planarDist2(lon, lat, c[0], c[1]);
      if (d < bestPlanar) {
        bestPlanar = d;
        best = i;
      }
    }
    return { vertex: best, distance: haversine([lon, lat], mainCoords[best]) };
  };

  const startSnap = snap(startFeature.coord[0], startFeature.coord[1]);
  const destinationSnap = snap(destinationFeature.coord[0], destinationFeature.coord[1]);

  const makeEndpoint = (
    feature: { id: string; name: string; coord: Coord },
    snapped: { vertex: number; distance: number },
  ): EndpointInfo => ({
    id: feature.id,
    name: feature.name,
    lon: feature.coord[0],
    lat: feature.coord[1],
    vertex: snapped.vertex,
    snapDistance: snapped.distance,
  });

  const start = makeEndpoint(startFeature, startSnap);
  const destination = makeEndpoint(destinationFeature, destinationSnap);

  const stops: StopInfo[] = [];
  let droppedFarStops = 0;
  let maxStopSnapMeters = 0;
  for (const stop of stopsRaw) {
    if (stop.id === options.destinationNodeId) continue;
    const snapped = snap(stop.lon, stop.lat);
    if (snapped.distance > options.maxStopSnapMeters) {
      droppedFarStops++;
      continue;
    }
    maxStopSnapMeters = Math.max(maxStopSnapMeters, snapped.distance);
    stops.push({
      id: stop.id,
      name: stop.name,
      lon: stop.lon,
      lat: stop.lat,
      vertex: snapped.vertex,
      snapDistance: snapped.distance,
      ref: stop.ref,
      routeRef: stop.routeRef,
    });
  }
  stops.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const meta: GraphMeta = {
    source: options.sourceName,
    featureCount,
    drivableWayCount: ways.length,
    omittedWays,
    vertexCount: mainCoords.length,
    edgeCount,
    rawVertexCount: rawCoords.length,
    rawEdgeCount: segments.length,
    droppedEdgeCount: segments.length - mainSegmentCount,
    componentSizes,
    mainComponentSize: mainCoords.length,
    largestStrongComponentSize: largestStrongComponentSize(adj),
    droppedVertexCount: rawCoords.length - mainCoords.length,
    oneWaySegmentCount,
    stopCount: stops.length,
    droppedFarStops,
    maxStopSnapMeters,
    startSnapMeters: start.snapDistance,
    destinationSnapMeters: destination.snapDistance,
  };

  return {
    meta,
    vertices: mainCoords.flatMap((c) => [c[0], c[1]]),
    adj: adj.map((list) => list.map(([to, weight]) => [to, weight])),
    stops,
    start,
    destination,
    roads,
  };
}
