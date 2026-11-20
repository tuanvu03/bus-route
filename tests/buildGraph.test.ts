import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGraph,
  travelDirection,
  type RawGeoJSON,
} from '../src/lib/buildGraph';
import {
  DESTINATION_NODE_ID,
  MAX_STOPS,
  MAX_STOP_SNAP_METERS,
  START_NODE_ID,
} from '../src/config';
import { haversine } from '../src/lib/geo';

const raw = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'export.geojson'), 'utf8'),
) as RawGeoJSON;

describe('graph construction', () => {
  const graph = buildGraph(raw, {
    startNodeId: START_NODE_ID,
    destinationNodeId: DESTINATION_NODE_ID,
    maxStopSnapMeters: MAX_STOP_SNAP_METERS,
    sourceName: 'export.geojson',
  });

  it('keeps the largest weakly connected component', () => {
    expect(graph.meta.rawVertexCount).toBe(5161);
    expect(graph.meta.vertexCount).toBe(5089);
    expect(graph.meta.componentSizes[0]).toBe(5089);
    expect(graph.meta.componentSizes).toHaveLength(8);
    expect(graph.meta.edgeCount).toBe(10614);
  });

  it('places start, destination and every offered stop in the main component', () => {
    const n = graph.vertices.length / 2;
    expect(graph.start.vertex).toBeGreaterThanOrEqual(0);
    expect(graph.start.vertex).toBeLessThan(n);
    expect(graph.destination.vertex).toBeGreaterThanOrEqual(0);
    expect(graph.destination.vertex).toBeLessThan(n);
    for (const stop of graph.stops) {
      expect(stop.vertex).toBeGreaterThanOrEqual(0);
      expect(stop.vertex).toBeLessThan(n);
      expect(haversine([stop.lon, stop.lat], [
        graph.vertices[stop.vertex * 2],
        graph.vertices[stop.vertex * 2 + 1],
      ])).toBeCloseTo(stop.snapDistance, 6);
    }
  });

  it('reports the expected data footprint', () => {
    expect(graph.meta.stopCount).toBe(291);
    expect(graph.meta.droppedFarStops).toBe(3);
    expect(graph.meta.oneWaySegmentCount).toBe(829);
    expect(graph.meta.startSnapMeters).toBeCloseTo(2.8, 1);
    expect(graph.meta.destinationSnapMeters).toBeCloseTo(164.8, 1);
    expect(graph.stops.length).toBeLessThanOrEqual(294);
    expect(MAX_STOPS).toBe(9);
    expect(new Set(graph.stops.map((s) => s.id)).size).toBe(graph.stops.length);
  });

  it('tags directions from OSM tags', () => {
    expect(travelDirection({ highway: 'residential' })).toBe(0);
    expect(travelDirection({ highway: 'residential', oneway: 'yes' })).toBe(1);
    expect(travelDirection({ highway: 'residential', oneway: '-1' })).toBe(-1);
    expect(travelDirection({ highway: 'residential', oneway: 'no' })).toBe(0);
    expect(travelDirection({ highway: 'tertiary', junction: 'roundabout' })).toBe(1);
    expect(travelDirection({ highway: 'tertiary', junction: 'roundabout', oneway: '-1' })).toBe(-1);
  });

  it('applies oneway=yes and oneway=-1 to built edges', () => {
    const point = (id: string, coords: [number, number]) => ({
      type: 'Feature',
      properties: { '@id': id },
      geometry: { type: 'Point' as const, coordinates: coords },
    });
    const way = (oneway: string, coords: [number, number][]) => ({
      type: 'Feature',
      properties: { highway: 'residential', oneway },
      geometry: { type: 'LineString' as const, coordinates: coords },
    });
    const options = {
      startNodeId: 'node/start',
      destinationNodeId: 'node/dest',
      maxStopSnapMeters: 150,
      sourceName: 'synthetic',
    };

    const forward = buildGraph(
      {
        type: 'FeatureCollection',
        features: [
          point('node/start', [0, 0]),
          point('node/dest', [0.001, 0]),
          way('yes', [
            [0, 0],
            [0.001, 0],
          ]),
        ],
      },
      options,
    );
    expect(forward.adj[0].some(([to]) => to === 1)).toBe(true);
    expect(forward.adj[1].some(([to]) => to === 0)).toBe(false);

    // With reversed coordinate order and oneway=-1, travel is still 0 -> 1.
    const reverse = buildGraph(
      {
        type: 'FeatureCollection',
        features: [
          point('node/start', [0, 0]),
          point('node/dest', [0.001, 0]),
          way('-1', [
            [0.001, 0],
            [0, 0],
          ]),
        ],
      },
      options,
    );
    expect(reverse.adj[1].some(([to]) => to === 0)).toBe(true);
    expect(reverse.adj[0].some(([to]) => to === 1)).toBe(false);
  });

  it('does not connect geometrically crossing bridges without shared vertices', () => {    const synthetic: RawGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { '@id': 'node/start' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          properties: { '@id': 'node/dest' },
          geometry: { type: 'Point', coordinates: [0.01, 0] },
        },
        {
          type: 'Feature',
          properties: { highway: 'residential' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.01, 0],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { highway: 'residential', bridge: 'yes', layer: 1 },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0.005, -0.001],
              [0.005, 0.001],
            ],
          },
        },
      ],
    };
    const g = buildGraph(synthetic, {
      startNodeId: 'node/start',
      destinationNodeId: 'node/dest',
      maxStopSnapMeters: 150,
      sourceName: 'synthetic',
    });
    // The bridge is a separate component and is dropped, so the main graph has 2 vertices.
    expect(g.meta.vertexCount).toBe(2);
    expect(g.meta.componentSizes).toEqual([2, 2]);
  });
});
