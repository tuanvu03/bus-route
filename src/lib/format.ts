export function fmtMeters(m: number): string {
  if (!Number.isFinite(m)) return '∞';
  if (m < 1000) return `${m.toFixed(m < 100 ? 1 : 0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function fmtCoord(lon: number, lat: number, precision = 5): string {
  return `${lon.toFixed(precision)}, ${lat.toFixed(precision)}`;
}

export function fmtVertex(v: number): string {
  return `v${v}`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
