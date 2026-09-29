import WebSocket from "ws";
import type { DiscoveredToken } from "../../core/model.js";
import type { DiscoveryStream } from "../types.js";
import { logger } from "../../core/logger.js";

/**
 * PumpPortal public data stream (wss://pumpportal.fun/api/data).
 * Only the FREE methods are used: subscribeNewToken (token creations on pump.fun-style launchpads)
 * and subscribeMigration (bonding curve -> AMM). No paid/metered subscriptions, no wallet linked.
 * If the socket is unreachable the engine keeps running on polling sources (DATA_SOURCE_DEGRADED).
 */
export class PumpPortalStream implements DiscoveryStream {
  readonly id = "pumpportal-ws";
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectDelay = 2000;
  private onToken: ((t: DiscoveredToken) => void) | null = null;
  public received = 0;
  public lastMessageAt: string | null = null;

  constructor(private readonly url = "wss://pumpportal.fun/api/data") {}

  isRunning(): boolean {
    return this.running && this.ws?.readyState === WebSocket.OPEN;
  }

  async start(onToken: (t: DiscoveredToken) => void): Promise<void> {
    this.onToken = onToken;
    this.running = true;
    this.connect();
  }

  private connect(): void {
    if (!this.running) return;
    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.on("open", () => {
        this.reconnectDelay = 2000;
        ws.send(JSON.stringify({ method: "subscribeNewToken" }));
        ws.send(JSON.stringify({ method: "subscribeMigration" }));
        logger.info({ url: this.url }, "pumpportal stream connected (free subscriptions only)");
      });
      ws.on("message", (data) => {
        this.received++;
        this.lastMessageAt = new Date().toISOString();
        try {
          const msg = JSON.parse(data.toString());
          const t = parsePumpPortalMessage(msg);
          if (t && this.onToken) this.onToken(t);
        } catch {}
      });
      ws.on("close", () => this.scheduleReconnect());
      ws.on("error", (e) => {
        logger.warn({ err: e.message }, "pumpportal stream error");
        ws.close();
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "pumpportal connect failed");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const d = this.reconnectDelay;
    this.reconnectDelay = Math.min(60_000, this.reconnectDelay * 2);
    setTimeout(() => this.connect(), d).unref();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.ws?.close();
    this.ws = null;
  }
}

/** Pure parser (unit tested). Returns null for non-token messages (subscription acks, etc.). */
export function parsePumpPortalMessage(msg: unknown): DiscoveredToken | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const mint = typeof m.mint === "string" ? m.mint : null;
  if (!mint) return null;
  const txType = typeof m.txType === "string" ? m.txType : "unknown";
  if (txType !== "create" && txType !== "migrate") return null;
  return {
    chain: "solana",
    mint,
    symbol: typeof m.symbol === "string" ? m.symbol : null,
    name: typeof m.name === "string" ? m.name : null,
    pairAddress: typeof m.bondingCurveKey === "string" ? m.bondingCurveKey : typeof m.pool === "string" && m.pool.length > 20 ? m.pool : null,
    createdAt: txType === "create" ? new Date().toISOString() : null,
    source: `pumpportal:${txType}`,
    observedAt: new Date().toISOString(),
    liquidityUsd: null,
    volumeH1Usd: null,
    raw: { txType, deployer: typeof m.traderPublicKey === "string" ? m.traderPublicKey : null, pool: m.pool ?? null, initialBuy: m.initialBuy ?? null, solAmount: m.solAmount ?? null },
  };
}
