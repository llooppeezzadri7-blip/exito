import { buildContext } from "./engine.js";
import { startApi } from "./api/server.js";
import { env } from "./config/env.js";

/** API/dashboard only (no workers) — for deployments that split workers and web. */
const ctx = buildContext();
ctx.store.init().then(() => startApi({ ctx, scheduler: null, worker: null, streams: [], paper: null }, { port: env.API_PORT, host: env.API_HOST }));
