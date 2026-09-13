import Papa from "papaparse";
import type { MatchRow } from "./types";

/**
 * Parser for football-data.co.uk season CSVs.
 *
 * Those files are the only free source that carries results, corners, cards
 * AND historical closing odds in one place, which is what makes an honest
 * backtest possible. Grab e.g. https://www.football-data.co.uk/mmz4281/2425/SP1.csv
 * (SP1 = LaLiga, E0 = Premier League) and feed the raw text in here.
 *
 * Column reference: https://www.football-data.co.uk/notes.txt
 */

/** Every column that is not an odds column, so the rest can be swept up as odds. */
const NON_ODDS_COLUMNS = new Set([
  "Div", "Date", "Time", "HomeTeam", "AwayTeam", "Referee",
  "FTHG", "FTAG", "FTR", "HTHG", "HTAG", "HTR",
  "HS", "AS", "HST", "AST", "HF", "AF", "HC", "AC", "HY", "AY", "HR", "AR",
  "Attendance", "HHW", "AHW", "HO", "AO", "HBP", "ABP", "Season", "Country", "League",
]);

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function pair(raw: Record<string, unknown>, homeKey: string, awayKey: string) {
  const home = toNumber(raw[homeKey]);
  const away = toNumber(raw[awayKey]);
  return home === null || away === null ? null : { home, away };
}

/**
 * football-data writes dates as dd/mm/yy or dd/mm/yyyy. Two-digit years are
 * read as 20xx, which is safe for every season the site publishes.
 */
export function parseFootballDataDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, yearPart] = match;
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  return `${year}-${month}-${day}`;
}

function collectOdds(raw: Record<string, unknown>): Record<string, number> {
  const odds: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (NON_ODDS_COLUMNS.has(key) || key === "") continue;
    const n = toNumber(value);
    if (n !== null) odds[key] = n;
  }
  return odds;
}

/** Normalise one already-parsed CSV record. Returns null for unusable rows. */
export function toMatchRow(raw: Record<string, unknown>): MatchRow | null {
  const division = String(raw.Div ?? "").trim();
  const homeTeam = String(raw.HomeTeam ?? "").trim();
  const awayTeam = String(raw.AwayTeam ?? "").trim();
  const date = parseFootballDataDate(String(raw.Date ?? ""));

  // A row without teams or a date is a footer/blank line, not a match.
  if (!division || !homeTeam || !awayTeam || !date) return null;

  return {
    division,
    date,
    homeTeam,
    awayTeam,
    goals: pair(raw, "FTHG", "FTAG"),
    corners: pair(raw, "HC", "AC"),
    yellows: pair(raw, "HY", "AY"),
    reds: pair(raw, "HR", "AR"),
    shotsOnTarget: pair(raw, "HST", "AST"),
    fouls: pair(raw, "HF", "AF"),
    odds: collectOdds(raw),
  };
}

export interface ParseResult {
  matches: MatchRow[];
  /** Rows dropped because they had no teams or no parseable date. */
  skipped: number;
}

/** Parse the raw text of a football-data.co.uk CSV. */
export function parseFootballDataCsv(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const matches: MatchRow[] = [];
  let skipped = 0;

  for (const raw of parsed.data) {
    const row = toMatchRow(raw);
    if (row) matches.push(row);
    else skipped += 1;
  }

  matches.sort((a, b) => a.date.localeCompare(b.date));
  return { matches, skipped };
}

/** Parse and merge several season files into one chronological dataset. */
export function parseSeasons(files: string[]): ParseResult {
  const matches: MatchRow[] = [];
  let skipped = 0;

  for (const csv of files) {
    const result = parseFootballDataCsv(csv);
    matches.push(...result.matches);
    skipped += result.skipped;
  }

  matches.sort((a, b) => a.date.localeCompare(b.date));
  return { matches, skipped };
}
