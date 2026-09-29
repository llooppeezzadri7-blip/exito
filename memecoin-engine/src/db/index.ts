import { env, storeKind } from "../config/env.js";
import { MemoryStore } from "./memory-store.js";
import { PostgresStore } from "./postgres-store.js";
import type { Store } from "./store.js";
import { logger } from "../core/logger.js";

export function createStore(): Store {
  if (storeKind === "postgres" && env.DATABASE_URL) return new PostgresStore(env.DATABASE_URL);
  logger.warn("DATABASE_URL not set — using in-memory store (NOT durable, dev only)");
  return new MemoryStore();
}

export type { Store } from "./store.js";
export { MemoryStore, PostgresStore };
