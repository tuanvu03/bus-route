export type VertexId = number;
/** [longitude, latitude] */
export type Coord = [number, number];
/** Compact directed edge: [target vertex, weight in metres]. */
export type Edge = readonly [to: VertexId, weight: number];

export interface StopInfo {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Nearest vertex in the main graph component. */
  vertex: VertexId;
  /** Metres from the OSM stop point to the snapped vertex. */
  snapDistance: number;
  ref?: string;
  routeRef?: string;
}

export interface EndpointInfo {
  id: string;
  name: string;
  lon: number;
  lat: number;
  vertex: VertexId;
  snapDistance: number;
}

export interface RoadLine {
  highway: string;
  name?: string;
  /** 1 = one-way along coords, -1 = one-way against coords, 0 = two-way. */
  oneway: 0 | 1 | -1;
  layer?: number;
  bridge?: boolean;
  tunnel?: boolean;
  coords: Coord[];
}

export interface GraphMeta {
  source: string;
  featureCount: number;
  drivableWayCount: number;
  omittedWays: number;
  vertexCount: number;
  edgeCount: number;
  rawVertexCount: number;
  rawEdgeCount: number;
  droppedEdgeCount: number;
  componentSizes: number[];
  mainComponentSize: number;
  largestStrongComponentSize: number;
  droppedVertexCount: number;
  oneWaySegmentCount: number;
  stopCount: number;
  droppedFarStops: number;
  maxStopSnapMeters: number;
  startSnapMeters: number;
  destinationSnapMeters: number;
}

/** Shape written to /public/graph.json by scripts/build-graph.ts. */
export interface SerializedGraph {
  meta: GraphMeta;
  /** Flat [lon, lat, lon, lat, ...] for all vertices. */
  vertices: number[];
  /** adj[from] = [[to, weight], ...] */
  adj: number[][][];
  stops: StopInfo[];
  start: EndpointInfo;
  destination: EndpointInfo;
  roads: RoadLine[];
}

export interface Graph {
  meta: GraphMeta;
  /** Flat [lon, lat, ...] lookup by vertex id. */
  coords: Float64Array;
  adj: Edge[][];
  stops: StopInfo[];
  start: EndpointInfo;
  destination: EndpointInfo;
  roads: RoadLine[];
}

export function vertexLon(graph: Graph, v: VertexId): number {
  return graph.coords[v * 2];
}
export function vertexLat(graph: Graph, v: VertexId): number {
  return graph.coords[v * 2 + 1];
}
export function vertexCoord(graph: Graph, v: VertexId): Coord {
  return [graph.coords[v * 2], graph.coords[v * 2 + 1]];
}
export function vertexCount(graph: Graph): number {
  return graph.coords.length / 2;
}
