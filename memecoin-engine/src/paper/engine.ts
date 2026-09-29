import { randomUUID } from "node:crypto";
import type { EngineContext } from "../pipeline/context.js";
import { bump } from "../pipeline/context.js";
import type { AnalysisOutcome } from "../pipeline/analyze-token.js";
import type { PaperTradeRecord } from "../db/records.js";
import { round } from "../core/stats.js";

/**
 * PAPER TRADING ENGINE — simulation only. No wallet, no keys, no transactions.
 * Entries: HIGH_CONVICTION_SETUP in EARLY phase (all gates passed). Exits: stop loss, take profit,
 * trailing stop, max hold, thesis invalidated / rug warning. Slippage + fees are charged both ways.
 */
export class PaperTradingEngine {
  constructor(private readonly ctx: EngineContext) {}

  get cfg() {
    return this.ctx.cfg.paper_trading;
  }

  async onAnalysis(out: AnalysisOutcome): Promise<{ opened?: PaperTradeRecord; closed?: PaperTradeRecord }> {
    if (!this.cfg.enabled) return {};
    const price = out.snapshot.market?.priceUsd.value ?? null;
    if (price === null || price <= 0) return {};
    const open = await this.ctx.store.getOpenPaperTrade(out.token.chain, out.token.mint);
    if (open) {
      const closed = await this.manage(open, price, out);
      return closed ? { closed } : {};
    }
    const opp = out.opportunity;
    if (opp.category !== "HIGH_CONVICTION_SETUP" || opp.phase !== "EARLY" || opp.gates.some((g) => !g.passed)) return {};
    const openCount = (await this.ctx.store.listPaperTrades({ status: "OPEN" })).length;
    if (openCount >= this.cfg.max_open_positions) return {};
    const opened = await this.open(out, price);
    return { opened };
  }

  async open(out: AnalysisOutcome, price: number, reason = "HIGH_CONVICTION_SETUP (auto paper)"): Promise<PaperTradeRecord> {
    const size = round(this.cfg.bankroll_usd * (this.cfg.position_pct / 100), 2);
    const fill = price * (1 + this.cfg.slippage_pct / 100);
    const fee = round(size * (this.cfg.fee_pct / 100), 4);
    const t: PaperTradeRecord = {
      id: randomUUID(), chain: out.token.chain, mint: out.token.mint, symbol: out.token.symbol, openedAt: this.ctx.now().toISOString(), closedAt: null,
      entryPriceUsd: price, entryFillPriceUsd: fill, sizeUsd: size, tokens: (size - fee) / fill, feesUsd: fee, slippagePct: this.cfg.slippage_pct,
      exitPriceUsd: null, exitFillPriceUsd: null, pnlUsd: null, pnlPct: null, peakPriceUsd: price, troughPriceUsd: price, maxDrawdownPct: 0,
      reason, exitReason: null, scoreAtEntry: out.opportunity.score, opportunityCategory: out.opportunity.category, status: "OPEN",
    };
    await this.ctx.store.insertPaperTrade(t);
    await this.ctx.store.insertAudit({ at: t.openedAt, actor: "paper-engine", action: "paper_open", subject: `${t.chain}:${t.mint}`, data: { id: t.id, fill, size, fee, score: t.scoreAtEntry } });
    bump(this.ctx, "paper_opened");
    return t;
  }

  /** Mark-to-market + exit rules. Returns the closed trade when an exit fired. */
  async manage(t: PaperTradeRecord, price: number, out: AnalysisOutcome | null): Promise<PaperTradeRecord | null> {
    const peak = Math.max(t.peakPriceUsd, price);
    const trough = Math.min(t.troughPriceUsd, price);
    const dd = round(((trough - peak) / peak) * 100, 2);
    const pnlPct = ((price - t.entryFillPriceUsd) / t.entryFillPriceUsd) * 100;
    const held = (this.ctx.now().getTime() - new Date(t.openedAt).getTime()) / 3_600_000;
    let exit: string | null = null;
    if (pnlPct <= this.cfg.stop_loss_pct) exit = "STOP_LOSS";
    else if (pnlPct >= this.cfg.take_profit_pct) exit = "TAKE_PROFIT";
    else if (peak > t.entryFillPriceUsd * 1.3 && price <= peak * (1 - this.cfg.trailing_stop_pct / 100)) exit = "TRAILING_STOP";
    else if (held >= this.cfg.max_hold_hours) exit = "MAX_HOLD";
    else if (out && (out.opportunity.thesis === "THESIS_INVALIDATED" || out.opportunity.risk === "EXTREME_RISK" || out.newFlags.includes("LIQUIDITY_DROP"))) exit = `THESIS_EXIT:${out.opportunity.thesis}`;
    if (!exit) {
      await this.ctx.store.patchPaperTrade(t.id, { peakPriceUsd: peak, troughPriceUsd: trough, maxDrawdownPct: Math.min(t.maxDrawdownPct, dd) });
      return null;
    }
    return this.close(t, price, exit, { peak, trough, dd });
  }

