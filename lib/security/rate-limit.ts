/**
 * In-memory fixed-window rate limiter. Deliberately simple: this
 * environment has no shared cache/queue infra (no Redis assumed
 * available — see ARCHITECTURE.md), so limits are per-process and reset
 * on deploy/restart. Good enough to stop runaway double-submits and
 * accidental loops on cost-bearing (AI) or network-bearing (scan/import)
 * actions today. In production behind real multi-instance hosting,
 * replace the Map with a shared store (e.g. Upstash Redis) keyed the
 * same way — the call sites don't need to change.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Demasiadas solicitudes. Inténtalo de nuevo en ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "RateLimitError";
  }
}

/** Throws RateLimitError if `key` has exceeded `limit` calls within `windowMs`. */
export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new RateLimitError(bucket.resetAt - now);
  }

  bucket.count += 1;
}
