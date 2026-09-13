import type { FetchOptions, OddsProvider, OddsQuote, OddsSnapshot } from "./types";

/**
 * Real odds via The Odds API (https://the-odds-api.com).
 *
 * Chosen because its free tier covers LaLiga and the Premier League, it lists
 * Spanish bookmakers (region `eu`), and it returns h2h and totals in one call.
 * Set ODDS_API_KEY to activate it; without the key the app falls back to the
 * demo provider and says so loudly.
 */

const BASE_URL = "https://api.the-odds-api.com/v4";

/** Shape of the slice of the API response we actually use. */
interface ApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface ApiMarket {
  key: string;
  last_update?: string;
  outcomes: ApiOutcome[];
}

interface ApiBookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets: ApiMarket[];
}

interface ApiEvent {
  id: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: ApiBookmaker[];
}

const MARKET_LABELS: Record<string, string> = {
  h2h: "Ganador del partido",
  totals: "Total de goles",
  spreads: "Hándicap",
};

function marketLabel(key: string, point?: number): string {
  const base = MARKET_LABELS[key] ?? key;
  return point === undefined ? base : `${base} ${point}`;
}

function selectionLabel(key: string, outcome: ApiOutcome): string {
  if (key !== "totals") return outcome.name;
  const side = outcome.name.toLowerCase() === "over" ? "Más de" : "Menos de";
  return `${side} ${outcome.point ?? ""}`.trim();
}

export class TheOddsApiProvider implements OddsProvider {
  readonly id = "the-odds-api";
  readonly name = "The Odds API";
  readonly provenance = "real" as const;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly region = "eu"
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  configurationHint(): string {
    return (
      "Falta ODDS_API_KEY. Crea una clave gratuita en https://the-odds-api.com, " +
      "añádela a .env.local como ODDS_API_KEY y reinicia el servidor."
    );
  }

  async fetchOdds(options: FetchOptions): Promise<OddsSnapshot> {
    const fetchedAt = new Date().toISOString();
    const base: Omit<OddsSnapshot, "quotes"> = {
      source: this.name,
      provenance: this.provenance,
      fetchedAt,
    };

    if (!this.apiKey) {
      return { ...base, quotes: [], error: this.configurationHint() };
    }

    const markets = options.markets?.length ? options.markets : ["h2h", "totals"];
    const url = new URL(`${BASE_URL}/sports/${options.sport}/odds`);
    url.searchParams.set("apiKey", this.apiKey);
    url.searchParams.set("regions", this.region);
    url.searchParams.set("markets", markets.join(","));
    url.searchParams.set("oddsFormat", "decimal");
    if (options.bookmaker) url.searchParams.set("bookmakers", options.bookmaker);

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        return {
          ...base,
          quotes: [],
          error: `The Odds API respondió ${response.status}. ${
            response.status === 401
              ? "La clave no es válida."
              : response.status === 429
                ? "Has agotado la cuota mensual."
                : "Revisa el estado del servicio."
          }`,
        };
      }
      const events = (await response.json()) as ApiEvent[];
      return { ...base, quotes: this.toQuotes(events, fetchedAt) };
    } catch (cause) {
      return {
        ...base,
        quotes: [],
        error: `No se pudo contactar con The Odds API: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      };
    }
  }

  /** Flatten the nested API shape into one row per price. */
  private toQuotes(events: ApiEvent[], fetchedAt: string): OddsQuote[] {
    const quotes: OddsQuote[] = [];

    for (const event of events) {
      for (const bookmaker of event.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          for (const outcome of market.outcomes ?? []) {
            if (!(outcome.price > 1)) continue;
            quotes.push({
              eventId: event.id,
              sport: "Fútbol",
              competition: event.sport_title,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              commenceTime: event.commence_time,
              marketKey: market.key,
              marketLabel: marketLabel(market.key, outcome.point),
              selection: selectionLabel(market.key, outcome),
              odds: outcome.price,
              bookmaker: bookmaker.title,
              // Prefer the market's own timestamp over our request time.
              fetchedAt: market.last_update ?? bookmaker.last_update ?? fetchedAt,
              provenance: "real",
            });
          }
        }
      }
    }

    return quotes;
  }
}
