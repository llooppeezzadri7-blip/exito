import { COSTA_BRAVA_MUNICIPALITIES } from "./costa-brava";

/**
 * Seasonality model (brief §22). Configurable by sector *and* locality,
 * evaluated against whatever date is passed in — there is no "today" baked
 * into the rules, so the same code gives the right answer in February and in
 * August.
 *
 * The commercial logic it encodes: a seasonal business is unreachable during
 * its peak (it is drowning in customers) and receptive in the run-up, when
 * next season's results are still winnable.
 */

export type SeasonPhase = "PEAK" | "RUN_UP" | "OFF_SEASON" | "YEAR_ROUND";

export interface SeasonalityRule {
  /** Sector name, or "*" to apply to every sector in the locality. */
  sector: string;
  /** Locality name, or "*" for the whole coast. */
  locality: string;
  /** Months (1-12) when the business is at capacity. */
  peakMonths: number[];
  /** Months when it is preparing and most receptive to buying. */
  runUpMonths: number[];
}

/**
 * Default rules for the Costa Brava. Tourism peaks in July-August, and the
 * commercial run-up is the winter/spring before it. Non-tourism sectors are
 * intentionally absent: their absence means "year round", not "unknown".
 */
export const DEFAULT_SEASONALITY_RULES: SeasonalityRule[] = [
  { sector: "Turismo", locality: "*", peakMonths: [7, 8], runUpMonths: [1, 2, 3, 4] },
  { sector: "Hostelería", locality: "*", peakMonths: [7, 8], runUpMonths: [1, 2, 3, 4] },
  { sector: "Hoteles", locality: "*", peakMonths: [6, 7, 8], runUpMonths: [11, 12, 1, 2, 3] },
  { sector: "Restaurantes", locality: "*", peakMonths: [7, 8], runUpMonths: [1, 2, 3, 4] },
  { sector: "Campings", locality: "*", peakMonths: [7, 8], runUpMonths: [12, 1, 2, 3] },
  { sector: "Apartamentos turísticos", locality: "*", peakMonths: [7, 8], runUpMonths: [12, 1, 2, 3] },
  { sector: "Chiringuitos", locality: "*", peakMonths: [6, 7, 8, 9], runUpMonths: [2, 3, 4] },
  { sector: "Beach clubs", locality: "*", peakMonths: [6, 7, 8, 9], runUpMonths: [2, 3, 4] },
  { sector: "Discotecas", locality: "*", peakMonths: [6, 7, 8], runUpMonths: [2, 3, 4] },
  { sector: "Alquiler de barcos", locality: "*", peakMonths: [6, 7, 8], runUpMonths: [1, 2, 3, 4] },
  // Cadaqués and Begur run a shorter, sharper season than the mass-tourism
  // towns; their run-up starts later.
  { sector: "*", locality: "Cadaqués", peakMonths: [7, 8], runUpMonths: [3, 4, 5] },
  { sector: "*", locality: "Begur", peakMonths: [7, 8], runUpMonths: [3, 4, 5] },
  // Gyms invert the tourist calendar: January resolutions and the pre-summer
  // rush are when they buy.
  { sector: "Gimnasios", locality: "*", peakMonths: [1, 9], runUpMonths: [10, 11, 4, 5] },
];

export interface SeasonalityAssessment {
  phase: SeasonPhase;
  month: number;
  /** 0-10, feeding the urgency factor of the commercial score. */
  urgencyPoints: number;
  reason: string;
  /** Which rule produced this, so the answer is traceable rather than magic. */
  matchedRule: string | null;
}

/**
 * Locality is weighted above sector on purpose. A rule naming a town ("the
 * season in Cadaqués is shorter and starts later") is a deliberate local
 * override, and it has to beat the coast-wide sector default — otherwise any
 * sector that already has a generic rule could never be corrected locally,
 * and the locality rules would be dead configuration.
 */
function ruleSpecificity(rule: SeasonalityRule): number {
  return (rule.locality === "*" ? 0 : 2) + (rule.sector === "*" ? 0 : 1);
}

export interface SeasonalityQuery {
  sector: string | null;
  locality?: string | null;
  date: Date;
  rules?: SeasonalityRule[];
}

export function assessSeasonality(query: SeasonalityQuery): SeasonalityAssessment {
  const month = query.date.getMonth() + 1;
  const rules = query.rules ?? DEFAULT_SEASONALITY_RULES;

  if (!query.sector) {
    return {
      phase: "YEAR_ROUND",
      month,
      urgencyPoints: 0,
      reason: "Sin sector asignado no se puede valorar el momento de compra.",
      matchedRule: null,
    };
  }

  const applicable = rules
    .filter(
      (rule) =>
        (rule.sector === "*" || rule.sector === query.sector) &&
        (rule.locality === "*" || rule.locality === query.locality)
    )
    // Most specific rule wins: a locality-and-sector rule beats a blanket one.
    .sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a));

  const rule = applicable[0];

  if (!rule) {
    return {
      phase: "YEAR_ROUND",
      month,
      urgencyPoints: 5,
      reason: `${query.sector} no es un sector estacional en esta zona: se puede abordar todo el año.`,
      matchedRule: null,
    };
  }

  const label = `${rule.sector} / ${rule.locality}`;

  if (rule.peakMonths.includes(month)) {
    return {
      phase: "PEAK",
      month,
      urgencyPoints: 2,
      reason: `Temporada alta (mes ${month}) para ${query.sector}: está saturado y es mal momento para vender.`,
      matchedRule: label,
    };
  }

  if (rule.runUpMonths.includes(month)) {
    return {
      phase: "RUN_UP",
      month,
      urgencyPoints: 10,
      reason: `Antesala de temporada (mes ${month}) para ${query.sector}: es cuando se decide y se prepara la campaña.`,
      matchedRule: label,
    };
  }

  return {
    phase: "OFF_SEASON",
    month,
    urgencyPoints: 6,
    reason: `Fuera de temporada (mes ${month}) para ${query.sector}: hay tiempo para escuchar, pero la urgencia es menor que en la antesala.`,
    matchedRule: label,
  };
}

/** True when the town's economy is summer-tourism dominated. */
export function isSeasonalLocality(locality: string | null | undefined): boolean {
  if (!locality) return false;
  return COSTA_BRAVA_MUNICIPALITIES.find((m) => m.name === locality)?.seasonal ?? false;
}
