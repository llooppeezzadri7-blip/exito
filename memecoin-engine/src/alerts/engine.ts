import { randomUUID } from "node:crypto";
import type { AlertType } from "../core/types.js";
import type { EngineContext } from "../pipeline/context.js";
import { bump } from "../pipeline/context.js";
import type { AnalysisOutcome } from "../pipeline/analyze-token.js";
import type { AlertRecord } from "../db/records.js";
import { actionLinks, formatOpportunityAlert, formatRiskAlert, type AlertDraft } from "./format.js";
import type { AlertChannel } from "./channels.js";
import { errMessage } from "../core/errors.js";

/**
 * ALERT ENGINE: decides which transitions deserve an alert, enforces cooldowns + hourly caps,
 * persists every alert (audit trail) and dispatches to the configured channels.
 * Opportunity alerts are only emitted when risk gates pass (RISK GATING §36).
 */
export class AlertEngine {
  private sentThisHour: { at: number }[] = [];
  constructor(private readonly ctx: EngineContext, private readonly channels: AlertChannel[], private readonly dashboardUrl: string | null = null) {}

  async process(out: AnalysisOutcome): Promise<AlertRecord[]> {
    const drafts = this.decide(out);
    const created: AlertRecord[] = [];
    for (const d of drafts) {
      if (!(await this.allowed(out, d.type))) continue;
      const rec = await this.persistAndSend(out, d);
      created.push(rec);
    }
    return created;
  }

  /** Pure-ish decision logic (unit-tested via MemoryStore). */
  decide(out: AnalysisOutcome): AlertDraft[] {
    const { opportunity: opp, previous, snapshot, token, newFlags, metrics } = out;
    const cfg = this.ctx.cfg.alerts;
    const drafts: AlertDraft[] = [];
    const wasSetup = previous && (previous.category === "WATCHLIST" || previous.category === "HIGH_CONVICTION_SETUP");
    const gated = opp.gates.some((g) => !g.passed);
    const links = actionLinks(this.dashboardUrl, token);

    // Opportunity alerts (gated)
    if (!gated) {
      if (opp.category === "HIGH_CONVICTION_SETUP" && (!previous || previous.category !== "HIGH_CONVICTION_SETUP")) {
        drafts.push(formatOpportunityAlert(previous?.category === "WATCHLIST" ? "BREAKOUT_SETUP" : "NEW_HIGH_POTENTIAL", token, snapshot, opp, links));
      } else if (opp.category === "WATCHLIST" && (opp.score ?? 0) >= cfg.min_score_for_new_high_potential && (!previous || (previous.category !== "WATCHLIST" && previous.category !== "HIGH_CONVICTION_SETUP"))) {
        drafts.push(formatOpportunityAlert("NEW_HIGH_POTENTIAL", token, snapshot, opp, links));
      }
    }
    // Risk alerts (for tokens that were interesting, or any monitored tier>=2 token for rug/liquidity)
    const tierOk = out.tierBefore >= 2;
    if (newFlags.includes("LIQUIDITY_DROP") && tierOk) drafts.push(formatRiskAlert("LIQUIDITY_DROP", token, snapshot, opp, [`liquidity ${metrics.liquidity_growth_15m ?? metrics.liquidity_growth_1h ?? "?"}%`, ...out.thesisReasons]));
    if (tierOk && (newFlags.includes("REPORTED_RUGGED") || (opp.risk === "EXTREME_RISK" && previous && previous.risk !== "EXTREME_RISK"))) drafts.push(formatRiskAlert("RUG_WARNING", token, snapshot, opp, out.opportunity.risks.slice(0, 4)));
    if (newFlags.includes("WHALE_DISTRIBUTION") && (wasSetup || out.tierBefore >= 3)) drafts.push(formatRiskAlert("WHALE_EXIT", token, snapshot, opp, [`whale net flow $${metrics.whale_net_usd_1h ?? "?"} / 1h`]));
    if (wasSetup && opp.thesis === "RISK_ESCALATING") drafts.push(formatRiskAlert("RISK_ESCALATION", token, snapshot, opp, out.thesisReasons));
    if (wasSetup && (opp.thesis === "THESIS_INVALIDATED" || opp.thesis === "THESIS_WEAKENING") && !drafts.some((d) => d.type === "LIQUIDITY_DROP" || d.type === "RUG_WARNING")) drafts.push(formatRiskAlert("EXIT_WARNING", token, snapshot, opp, out.thesisReasons));
    // Informational spikes (only when the token is at least on the watchlist to avoid noise)
    if (wasSetup || opp.category === "WATCHLIST" || opp.category === "HIGH_CONVICTION_SETUP") {
      if (newFlags.includes("VOLUME_SPIKE")) drafts.push(formatRiskAlert("VOLUME_SPIKE", token, snapshot, opp, [`1h volume ${metrics.volume_growth_1h ?? "?"}% vs own history`]));
      if (out.results.some((r) => r.analyzer === "social" && r.flags.some((f) => f.code === "SOCIAL_SPIKE"))) drafts.push(formatRiskAlert("SOCIAL_SPIKE", token, snapshot, opp, [`mentions 1h: ${metrics.mentions_1h ?? "?"}`]));
      const nar = out.results.find((r) => r.analyzer === "narrative");
      if (nar && (nar.metrics.narrative_momentum ?? 0) >= 85 && (previous?.subscores.narrative_momentum ?? 0) < 85) drafts.push(formatRiskAlert("NARRATIVE_SPIKE", token, snapshot, opp, [`narrative momentum ${nar.metrics.narrative_momentum}`]));
    }
    return drafts;
  }

