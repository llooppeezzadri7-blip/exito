import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

/**
 * Secrets and infrastructure endpoints live ONLY in the environment.
 * Every integration is optional: a missing key disables that provider and the
 * ProviderRegistry marks the capability as DEGRADED instead of crashing.
 *
 * There is deliberately NO wallet private key variable. v0.1 is read-only.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  CONFIG_PATH: z.string().default("config.yaml"),

  DATABASE_URL: z.string().optional(), // postgres://... (Supabase works: use the pooler URL)
  STORE: z.enum(["postgres", "memory"]).optional(),

  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  SOLANA_RPC_WS_URL: z.string().optional(),
  HELIUS_API_KEY: z.string().optional(),
  BIRDEYE_API_KEY: z.string().optional(),

  DEXSCREENER_BASE_URL: z.string().url().default("https://api.dexscreener.com"),
  GECKOTERMINAL_BASE_URL: z.string().url().default("https://api.geckoterminal.com/api/v2"),
  RUGCHECK_BASE_URL: z.string().url().default("https://api.rugcheck.xyz/v1"),
  PUMPPORTAL_WS_URL: z.string().default("wss://pumpportal.fun/api/data"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),

  REDDIT_ENABLED: z.string().optional(),

  API_PORT: z.coerce.number().int().default(8080),
  API_HOST: z.string().default("0.0.0.0"),
  API_AUTH_TOKEN: z.string().optional(), // optional bearer token for the dashboard/API
});

const blanksAsUnset = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]));
const parsed = schema.safeParse(blanksAsUnset);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables — see docs/DEPLOYMENT.md");
}

export const env = parsed.data;

export const has = {
  postgres: Boolean(env.DATABASE_URL),
  helius: Boolean(env.HELIUS_API_KEY),
  birdeye: Boolean(env.BIRDEYE_API_KEY),
  telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  discord: Boolean(env.DISCORD_WEBHOOK_URL),
};

export const storeKind: "postgres" | "memory" = env.STORE ?? (has.postgres ? "postgres" : "memory");
