import type { AnalyzerResult, Evidence, Flag } from "../core/types.js";
import type { NarrativeRecord } from "../db/records.js";
import { clamp, round } from "../core/stats.js";

/** Keyword taxonomy for emerging narratives. Extend in code or via NARRATIVE_EXTRA_KEYWORDS (json). */
export const NARRATIVES: { key: string; label: string; keywords: string[] }[] = [
  { key: "ai", label: "AI / agents", keywords: ["ai", "agent", "gpt", "llm", "neural", "robot", "openai", "grok", "claude", "deepseek"] },
  { key: "animals", label: "Animals", keywords: ["dog", "doge", "shiba", "inu", "cat", "kitty", "frog", "pepe", "monkey", "ape", "bird", "duck", "penguin", "bear", "bull", "hippo", "capybara", "moo", "cow", "goat", "wolf", "fox", "rat", "hamster", "seal", "otter"] },
  { key: "politics", label: "Politics", keywords: ["trump", "maga", "biden", "kamala", "elon", "musk", "doge", "president", "vote", "election", "milei", "putin", "xi"] },
  { key: "internet-culture", label: "Internet culture / memes", keywords: ["meme", "wojak", "chad", "gigachad", "npc", "sigma", "based", "rizz", "skibidi", "brainrot", "sus", "amogus", "cope", "seethe", "wagmi", "gm"] },
  { key: "gaming", label: "Gaming", keywords: ["game", "gaming", "play", "pixel", "minecraft", "fortnite", "roblox", "sonic", "mario", "pokemon", "pokémon"] },
  { key: "celebrity", label: "Celebrities", keywords: ["taylor", "swift", "kanye", "ye", "drake", "beyonce", "messi", "ronaldo", "kardashian", "mrbeast", "andrew tate", "tate"] },
  { key: "events", label: "Current events", keywords: ["olympic", "worldcup", "world cup", "superbowl", "halloween", "christmas", "xmas", "newyear", "eclipse", "fed", "rate cut"] },
  { key: "finance-meme", label: "Finance memes", keywords: ["pump", "moon", "rocket", "lambo", "diamond", "hands", "ape", "degen", "gamble", "casino", "bonk", "wif", "hat"] },
  { key: "tiktok", label: "TikTok trends", keywords: ["tiktok", "viral", "trend", "dance", "challenge", "chill guy", "moodeng", "mood"] },
  { key: "tech", label: "Tech / crypto-native", keywords: ["quantum", "depin", "rwa", "layer", "zk", "solana", "sol", "eth", "btc", "bitcoin", "satoshi", "vitalik", "toly"] },
];

