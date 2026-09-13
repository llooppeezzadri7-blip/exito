import type { FetchOptions, OddsProvider, OddsQuote, OddsSnapshot } from "./types";

/**
 * Fabricated odds, used only to prove the pipeline runs end to end.
 *
 * The team names are deliberately fictional. Real fixtures were considered and
 * rejected: a demo row reading "Levante - Barcelona" would eventually be read
 * as a real tip by someone skimming the dashboard, and the whole point of this
 * module is that a made-up number must never be mistakable for a real one.
 */

const DEMO_TEAMS = [
  { home: "Demo FC", away: "Ejemplo CF" },
  { home: "Prueba Unión", away: "Muestra Deportivo" },
];

/** Fixed offsets from "now" so the dashboard always has upcoming fixtures. */
const HOURS_AHEAD = [4, 28];

interface DemoLine {
  marketKey: string;
  marketLabel: string;
  selection: string;
  odds: number;
}

const DEMO_LINES: DemoLine[] = [
  { marketKey: "over_2.5_cards", marketLabel: "Total de tarjetas", selection: "Más de 2,5", odds: 1.36 },
  { marketKey: "over_8.5_corners", marketLabel: "Total de córners", selection: "Más de 8,5", odds: 1.42 },
  { marketKey: "totals", marketLabel: "Total de goles 1.5", selection: "Más de 1,5", odds: 1.31 },
  { marketKey: "totals", marketLabel: "Total de goles 2.5", selection: "Más de 2,5", odds: 1.62 },
  { marketKey: "h2h", marketLabel: "Ganador del partido", selection: "Demo FC", odds: 1.22 },
];

export class DemoOddsProvider implements OddsProvider {
  readonly id = "demo";
  readonly name = "DEMO (datos inventados)";
  readonly provenance = "demo" as const;

  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string {
    return "El proveedor DEMO no necesita configuración: sus cuotas son inventadas.";
  }

  async fetchOdds(options: FetchOptions): Promise<OddsSnapshot> {
    const fetchedAt = new Date().toISOString();
    const quotes: OddsQuote[] = [];

    DEMO_TEAMS.forEach((teams, index) => {
      const commenceTime = new Date(Date.now() + HOURS_AHEAD[index] * 3600_000).toISOString();
      for (const line of DEMO_LINES) {
        quotes.push({
          eventId: `demo-${index}`,
          sport: "Fútbol",
          competition: `DEMO · ${options.sport}`,
          homeTeam: teams.home,
          awayTeam: teams.away,
          commenceTime,
          marketKey: line.marketKey,
          marketLabel: line.marketLabel,
          selection: line.selection,
          odds: line.odds,
          bookmaker: "DEMO",
          fetchedAt,
          provenance: "demo",
        });
      }
    });

    return { quotes, source: this.name, provenance: "demo", fetchedAt };
  }
}
