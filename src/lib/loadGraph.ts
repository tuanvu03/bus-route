import type { Edge, Graph, SerializedGraph } from './types';

export async function loadGraph(url = '/graph.json'): Promise<Graph> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not load ${url} (${response.status}). Run "npm run build:graph" first.`,
    );
  }
  const raw = (await response.json()) as SerializedGraph;
  const adj: Edge[][] = raw.adj.map((list) =>
    list.map(([to, weight]) => [to, weight] as const),
  );
  return {
    meta: raw.meta,
    coords: new Float64Array(raw.vertices),
    adj,
    stops: raw.stops,
    start: raw.start,
    destination: raw.destination,
    roads: raw.roads,
  };
}
