/**
 * Seedable pseudo-random helpers shared by the UI, the benchmark worker and
 * scripts. Everything here is pure so a (seed, k, index) triple reproduces the
 * same scenario in the browser and in Node.
 */

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string; lets users paste any text as a seed. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Parse a seed the user typed. Numeric strings stay numeric; anything else is hashed. */
export function parseSeed(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) >>> 0;
  return hashSeed(text);
}

/** Derive a stable per-scenario seed from the benchmark base seed, k and index. */
export function deriveScenarioSeed(baseSeed: number, k: number, index: number): number {
  let h = baseSeed >>> 0;
  h = Math.imul(h ^ (k + 0x9e3779b9), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (index + 0x7f4a7c15), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Pick `k` distinct values from a stable index list using the supplied PRNG.
 * A partial Fisher–Yates shuffle is used so the result is uniform and exactly
 * reproducible from the seed.
 */
export function pickIndices(count: number, k: number, random: () => number): number[] {
  if (k < 0 || k > count) throw new Error(`Cannot pick ${k} items from ${count}`);
  const pool = Array.from({ length: count }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(random() * (count - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, k);
}
