import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { configSchema, type EngineConfig } from "./schema.js";
import { ConfigError } from "../core/errors.js";

let cached: EngineConfig | null = null;

export function loadConfig(configPath = process.env.CONFIG_PATH ?? "config.yaml"): EngineConfig {
  if (cached) return cached;
  const abs = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(abs)) throw new ConfigError(`config file not found: ${abs}`);
  const raw = YAML.parse(fs.readFileSync(abs, "utf8"));
  const res = configSchema.safeParse(raw);
  if (!res.success) {
    throw new ConfigError(`invalid config.yaml: ${JSON.stringify(res.error.flatten().fieldErrors)}`);
  }
  cached = res.data;
  return cached;
}

export function parseConfig(raw: unknown): EngineConfig {
  const res = configSchema.safeParse(raw);
  if (!res.success) throw new ConfigError(`invalid config: ${res.error.message}`);
  return res.data;
}

/** Test helper: load config.yaml from the package root regardless of cwd. */
export function loadDefaultConfig(): EngineConfig {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return parseConfig(YAML.parse(fs.readFileSync(path.resolve(here, "../../config.yaml"), "utf8")));
}

export type { EngineConfig };
