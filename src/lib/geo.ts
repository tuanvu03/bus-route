import type { Coord } from './types';

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres between two [lon, lat] coordinates. */
export function haversine(a: Coord, b: Coord): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Stable vertex key: coordinates rounded to 7 decimals, as required by the spec. */
export function coordKey(lon: number, lat: number): string {
  return `${lon.toFixed(7)},${lat.toFixed(7)}`;
}

/** Squared planar distance, only for cheap nearest-point comparisons in a small bbox. */
export function planarDist2(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const x = (lon1 - lon2) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = lat1 - lat2;
  return x * x + y * y;
}

/** Interpolate a point a fraction t along a straight lon/lat segment. */
export function lerpCoord(a: Coord, b: Coord, t: number): Coord {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
