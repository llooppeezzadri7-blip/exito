import { logger } from "../core/logger.js";
import { errMessage } from "../core/errors.js";
import type { AnyProvider, Capability } from "./types.js";

export type ProviderStatus = "OK" | "DEGRADED" | "DOWN" | "UNCONFIGURED";

export interface ProviderHealth {
  id: string;
  capability: Capability;
  status: ProviderStatus;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  avgLatencyMs: number | null;
}

interface Entry {
  provider: AnyProvider;
  health: ProviderHealth;
  latencies: number[];
}

/**
 * Registry of providers per capability with failover + health tracking.
 * If a provider fails, the next configured provider of the same capability is tried.
 * Consecutive failures mark the source DEGRADED (3+) or DOWN (8+) — never stop the engine.
 */
export class ProviderRegistry {
  private entries = new Map<string, Entry>();

  register(provider: AnyProvider): this {
    const configured = provider.isConfigured();
    this.entries.set(provider.id, {
      provider,
      latencies: [],
      health: {
        id: provider.id,
        capability: provider.capability,
        status: configured ? "OK" : "UNCONFIGURED",
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        avgLatencyMs: null,
      },
    });
    return this;
  }

  get<T extends AnyProvider>(id: string): T | undefined {
    return this.entries.get(id)?.provider as T | undefined;
  }

  list(): AnyProvider[] {
    return [...this.entries.values()].map((e) => e.provider);
  }

  byCapability<T extends AnyProvider>(cap: T["capability"], preferred?: string[]): T[] {
    const all = [...this.entries.values()]
      .filter((e) => e.provider.capability === cap && e.health.status !== "UNCONFIGURED")
      .sort((a, b) => rank(a.health.status) - rank(b.health.status));
    if (!preferred || preferred.length === 0) return all.map((e) => e.provider as T);
    const pref = new Set(preferred);
    return all.filter((e) => pref.has(e.provider.id)).map((e) => e.provider as T);
  }

  health(): ProviderHealth[] {
    return [...this.entries.values()].map((e) => ({ ...e.health }));
  }

  degradedIds(): string[] {
    return this.health()
      .filter((h) => h.status === "DEGRADED" || h.status === "DOWN")
      .map((h) => h.id);
  }

  /**
   * Run `fn` against the first healthy provider of `cap`; on failure fall back to the next.
   * Returns { value, providerId } or throws the last error when every provider failed.
   */
  async call<T extends AnyProvider, R>(
    cap: T["capability"],
    fn: (p: T) => Promise<R>,
    opts: { preferred?: string[]; exclude?: string[]; timeoutMs?: number } = {},
  ): Promise<{ value: R; providerId: string; degraded: string[] }> {
    const providers = this.byCapability<T>(cap, opts.preferred).filter((p) => !(opts.exclude ?? []).includes(p.id));
    const degraded: string[] = [];
    let lastErr: unknown = new Error(`no configured provider for capability ${cap}`);
    for (const p of providers) {
      const entry = this.entries.get(p.id)!;
      if (entry.health.status === "DOWN" && Date.now() - new Date(entry.health.lastErrorAt ?? 0).getTime() < 60_000) {
        degraded.push(p.id);
        continue; // give DOWN providers a 60s cool-off before retrying
      }
      const t0 = Date.now();
      try {
        const value = await withTimeout(fn(p), opts.timeoutMs ?? 30_000, p.id);
        this.recordSuccess(entry, Date.now() - t0);
        return { value, providerId: p.id, degraded };
      } catch (e) {
        this.recordFailure(entry, e);
        degraded.push(p.id);
        lastErr = e;
        logger.warn({ provider: p.id, cap, err: errMessage(e) }, "provider call failed, trying next");
      }
    }
    throw lastErr;
  }

  private recordSuccess(entry: Entry, latency: number): void {
    const h = entry.health;
    h.successes++;
    h.consecutiveFailures = 0;
    h.lastSuccessAt = new Date().toISOString();
    h.status = "OK";
    entry.latencies.push(latency);
    if (entry.latencies.length > 50) entry.latencies.shift();
    h.avgLatencyMs = Math.round(entry.latencies.reduce((a, b) => a + b, 0) / entry.latencies.length);
  }

  private recordFailure(entry: Entry, e: unknown): void {
    const h = entry.health;
    h.failures++;
    h.consecutiveFailures++;
    h.lastErrorAt = new Date().toISOString();
    h.lastError = errMessage(e);
    if (h.consecutiveFailures >= 8) h.status = "DOWN";
    else if (h.consecutiveFailures >= 3) h.status = "DEGRADED";
  }

  /** Test helper. */
  forceStatus(id: string, status: ProviderStatus): void {
    const e = this.entries.get(id);
    if (e) e.health.status = status;
  }
}

function rank(s: ProviderStatus): number {
  return s === "OK" ? 0 : s === "DEGRADED" ? 1 : s === "DOWN" ? 2 : 3;
}

function withTimeout<R>(p: Promise<R>, ms: number, id: string): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`provider ${id} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
