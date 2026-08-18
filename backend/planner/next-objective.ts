import { COSTA_BRAVA_MUNICIPALITIES, COSTA_BRAVA_SECTORS } from "@/lib/research/costa-brava";
import { assessSeasonality } from "@/lib/research/seasonality";
import { strategyPerformance, MIN_SAMPLE_FOR_ACTION } from "@/lib/memory/learning";
import { learnedMunicipalityOrder } from "@/lib/memory/predictive";
import { queryEvents } from "@/lib/memory/research-memory";
import { REVISIT_AFTER_DAYS } from "./triage";
import type { ResearchGoal } from "./types";

/**
 * FASE 5.5 — deciding what to investigate next, with nobody watching.
 *
 * Four ways an objective can be chosen, in strict order of precedence:
 *
 *   1. REVISIT     — something already researched is stale enough to re-check.
 *   2. EXPLOITATION— real sales say a municipality closes better than the rest.
 *   3. EXPLORATION — nothing has been tried there yet, so go and find out.
 *   4. EXPLICIT    — the operator asked for something specific.
 *
 * The ordering matters. Exploitation before exploration would let one early
 * lucky municipality monopolise every cycle and the system would never learn
 * that anywhere else exists; exploration before revisiting would let its
 * existing knowledge rot while it chases new ground. And exploitation is
 * gated on *sales*, not on its own scores — a municipality that produces
 * plenty of high-scoring leads that never buy is not a good municipality.
 */

export type SelectionMode = "revisit" | "exploitation" | "exploration" | "explicit";

export interface ObjectiveChoice {
  goal: ResearchGoal;
  mode: SelectionMode;
  /** Why this one, in the operator's terms. Never blank. */
  reason: string;
  /** Observations behind the choice. Zero means the reason must say so. */
  sampleSize: number;
  /** Municipalities in the objective, in the order they will be swept. */
  municipalities: string[];
  sectors: string[];
}

export interface CycleBudget {
  municipalitiesPerCycle: number;
  maxLeads: number;
  maxDurationMs: number;
}

/**
 * The budget approved for unattended cycles: three municipalities, forty
 * leads, forty-five minutes. A cycle cannot exceed this without a human
 * changing it.
 */
export const DEFAULT_CYCLE_BUDGET: CycleBudget = {
  municipalitiesPerCycle: 3,
  maxLeads: 40,
  maxDurationMs: 45 * 60 * 1000,
};

export interface CoverageEntry {
  municipality: string;
  /** Distinct sweeps recorded for it. */
  queries: number;
  lastResearchedAt: string | null;
  businessesFound: number;
}

/**
 * What has actually been swept, read from the log rather than from a counter
 * someone has to remember to increment.
 */
export function coverage(): CoverageEntry[] {
  const events = queryEvents({ type: "SOURCE_QUERIED" });
  const byMunicipality = new Map<string, CoverageEntry>();

  for (const municipality of COSTA_BRAVA_MUNICIPALITIES) {
    byMunicipality.set(municipality.name, {
      municipality: municipality.name,
      queries: 0,
      lastResearchedAt: null,
      businessesFound: 0,
    });
  }

  for (const event of events) {
    if (!event.municipality) continue;
    const entry = byMunicipality.get(event.municipality) ?? {
      municipality: event.municipality,
      queries: 0,
      lastResearchedAt: null,
      businessesFound: 0,
    };

    entry.queries += 1;
    entry.businessesFound += Number((event.data as { usable?: number }).usable ?? 0);
    if (!entry.lastResearchedAt || event.at > entry.lastResearchedAt) {
      entry.lastResearchedAt = event.at;
    }
    byMunicipality.set(event.municipality, entry);
  }

  return [...byMunicipality.values()];
}

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/** Municipalities swept long enough ago that their data may have moved on. */
export function staleMunicipalities(now: Date): CoverageEntry[] {
  return coverage()
    .filter((entry) => entry.lastResearchedAt !== null)
    .filter((entry) => daysSince(entry.lastResearchedAt!, now) >= REVISIT_AFTER_DAYS)
    .sort((a, b) => (a.lastResearchedAt ?? "").localeCompare(b.lastResearchedAt ?? ""));
}

/** Municipalities nothing has ever been recorded for. */
export function unexploredMunicipalities(): CoverageEntry[] {
  return coverage().filter((entry) => entry.queries === 0);
}

export interface ChooseObjectiveOptions {
  now?: Date;
  budget?: CycleBudget;
  /** An operator-supplied objective always wins. */
  explicit?: Partial<ResearchGoal>;
  /** Sectors to consider; defaults to every configured sector. */
  sectors?: string[];
}

/**
 * Picks the sector whose season makes it the best use of this cycle. Ties are
 * broken by the configured order, not at random, so two identical cycles
 * choose identically and the decision stays explainable.
 */
