import { ProviderError, RateLimitedError } from "./errors.js";
import { backoffMs, sleep } from "./time.js";

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  provider: string;
}

/**
 * fetch wrapper with timeout, retry (429/5xx/network) and a typed JSON result.
 * Keeps provider code short and consistent.
 */
export async function httpJson<T = unknown>(url: string, opts: HttpOptions): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          accept: "application/json",
          "user-agent": "memecoin-intelligence-engine/0.1 (research; read-only)",
          ...(opts.body ? { "content-type": "application/json" } : {}),
          ...(opts.headers ?? {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt, 1000, 30_000);
        lastErr = new RateLimitedError(opts.provider, wait);
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        throw lastErr;
      }
      if (res.status >= 500) {
        lastErr = new ProviderError(opts.provider, `HTTP ${res.status}`, { status: res.status, retryable: true });
        if (attempt < retries) {
          await sleep(backoffMs(attempt, 500, 10_000));
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        throw new ProviderError(opts.provider, `HTTP ${res.status} for ${url}`, { status: res.status, retryable: false });
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof ProviderError && !e.retryable) throw e;
      lastErr = e;
      if (attempt < retries) {
        await sleep(backoffMs(attempt, 500, 10_000));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof ProviderError) throw lastErr;
  throw new ProviderError(opts.provider, `request failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, { cause: lastErr });
}
