import type { EngineConfig } from "../config/schema.js";
import type { Store } from "../db/store.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Logger } from "../core/logger.js";

export interface EngineContext {
  cfg: EngineConfig;
  store: Store;
  registry: ProviderRegistry;
  log: Logger;
  /** Injectable clock for tests. */
  now: () => Date;
  /** In-process counters for the health dashboard. */
  counters: Record<string, number>;
}

export function bump(ctx: EngineContext, key: string, n = 1): void {
  ctx.counters[key] = (ctx.counters[key] ?? 0) + n;
}
