import { createEngine } from "./engine.js";
import { startApi } from "./api/server.js";
import { logger } from "./core/logger.js";
import { env } from "./config/env.js";

/** Single-process entry: workers + API/dashboard. Use main.ts for VPS/docker; api-main.ts for a separate API. */
const engine = createEngine();
const shutdown = async (sig: string) => {
  logger.info({ sig }, "shutting down");
  await engine.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => logger.error({ err: String(e) }, "unhandled rejection"));

engine
  .start()
  .then(() => startApi(engine, { port: env.API_PORT, host: env.API_HOST }))
  .catch((e) => {
    logger.fatal({ err: String(e) }, "engine failed to start");
    process.exit(1);
  });
