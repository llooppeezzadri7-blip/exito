import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Provenance } from "./providers/types";
import type { ConfidenceLevel, ProbabilitySource, Recommendation } from "./recommendations";

/**
 * Persistent record of what the system recommended, at what price, and how it
 * ended up.
 *
 * Stored as a JSON file so it is readable and editable without a database —
 * the path is printed in the UI so there is never any doubt about where the
 * bets live. Demo entries are kept but excluded from every P&L figure: a
 * fabricated win must never inflate a real balance.
 */

export const HISTORY_PATH = join(process.cwd(), "data", "apuestas-historial.json");

export type BetResult = "pendiente" | "ganada" | "perdida" | "nula";

export const RESULT_LABEL: Record<BetResult, string> = {
  pendiente: "Pendiente",
  ganada: "Ganada",
  perdida: "Perdida",
  nula: "Anulada",
};

export interface HistoryEntry {
  id: string;
  event: string;
  sport: string;
  competition: string;
  commenceTime: string;
  market: string;
  selection: string;
  /** The price at the moment it was recommended, not the current one. */
  odds: number;
  estimatedProbability: number;
  impliedProbability: number;
  edge: number;
  stakeEur: number;
  confidence: ConfidenceLevel;
  oddsProvenance: Provenance;
  probabilitySource: ProbabilitySource;
  overallProvenance: Provenance;
  bookmaker: string;
  source: string;
  fetchedAt: string;
  recommendedAt: string;
  result: BetResult;
  /** Realised profit in euros. 0 while pending or void. */
  profitEur: number;
  settledAt?: string;
}

interface HistoryFile {
  version: 1;
  entries: HistoryEntry[];
}

export async function loadHistory(path = HISTORY_PATH): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as HistoryFile;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (cause) {
    // A missing file is the normal first-run state, not an error.
    if (isNotFound(cause)) return [];
    throw cause;
  }
}

async function writeHistory(entries: HistoryEntry[], path = HISTORY_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file: HistoryFile = { version: 1, entries };
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "ENOENT";
}

/** Stable id so re-running the generator does not duplicate a bet. */
function entryId(recommendation: Recommendation): string {
  return `${recommendation.id}::${recommendation.commenceTime}`;
}

export function toEntry(recommendation: Recommendation): HistoryEntry {
  return {
    id: entryId(recommendation),
    event: recommendation.event,
    sport: recommendation.sport,
    competition: recommendation.competition,
    commenceTime: recommendation.commenceTime,
    market: recommendation.market,
    selection: recommendation.selection,
    odds: recommendation.odds,
    estimatedProbability: recommendation.estimatedProbability,
    impliedProbability: recommendation.impliedProbability,
    edge: recommendation.edge,
    stakeEur: recommendation.stakeEur,
    confidence: recommendation.confidence,
    oddsProvenance: recommendation.oddsProvenance,
    probabilitySource: recommendation.probabilitySource,
    overallProvenance: recommendation.overallProvenance,
    bookmaker: recommendation.bookmaker,
    source: recommendation.source,
    fetchedAt: recommendation.fetchedAt,
    recommendedAt: recommendation.generatedAt,
    result: "pendiente",
    profitEur: 0,
  };
}

/**
 * Add recommendations to the log, skipping ones already recorded.
 * Returns how many were actually new.
 */
export async function recordRecommendations(
  recommendations: Recommendation[],
  path = HISTORY_PATH
): Promise<{ added: number; skipped: number; entries: HistoryEntry[] }> {
  const existing = await loadHistory(path);
  const known = new Set(existing.map((entry) => entry.id));

  const fresh = recommendations.map(toEntry).filter((entry) => !known.has(entry.id));
  const entries = [...existing, ...fresh];
  await writeHistory(entries, path);

  return { added: fresh.length, skipped: recommendations.length - fresh.length, entries };
}

/** Profit for a settled bet. A void bet returns the stake, so profit is 0. */
export function profitFor(entry: HistoryEntry, result: BetResult): number {
  switch (result) {
    case "ganada":
      return entry.stakeEur * (entry.odds - 1);
    case "perdida":
      return -entry.stakeEur;
    case "nula":
    case "pendiente":
      return 0;
  }
}

export async function settleBet(
  id: string,
  result: BetResult,
  path = HISTORY_PATH
): Promise<HistoryEntry | null> {
  const entries = await loadHistory(path);
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return null;

  entry.result = result;
  entry.profitEur = profitFor(entry, result);
  entry.settledAt = result === "pendiente" ? undefined : new Date().toISOString();

  await writeHistory(entries, path);
  return entry;
}

export interface HistorySummary {
  /** Every entry, demo included. */
  total: number;
  pending: number;
  /** Settled, non-demo bets — the only ones that count towards P&L. */
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number;
  stakedEur: number;
  profitEur: number;
  roi: number;
  averageOdds: number;
  /** Entries excluded from the figures because they are demo. */
  demoExcluded: number;
}

/**
 * P&L over real bets only.
 *
 * Demo entries are counted separately and never folded into profit, ROI or hit
 * rate — otherwise a test run would quietly become part of the track record.
 */
export function summarizeHistory(entries: HistoryEntry[]): HistorySummary {
  const real = entries.filter((entry) => entry.overallProvenance !== "demo");
  const settled = real.filter((entry) => entry.result === "ganada" || entry.result === "perdida");

  const wins = settled.filter((entry) => entry.result === "ganada").length;
  const stakedEur = settled.reduce((sum, entry) => sum + entry.stakeEur, 0);
  const profitEur = settled.reduce((sum, entry) => sum + entry.profitEur, 0);
  const averageOdds =
    settled.length > 0 ? settled.reduce((sum, entry) => sum + entry.odds, 0) / settled.length : 0;

  return {
    total: entries.length,
    pending: real.filter((entry) => entry.result === "pendiente").length,
    settled: settled.length,
    wins,
    losses: settled.length - wins,
    voids: real.filter((entry) => entry.result === "nula").length,
    hitRate: settled.length > 0 ? wins / settled.length : 0,
    stakedEur,
    profitEur,
    roi: stakedEur > 0 ? profitEur / stakedEur : 0,
    averageOdds,
    demoExcluded: entries.length - real.length,
  };
}
