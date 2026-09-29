import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import { isKnown } from "../core/types.js";
import type { SocialSnapshot } from "../core/model.js";
import type { SocialSnapshotRecord } from "../db/records.js";
import { clamp, robustZ, round } from "../core/stats.js";

/**
 * SOCIAL INTELLIGENCE → SOCIAL_MOMENTUM_SCORE.
 * Looks at *growth* of mentions/authors, engagement per mention, share of brand-new accounts
 * (fake-engagement proxy) and concentration of promotion. Follower counts alone never score.
 * Returns null (UNKNOWN) when no social source produced data.
 */
export function analyzeSocial(social: SocialSnapshot | null, history: SocialSnapshotRecord[], cfg: { spikeZ: number; saturationPerHour: number }): AnalyzerResult {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  if (!social || social.sources.length === 0 || (!isKnown(social.mentions24h) && !isKnown(social.telegramMembers) && !isKnown(social.twitterFollowers))) {
    flags.push({ code: "NO_SOCIAL_DATA", severity: "INFO", message: "no social data available (UNKNOWN)" });
    return { analyzer: "social", score: null, confidence: "UNKNOWN", flags, evidence, metrics: out, computedAt: now };
  }
  let score = 40; // neutral baseline: "exists" is not momentum
  const m1h = social.mentions1h.value;
  const m24 = social.mentions24h.value;
  const authors = social.uniqueAuthors24h.value;
  const src = social.sources.join("+");
  if (m24 !== null) {
    evidence.push({ kind: "FACT", statement: `${m24} mentions / 24h, ${m1h ?? "?"} in the last hour, ${authors ?? "?"} unique authors`, source: src, observedAt: social.observedAt });
    out.mentions_24h = m24;
    out.mentions_1h = m1h;
    // growth: last hour vs 24h hourly average
    if (m1h !== null && m24 > 0) {
      const avg = m24 / 24;
      const growth = avg > 0 ? m1h / avg : m1h > 0 ? 5 : 0;
      out.mentions_growth_ratio = round(growth, 2);
      if (growth >= 3) { score += 25; evidence.push({ kind: "INFERENCE", statement: `mentions accelerating (${growth.toFixed(1)}x hourly average)`, source: src, observedAt: social.observedAt }); }
      else if (growth >= 1.5) score += 12;
      else if (growth < 0.5 && m24 >= 10) score -= 10;
    }
    // history-based spike (own series)
    const hist = history.map((h) => h.mentions1h).filter((v): v is number => typeof v === "number");
    if (m1h !== null && hist.length >= 5) {
      const z = robustZ(m1h, hist);
      out.mentions_z = z === null ? null : round(z, 2);
      if (z !== null && z >= cfg.spikeZ) flags.push({ code: "SOCIAL_SPIKE", severity: "INFO", message: `mention rate spike (z=${z.toFixed(1)})` });
    }
    // author diversity
    if (authors !== null && m24 >= 5) {
      const div = authors / m24;
      out.author_diversity = round(div, 2);
      if (div < 0.3) { score -= 15; flags.push({ code: "SOCIAL_CONCENTRATED_PROMOTION", severity: "MEDIUM", message: `few accounts generate most mentions (${authors} authors / ${m24} posts)` }); }
      else if (div > 0.7) score += 8;
    }
    if (m1h !== null && m1h >= cfg.saturationPerHour) { score -= 10; flags.push({ code: "SOCIAL_SATURATED", severity: "LOW", message: "social activity extremely saturated" }); }
  }
  const newShare = social.newAccountShare.value;
  if (newShare !== null) {
    out.new_account_share = round(newShare, 2);
    if (newShare > 0.6) { score -= 20; flags.push({ code: "FAKE_ENGAGEMENT", severity: "MEDIUM", message: `${Math.round(newShare * 100)}% of posting accounts are < 30 days old` }); }
  }
  const eng = social.engagement24h.value;
  if (eng !== null && m24) {
    out.engagement_per_mention = round(eng / m24, 2);
    if (eng / m24 > 5) score += 8;
  }
  if (isKnown(social.telegramMembers)) {
    out.telegram_members = social.telegramMembers.value;
    const prev = history.map((h) => h.telegramMembers).filter((v): v is number => typeof v === "number").at(-1);
    if (prev && social.telegramMembers.value > prev * 1.2) { score += 8; evidence.push({ kind: "FACT", statement: `telegram members ${prev} → ${social.telegramMembers.value}`, source: "telegram", observedAt: social.observedAt }); }
    else evidence.push({ kind: "FACT", statement: `telegram members ${social.telegramMembers.value}`, source: "telegram", observedAt: social.observedAt });
  }
  if (social.sentiment.value !== null) out.sentiment = social.sentiment.value;
  if (!social.hasWebsite && !social.hasTwitter && !social.hasTelegram) { score -= 5; flags.push({ code: "NO_SOCIAL_PRESENCE", severity: "LOW", message: "no website/twitter/telegram linked" }); }
  score = clamp(round(score, 1), 0, 100);
  out.social_momentum_score = score;
  const confidence: AnalyzerResult["confidence"] = social.sources.length >= 2 && (m24 ?? 0) >= 10 ? "MEDIUM" : "LOW";
  return { analyzer: "social", score, confidence, flags, evidence, metrics: out, computedAt: now };
}