  private async allowed(out: AnalysisOutcome, type: AlertType): Promise<boolean> {
    const cfg = this.ctx.cfg.alerts;
    const now = this.ctx.now().getTime();
    this.sentThisHour = this.sentThisHour.filter((s) => now - s.at < 3_600_000);
    if (this.sentThisHour.length >= cfg.max_per_hour) {
      bump(this.ctx, "alerts_suppressed_rate");
      return false;
    }
    const last = await this.ctx.store.lastAlert(out.token.chain, out.token.mint, type);
    if (last && now - new Date(last.createdAt).getTime() < cfg.cooldown_minutes * 60_000) {
      bump(this.ctx, "alerts_suppressed_cooldown");
      return false;
    }
    return true;
  }

  private async persistAndSend(out: AnalysisOutcome, d: AlertDraft): Promise<AlertRecord> {
    const rec: AlertRecord = {
      id: randomUUID(), chain: out.token.chain, mint: out.token.mint, type: d.type, severity: d.severity, title: d.title, body: d.body, payload: { ...d.payload, snapshotId: out.snapshotId },
      channels: this.channels.map((c) => c.id), deliveredTo: [], createdAt: this.ctx.now().toISOString(), sentAt: null, error: null,
    };
    await this.ctx.store.insertAlert(rec);
    this.sentThisHour.push({ at: this.ctx.now().getTime() });
    bump(this.ctx, "alerts");
    const delivered: string[] = [];
    const errors: string[] = [];
    for (const ch of this.channels) {
      try {
        await ch.send(d.title, d.body);
        delivered.push(ch.id);
      } catch (e) {
        errors.push(`${ch.id}: ${errMessage(e)}`);
        this.ctx.log.warn({ channel: ch.id, err: errMessage(e) }, "alert delivery failed");
      }
    }
    await this.ctx.store.patchAlert(rec.id, { deliveredTo: delivered, sentAt: this.ctx.now().toISOString(), error: errors.length ? errors.join("; ") : null });
    await this.ctx.store.insertAudit({ at: this.ctx.now().toISOString(), actor: "alert-engine", action: `alert:${d.type}`, subject: `${out.token.chain}:${out.token.mint}`, data: { alertId: rec.id, snapshotId: out.snapshotId, delivered, errors } });
    return { ...rec, deliveredTo: delivered };
  }
}
