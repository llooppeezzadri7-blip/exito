import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { logger } from "../core/logger.js";

/** Applies migrations/*.sql in lexical order, once each (tracked in schema_migrations). */
export async function runMigrations(pool: Pool, dir?: string): Promise<string[]> {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const migrationsDir = dir ?? path.resolve(here, "../../migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const applied = new Set((await pool.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [f]);
      await client.query("COMMIT");
      ran.push(f);
      logger.info({ migration: f }, "migration applied");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return ran;
}