  async close(t: PaperTradeRecord, price: number, exitReason: string, extra?: { peak: number; trough: number; dd: number }): Promise<PaperTradeRecord> {
    // Exits on illiquid memecoins are worse than entries: apply double slippage when the reason is risk-driven.
    const slip = exitReason.startsWith("THESIS_EXIT") || exitReason === "STOP_LOSS" ? this.cfg.slippage_pct * 2 : this.cfg.slippage_pct;
    const fill = price * (1 - slip / 100);
    const gross = t.tokens * fill;
    const fee = round(gross * (this.cfg.fee_pct / 100), 4);
    const pnl = round(gross - fee - t.sizeUsd, 4);
    const patch: Partial<PaperTradeRecord> = {
      closedAt: this.ctx.now().toISOString(), exitPriceUsd: price, exitFillPriceUsd: fill, pnlUsd: pnl, pnlPct: round((pnl / t.sizeUsd) * 100, 2), feesUsd: round(t.feesUsd + fee, 4),
      peakPriceUsd: extra?.peak ?? t.peakPriceUsd, troughPriceUsd: extra?.trough ?? t.troughPriceUsd, maxDrawdownPct: Math.min(t.maxDrawdownPct, extra?.dd ?? 0), exitReason, status: "CLOSED",
    };
    await this.ctx.store.patchPaperTrade(t.id, patch);
    await this.ctx.store.insertAudit({ at: patch.closedAt!, actor: "paper-engine", action: "paper_close", subject: `${t.chain}:${t.mint}`, data: { id: t.id, exitReason, pnl, pnlPct: patch.pnlPct } });
    bump(this.ctx, "paper_closed");
    return { ...t, ...patch };
  }
}

export interface PaperStats {
  trades: number;
  open: number;
  winRate: number | null;
  averageReturnPct: number | null;
  medianReturnPct: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  expectedValuePct: number | null;
  maxDrawdownPct: number | null;
  totalPnlUsd: number;
  falsePositiveRate: number | null;
  byExitReason: Record<string, number>;
  sampleWarning: string | null;
}

/** Honest statistics: computed only from closed simulated trades; small samples are flagged. */
export function paperStats(trades: PaperTradeRecord[], bankroll: number): PaperStats {
  const closed = trades.filter((t) => t.status === "CLOSED" && t.pnlPct !== null).sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""));
  const rets = closed.map((t) => t.pnlPct!);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null);
  const sorted = [...rets].sort((a, b) => a - b);
  const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2) : null;
  let equity = bankroll;
  let peak = bankroll;
  let maxDd = 0;
  for (const t of closed) {
    equity += t.pnlUsd ?? 0;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, ((equity - peak) / peak) * 100);
  }
  const byExit: Record<string, number> = {};
  for (const t of closed) byExit[t.exitReason ?? "?"] = (byExit[t.exitReason ?? "?"] ?? 0) + 1;
  const fp = closed.filter((t) => (t.exitReason ?? "").startsWith("THESIS_EXIT") || t.exitReason === "STOP_LOSS").length;
  return {
    trades: closed.length,
    open: trades.filter((t) => t.status === "OPEN").length,
    winRate: rets.length ? round(wins.length / rets.length, 3) : null,
    averageReturnPct: avg(rets),
    medianReturnPct: med === null ? null : round(med, 2),
    averageWinPct: avg(wins),
    averageLossPct: avg(losses),
    expectedValuePct: rets.length ? round((wins.length / rets.length) * (avg(wins) ?? 0) + (losses.length / rets.length) * (avg(losses) ?? 0), 2) : null,
    maxDrawdownPct: closed.length ? round(maxDd, 2) : null,
    totalPnlUsd: round(closed.reduce((a, t) => a + (t.pnlUsd ?? 0), 0), 2),
    falsePositiveRate: closed.length ? round(fp / closed.length, 3) : null,
    byExitReason: byExit,
    sampleWarning: closed.length < 30 ? `only ${closed.length} closed trades — statistics are not meaningful yet (need ≥30)` : null,
  };
}
