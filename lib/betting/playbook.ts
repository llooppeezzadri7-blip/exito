import type { BacktestOptions, BacktestResult } from "./backtest";
import { runBacktest } from "./backtest";
import {
  all,
  DIVISIONS,
  hasHeavyFavourite,
  inDivision,
  involves,
  isHome,
  noHeavyFavourite,
  OVER_1_5_GOALS,
  OVER_2_5_CARDS,
  OVER_2_5_GOALS,
  OVER_3_5_CARDS,
  OVER_7_5_CORNERS,
  OVER_8_5_CORNERS,
  OVER_9_5_CORNERS,
  type MatchFilter,
} from "./markets";
import type { Market, MatchRow } from "./types";

/**
 * The playbook: the strategies this system claims can hit ~80% at a price of
 * 1.28 or better.
 *
 * Every entry here is a HYPOTHESIS, not a result. `rationale` says why it
 * should work; the backtest says whether it does. Anything that fails to clear
 * break-even on its lower confidence bound gets dropped, not rationalised.
 *
 * Corner and card strategies carry `assumedOdds` because football-data.co.uk
 * publishes no prices for them. Replace those with prices you actually see on
 * Sportium before trusting any ROI figure.
 */

export interface Strategy {
  key: string;
  label: string;
  /** Why this should hold, in plain Spanish. */
  rationale: string;
  market: Market;
  filter?: MatchFilter;
  /** Stand-in price when the dataset has none. Check it against Sportium. */
  assumedOdds?: number;
  /** Set null to measure the raw base rate regardless of price. */
  band?: BacktestOptions["band"];
}

/** Barcelona as football-data spells it. */
export const BARCELONA = "Barcelona";

export const PLAYBOOK: Strategy[] = [
  {
    key: "laliga_cards_over_2.5",
    label: "LaLiga · Más de 2,5 tarjetas",
    rationale:
      "LaLiga se arbitra con mucha más tarjeta que la Premier. Es el mercado con mejor base rate del sistema y Sportium lo suele pagar entre 1,25 y 1,40.",
    market: OVER_2_5_CARDS,
    filter: inDivision(DIVISIONS.laLiga),
    assumedOdds: 1.35,
    band: null,
  },
  {
    key: "laliga_cards_over_2.5_even",
    label: "LaLiga · Más de 2,5 tarjetas (sin favorito claro)",
    rationale:
      "Un partido igualado se compite hasta el final: más faltas tácticas y más tarjetas que en una goleada decidida al descanso.",
    market: OVER_2_5_CARDS,
    filter: all(inDivision(DIVISIONS.laLiga), noHeavyFavourite()),
    assumedOdds: 1.3,
    band: null,
  },
  {
    key: "laliga_cards_over_3.5",
    label: "LaLiga · Más de 3,5 tarjetas",
    rationale:
      "Línea más alta: menos acierto pero cuota más alta. Sirve para comprobar dónde está el punto óptimo de la banda 1,28-1,45.",
    market: OVER_3_5_CARDS,
    filter: inDivision(DIVISIONS.laLiga),
    assumedOdds: 1.6,
    band: null,
  },
  {
    key: "premier_cards_over_2.5",
    label: "Premier · Más de 2,5 tarjetas (control)",
    rationale:
      "Control deliberado: si LaLiga no sale claramente por encima de la Premier, la premisa del sistema de tarjetas es falsa.",
    market: OVER_2_5_CARDS,
    filter: inDivision(DIVISIONS.premierLeague),
    assumedOdds: 1.45,
    band: null,
  },
  {
    key: "corners_over_7.5_favourite",
    label: "Córners · Más de 7,5 con favorito claro",
    rationale:
      "El favorito encierra al rival y el volumen de córners se dispara. Mercado secundario, menos modelado por la casa.",
    market: OVER_7_5_CORNERS,
    filter: hasHeavyFavourite(),
    assumedOdds: 1.3,
    band: null,
  },
  {
    key: "corners_over_8.5_favourite",
    label: "Córners · Más de 8,5 con favorito claro",
    rationale: "La misma idea una línea más arriba, para localizar el mejor punto acierto/cuota.",
    market: OVER_8_5_CORNERS,
    filter: hasHeavyFavourite(),
    assumedOdds: 1.45,
    band: null,
  },
  {
    key: "corners_over_9.5_favourite",
    label: "Córners · Más de 9,5 con favorito claro",
    rationale: "Línea alta de control: debería caer por debajo del 80% y marcar el techo del sistema.",
    market: OVER_9_5_CORNERS,
    filter: hasHeavyFavourite(),
    assumedOdds: 1.7,
    band: null,
  },
  {
    key: "barca_home_corners_over_8.5",
    label: "Barça en casa · Más de 8,5 córners",
    rationale:
      "El Barça de Flick juega con línea muy alta y dominio territorial permanente en el Camp Nou: genera volumen de córner de forma estructural, no por racha.",
    market: OVER_8_5_CORNERS,
    filter: isHome(BARCELONA),
    assumedOdds: 1.4,
    band: null,
  },
  {
    key: "barca_over_2.5_goals",
    label: "Barça · Más de 2,5 goles",
    rationale:
      "Línea defensiva adelantada y ataque de volumen: los partidos del Barça tienden a marcador abierto. Aquí SÍ hay cuota real en el dataset.",
    market: OVER_2_5_GOALS,
    filter: involves(BARCELONA),
    band: null,
  },
  {
    key: "over_1.5_goals_in_band",
    label: "Más de 1,5 goles · solo dentro de la banda",
    rationale:
      "El único mercado del sistema con cuota histórica real. Filtrado a 1,28-1,45 mide si la banda deja ROI positivo de verdad.",
    market: OVER_1_5_GOALS,
    filter: inDivision(DIVISIONS.laLiga, DIVISIONS.premierLeague),
  },
];

export interface StrategyReport extends BacktestResult {
  strategy: Strategy;
}

export function runStrategy(matches: MatchRow[], strategy: Strategy): StrategyReport {
  const result = runBacktest(matches, {
    market: strategy.market,
    filter: strategy.filter,
    assumedOdds: strategy.assumedOdds,
    ...(strategy.band !== undefined ? { band: strategy.band } : {}),
  });
  return { ...result, strategy };
}

export function runPlaybook(matches: MatchRow[], strategies: Strategy[] = PLAYBOOK): StrategyReport[] {
  return strategies.map((strategy) => runStrategy(matches, strategy));
}

/**
 * Strategies that survive: enough sample, and a lower confidence bound that
 * still clears break-even at the price used. Everything else is a hypothesis
 * that did not pan out.
 */
export function survivors(reports: StrategyReport[]): StrategyReport[] {
  return reports.filter((r) => r.sampleIsSufficient && r.edgeIsSignificant);
}

export function findStrategy(key: string): Strategy | undefined {
  return PLAYBOOK.find((s) => s.key === key);
}
