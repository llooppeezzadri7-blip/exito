/** Small, dependency-free statistics helpers used by analyzers and the anomaly detector. */

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Median absolute deviation (robust to outliers). */
export function mad(xs: number[]): number | null {
  const m = median(xs);
  if (m === null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Robust z-score using median/MAD. Returns null when the spread is zero or the sample is too small. */
export function robustZ(x: number, sample: number[]): number | null {
  if (sample.length < 5) return null;
  const m = median(sample)!;
  const d = mad(sample);
  if (d === null || d === 0) return null;
  return (x - m) / (1.4826 * d);
}

export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Percentage growth from a to b. null when a is unusable. */
export function pctChange(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (a === 0) return b === 0 ? 0 : null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** Herfindahl-Hirschman index of shares expressed in percent (0..100). Returns 0..10000. */
export function hhi(sharesPct: number[]): number {
  return sharesPct.reduce((acc, s) => acc + s * s, 0);
}

/** Gini coefficient of a distribution of positive values (0 = equal, 1 = concentrated). */
export function gini(values: number[]): number | null {
  const xs = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * xs[i]!;
  return acc / (n * sum);
}

/** Map a value in [lo,hi] linearly to [0,100] (clamped). If invert, hi maps to 0. */
export function scale(x: number, lo: number, hi: number, invert = false): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return (invert ? 1 - t : t) * 100;
}