export function classifyNarrative(text: string): { key: string; label: string; matched: string[] }[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9$ ]+/g, " ")} `;
  const out: { key: string; label: string; matched: string[] }[] = [];
  for (const n of NARRATIVES) {
    const matched = n.keywords.filter((k) => t.includes(` ${k} `) || t.includes(` ${k}`) || t.includes(`$${k} `));
    if (matched.length) out.push({ key: n.key, label: n.label, matched });
  }
  return out;
}

/**
 * NARRATIVE ENGINE → NARRATIVE_MOMENTUM / FRESHNESS / SATURATION for the narratives a token belongs to.
 * `records` are the engine's own aggregated narrative stats (tokens seen per narrative, momentum, etc.).
 */
export function analyzeNarrative(token: { symbol: string | null; name: string | null; description?: string | null; keywords?: string[] }, records: NarrativeRecord[]): AnalyzerResult & { saturation: number | null; narratives: string[] } {
  const now = new Date().toISOString();
  const flags: Flag[] = [];
  const evidence: Evidence[] = [];
  const out: Record<string, number | null> = {};
  const text = [token.symbol, token.name, token.description, ...(token.keywords ?? [])].filter(Boolean).join(" ");
  const matches = classifyNarrative(text);
  if (!matches.length) {
    return { analyzer: "narrative", score: null, confidence: "UNKNOWN", flags: [{ code: "NO_NARRATIVE", severity: "INFO", message: "no recognizable narrative" }], evidence, metrics: out, computedAt: now, saturation: null, narratives: [] };
  }
  const byKey = new Map(records.map((r) => [r.key, r]));
  let momentum = 50;
  let freshness = 50;
  let saturation = 0;
  for (const m of matches) {
    const rec = byKey.get(m.key);
    if (!rec) continue;
    if (rec.momentum !== null) momentum = Math.max(momentum, rec.momentum);
    if (rec.freshness !== null) freshness = Math.min(freshness === 50 ? 100 : freshness, rec.freshness);
    if (rec.saturation !== null) saturation = Math.max(saturation, rec.saturation);
    evidence.push({ kind: "INFERENCE", statement: `narrative "${rec.label}": ${rec.tokensCount} tokens / 24h, momentum ${rec.momentum ?? "?"}, saturation ${rec.saturation === null ? "?" : Math.round(rec.saturation * 100) + "%"}`, source: "narrative-engine", observedAt: rec.updatedAt, data: { matched: m.matched } });
  }
  if (saturation > 0.6) flags.push({ code: "NARRATIVE_SATURATED", severity: "MEDIUM", message: `narrative "${matches[0]!.label}" is saturated (${Math.round(saturation * 100)}%) — late entrants underperform` });
  const score = clamp(round(momentum * 0.6 + freshness * 0.4 - saturation * 30, 1), 0, 100);
  out.narrative_momentum = round(momentum, 1);
  out.narrative_freshness = round(freshness, 1);
  out.narrative_saturation = round(saturation, 2);
  out.narrative_count = matches.length;
  return { analyzer: "narrative", score, confidence: records.length ? "LOW" : "LOW", flags, evidence, metrics: out, computedAt: now, saturation, narratives: matches.map((m) => m.key) };
}

/**
 * Recompute narrative aggregates from the tokens the engine discovered (called periodically).
 * momentum: tokens in the last 24h vs the previous 24h; freshness: decays with narrative age; saturation: share of all tokens.
 */
export function aggregateNarratives(tokens: { symbol: string | null; name: string | null; discoveredAt: string }[], previous: NarrativeRecord[], now = new Date()): NarrativeRecord[] {
  const prev = new Map(previous.map((p) => [p.key, p]));
  const dayAgo = now.getTime() - 86_400_000;
  const twoDaysAgo = dayAgo - 86_400_000;
  const counts = new Map<string, { last: number; prev: number }>();
  let total24 = 0;
  for (const t of tokens) {
    const ts = new Date(t.discoveredAt).getTime();
    if (ts < twoDaysAgo) continue;
    const isLast = ts >= dayAgo;
    if (isLast) total24++;
    for (const m of classifyNarrative([t.symbol, t.name].filter(Boolean).join(" "))) {
      const c = counts.get(m.key) ?? { last: 0, prev: 0 };
      if (isLast) c.last++;
      else c.prev++;
      counts.set(m.key, c);
    }
  }
  const out: NarrativeRecord[] = [];
  for (const n of NARRATIVES) {
    const c = counts.get(n.key) ?? { last: 0, prev: 0 };
    const p = prev.get(n.key);
    const firstSeenAt = p?.firstSeenAt ?? (c.last + c.prev > 0 ? now.toISOString() : null);
    if (!firstSeenAt) continue;
    const ageDays = (now.getTime() - new Date(firstSeenAt).getTime()) / 86_400_000;
    const growth = c.prev > 0 ? c.last / c.prev : c.last > 0 ? 2 : 1;
    out.push({
      key: n.key,
      label: n.label,
      keywords: n.keywords,
      tokensCount: c.last,
      mentions24h: p?.mentions24h ?? 0,
      momentum: clamp(round(50 + (growth - 1) * 25, 1), 0, 100),
      freshness: clamp(round(100 / (1 + ageDays / 7), 1), 0, 100),
      saturation: total24 > 0 ? clamp(round(c.last / Math.max(10, total24) * 3, 3), 0, 1) : 0,
      firstSeenAt,
      updatedAt: now.toISOString(),
    });
  }
  return out;
}