function bestSectorFor(municipality: string, sectors: string[], now: Date): { sector: string; reason: string } {
  const ranked = sectors
    .map((sector) => {
      const subsectors = COSTA_BRAVA_SECTORS.find((s) => s.name === sector)?.subsectors ?? [];
      const assessments = subsectors.map((subsector) =>
        assessSeasonality({ sector: subsector.name, locality: municipality, date: now })
      );
      const urgency = assessments.length
        ? Math.max(...assessments.map((a) => a.urgencyPoints))
        : assessSeasonality({ sector, locality: municipality, date: now }).urgencyPoints;
      const best = assessments.find((a) => a.urgencyPoints === urgency);
      return { sector, urgency, reason: best?.reason ?? "" };
    })
    .sort((a, b) => b.urgency - a.urgency);

  return { sector: ranked[0].sector, reason: ranked[0].reason };
}

export function chooseNextObjective(options: ChooseObjectiveOptions = {}): ObjectiveChoice {
  const now = options.now ?? new Date();
  const budget = options.budget ?? DEFAULT_CYCLE_BUDGET;
  const sectors = options.sectors?.length ? options.sectors : COSTA_BRAVA_SECTORS.map((s) => s.name);

  const goalBase = {
    zone: "Costa Brava",
    maxLeads: budget.maxLeads,
    maxDepth: "profunda" as const,
  };

  // 1. Explicit request.
  if (options.explicit?.municipalities?.length || options.explicit?.statement) {
    const municipalities = options.explicit.municipalities ?? [];
    return {
      goal: {
        ...goalBase,
        statement: options.explicit.statement ?? "Objetivo indicado manualmente.",
        ...options.explicit,
      } as ResearchGoal,
      mode: "explicit",
      reason: "Objetivo indicado explícitamente: no lo ha elegido el sistema.",
      sampleSize: 0,
      municipalities,
      sectors: options.explicit.sectors ?? sectors,
    };
  }

  // 2. Revisit what has gone stale.
  const stale = staleMunicipalities(now).slice(0, budget.municipalitiesPerCycle);
  if (stale.length > 0) {
    const names = stale.map((entry) => entry.municipality);
    const oldest = stale[0];
    const { sector } = bestSectorFor(names[0], sectors, now);

    return {
      goal: {
        ...goalBase,
        statement: `Revisar ${names.join(", ")}: la información recogida ha envejecido.`,
        municipalities: names,
        sectors: [sector],
      },
      mode: "revisit",
      reason: `${oldest.municipality} se investigó hace ${Math.round(daysSince(oldest.lastResearchedAt!, now))} días, por encima del umbral de ${REVISIT_AFTER_DAYS}. Los negocios cambian de web, de teléfono y de reseñas.`,
      sampleSize: oldest.queries,
      municipalities: names,
      sectors: [sector],
    };
  }

  // 3. Exploit what real sales say — never what the system's own scores say.
  const learned = learnedMunicipalityOrder();
  if (learned) {
    const names = learned.order.slice(0, budget.municipalitiesPerCycle);
    const { sector, reason: seasonReason } = bestSectorFor(names[0], sectors, now);

    return {
      goal: {
        ...goalBase,
        statement: `Profundizar en ${names.join(", ")}: son los municipios donde más se ha cerrado.`,
        municipalities: names,
        sectors: [sector],
      },
      mode: "exploitation",
      reason: `Elegidos por resultados reales de venta sobre ${learned.sampleSize} desenlaces registrados. ${seasonReason}`,
      sampleSize: learned.sampleSize,
      municipalities: names,
      sectors: [sector],
    };
  }

  // 4. Explore. Untouched municipalities first; then the least-swept ones.
  const unexplored = unexploredMunicipalities();
  const candidates = (
    unexplored.length > 0
      ? unexplored
      : [...coverage()].sort((a, b) => a.queries - b.queries)
  ).slice(0, budget.municipalitiesPerCycle);

  const names = candidates.map((entry) => entry.municipality);
  const { sector, reason: seasonReason } = bestSectorFor(names[0], sectors, now);

  // Yield statistics are shown when they exist, but they are not what drove
  // the choice here, and the reason says which is which.
  const strategy = strategyPerformance().filter((s) => s.sampleSufficient);

  return {
    goal: {
      ...goalBase,
      statement: `Explorar ${names.join(", ")}: todavía no hay resultados de venta que permitan priorizar por rendimiento.`,
      municipalities: names,
      sectors: [sector],
    },
    mode: "exploration",
    reason:
      unexplored.length > 0
        ? `Ninguno de estos municipios se ha investigado nunca. No hay evidencia histórica de venta suficiente (hacen falta ${MIN_SAMPLE_FOR_ACTION} desenlaces) para priorizar por rendimiento, así que se amplía la cobertura. ${seasonReason}`
        : `Son los municipios menos barridos (${candidates.map((c) => `${c.municipality}: ${c.queries}`).join(", ")}). Todavía no hay desenlaces de venta suficientes para priorizar por rendimiento${strategy.length ? ", aunque sí hay datos de rendimiento de descubrimiento" : ""}. ${seasonReason}`,
    sampleSize: 0,
    municipalities: names,
    sectors: [sector],
  };
}
