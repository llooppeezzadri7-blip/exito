import { COSTA_BRAVA_MUNICIPALITIES, COSTA_BRAVA_SECTORS } from "@/lib/research/costa-brava";
import { estimateResearchCost } from "@/lib/research/cost-estimate";
import { sourcePerformance, strategyPerformance, MIN_SAMPLE_FOR_ACTION } from "@/lib/memory/learning";
import { errorPatterns } from "@/lib/memory/error-memory";
import { recordEvent } from "@/lib/memory/research-memory";
import { assessSeasonality } from "@/lib/research/seasonality";
import type {
  PlanJustification,
  PlannedTarget,
  ResearchGoal,
  ResearchPlan,
  StopCriteria,
  DeepeningCriteria,
} from "./types";

/**
 * FASE 4.1 — the planner.
 *
 * Turns a goal into an ordered plan, and justifies every choice. The rule
 * that governs the justifications: a reason is either backed by observations
 * with the sample size stated, or it openly says there is no history yet.
 * "Selecciono Blanes porque históricamente rinde bien" without the numbers
 * behind it is exactly the kind of confident-sounding invention this system
 * exists to avoid.
 */

const DEFAULT_STOP: StopCriteria = {
  maxRounds: 2,
  maxRequestsPerBusiness: 25,
  maxDurationMs: 20 * 60 * 1000,
  sufficientConfidence: 0.8,
  maxLeads: 50,
};

const DEFAULT_DEEPENING: DeepeningCriteria = {
  deepenAboveScore: 60,
  reResearchBelowConfidence: 0.8,
  discardBelowScore: 25,
};

function justify(
  decision: string,
  basis: PlanJustification["basis"],
  reason: string,
  sampleSize = 0
): PlanJustification {
  return { decision, basis, reason, sampleSize };
}

/**
 * Orders municipalities. Uses history only when the sample is big enough;
 * otherwise it says so and falls back to the requested scope in its
 * configured order.
 */
function planMunicipalities(goal: ResearchGoal): { name: string; justification: PlanJustification }[] {
  const inScope = goal.municipalities?.length
    ? COSTA_BRAVA_MUNICIPALITIES.filter((m) => goal.municipalities!.includes(m.name))
    : COSTA_BRAVA_MUNICIPALITIES;

  const history = strategyPerformance().filter((s) => s.sampleSufficient);
  const ranked = new Map(history.map((h) => [h.municipality, h]));

  return [...inScope]
    .sort((a, b) => (ranked.get(b.name)?.yieldPerQuery ?? -1) - (ranked.get(a.name)?.yieldPerQuery ?? -1))
    .map((municipality) => {
      const stats = ranked.get(municipality.name);
      if (stats) {
        return {
          name: municipality.name,
          justification: justify(
            `Investigar ${municipality.name}`,
            "historical_evidence",
            `Ha producido ${stats.yieldPerQuery.toFixed(1)} negocios aprovechables por consulta en ${stats.queries} consultas anteriores.`,
            stats.queries
          ),
        };
      }

      return {
        name: municipality.name,
        justification: justify(
          `Investigar ${municipality.name}`,
          "no_history_yet",
          `Forma parte del ámbito solicitado (${municipality.comarca}). Todavía no hay evidencia histórica suficiente para priorizarlo por rendimiento.`,
          0
        ),
      };
    });
}

/** Picks subsectors, preferring those the discovery sources actually cover. */
function planSubsectors(goal: ResearchGoal): { sector: string; subsector: string; justification: PlanJustification }[] {
  const sectors = goal.sectors?.length
    ? COSTA_BRAVA_SECTORS.filter((s) => goal.sectors!.includes(s.name))
    : COSTA_BRAVA_SECTORS;

  const covered = new Set([
    "Restaurantes",
    "Bares y cafeterías",
    "Hoteles",
    "Campings",
    "Apartamentos turísticos",
    "Peluquerías y barberías",
    "Talleres",
    "Clínicas dentales",
    "Gimnasios",
    "Inmobiliarias",
    "Moda",
    "Joyerías",
  ]);

  const planned: { sector: string; subsector: string; justification: PlanJustification }[] = [];

  for (const sector of sectors) {
    for (const subsector of sector.subsectors) {
      if (!covered.has(subsector.name)) continue;
      planned.push({
        sector: sector.name,
        subsector: subsector.name,
        justification: justify(
          `Incluir ${subsector.name}`,
          "domain_rule",
          "Tiene una categoría equivalente en OpenStreetMap, así que el descubrimiento puede encontrarlo sin adivinar etiquetas.",
          0
        ),
      });
    }
  }

  return planned;
}

function planSources(): { source: string; justification: PlanJustification }[] {
  const performance = sourcePerformance();

  const overpass = performance.find((p) => p.source === "openstreetmap");
  const registre = performance.find((p) => p.source === "turisme_cat");

  return [
    {
      source: "openstreetmap",
      justification: overpass?.sampleSufficient
        ? justify(
            "Usar OpenStreetMap",
            "historical_evidence",
            `${overpass.yieldPerQuery.toFixed(1)} negocios aprovechables por consulta en ${overpass.queries} consultas, ${Math.round(overpass.reliability * 100)}% de fiabilidad.`,
            overpass.queries
          )
        : justify(
            "Usar OpenStreetMap",
            "no_history_yet",
            "Es la fuente abierta con mayor cobertura de negocios locales y no requiere clave. Aún no hay historial suficiente para valorar su rendimiento real.",
            overpass?.queries ?? 0
          ),
    },
    {
      source: "turisme_cat",
      justification: registre?.sampleSufficient
        ? justify(
            "Usar el Registre de Turisme",
            "historical_evidence",
            `${registre.yieldPerQuery.toFixed(1)} negocios aprovechables por consulta en ${registre.queries} consultas.`,
            registre.queries
          )
        : justify(
            "Usar el Registre de Turisme",
            "domain_rule",
            "Registro oficial de alojamientos: aporta la segunda fuente independiente que permite pasar de PROBABLE a VERIFICADO en el sector turismo.",
            registre?.queries ?? 0
          ),
    },
  ];
}

export interface BuildPlanOptions {
  now?: Date;
  stop?: Partial<StopCriteria>;
  deepening?: Partial<DeepeningCriteria>;
}

export function buildPlan(goal: ResearchGoal, options: BuildPlanOptions = {}): ResearchPlan {
  const now = options.now ?? new Date();
  const decisions: PlanJustification[] = [];

  const municipalities = planMunicipalities(goal);
  const subsectors = planSubsectors(goal);
  const sources = planSources();

  decisions.push(
    justify(
      "Ámbito",
      "explicit_request",
      `Zona solicitada: ${goal.zone}. Objetivo: "${goal.statement}".`,
      0
    )
  );

  // Errors the system has made before are surfaced in the plan, so the
  // operator sees which known risks this run is exposed to.
  for (const pattern of errorPatterns().filter((p) => p.open > 0)) {
    decisions.push(
      justify(
        `Riesgo conocido: ${pattern.category}`,
        "historical_evidence",
        `${pattern.open} caso(s) sin cerrar. Lección: ${pattern.lesson}`,
        pattern.count
      )
    );
  }

  const targets: PlannedTarget[] = [];
  let priority = 0;
  // Businesses are spread across targets so one municipality cannot consume
  // the entire quota before the others are touched.
  const combinations = municipalities.length * Math.max(1, subsectors.length);
  const perTarget = Math.max(1, Math.ceil(goal.maxLeads / Math.max(1, combinations)));

  for (const municipality of municipalities) {
    for (const subsector of subsectors) {
      const season = assessSeasonality({
        sector: subsector.subsector,
        locality: municipality.name,
        date: now,
      });

      priority += 1;
      targets.push({
        municipality: municipality.name,
        sector: subsector.sector,
        subsector: subsector.subsector,
        priority,
        maxBusinesses: perTarget,
        justification: justify(
          `${subsector.subsector} en ${municipality.name}`,
          municipality.justification.basis,
          `${municipality.justification.reason} ${season.reason}`,
          municipality.justification.sampleSize
        ),
      });
    }
  }

  // Seasonality reorders within the same evidence basis: a sector in its
  // run-up is a better use of the same effort than one at peak.
  targets.sort((a, b) => {
    const seasonA = assessSeasonality({ sector: a.subsector, locality: a.municipality, date: now });
    const seasonB = assessSeasonality({ sector: b.subsector, locality: b.municipality, date: now });
    return seasonB.urgencyPoints - seasonA.urgencyPoints;
  });
  targets.forEach((target, index) => {
    target.priority = index + 1;
  });

  const stop: StopCriteria = { ...DEFAULT_STOP, ...options.stop, maxLeads: goal.maxLeads };
  const deepening: DeepeningCriteria = { ...DEFAULT_DEEPENING, ...options.deepening };

  decisions.push(
    justify(
      "Criterios de parada",
      "domain_rule",
      `Máximo ${stop.maxRounds} rondas por negocio, ${stop.maxRequestsPerBusiness} peticiones por negocio, ${Math.round(stop.maxDurationMs / 60000)} minutos de límite total, y se considera suficiente al alcanzar ${Math.round(stop.sufficientConfidence * 100)}% de evidencia.`,
      0
    ),
    justify(
      "Criterios de profundización",
      "domain_rule",
      `Se profundiza por encima de ${deepening.deepenAboveScore} puntos, se reinvestiga por debajo de ${Math.round(deepening.reResearchBelowConfidence * 100)}% de confianza y se descarta por debajo de ${deepening.discardBelowScore} puntos.`,
      0
    )
  );

  const estimate = estimateResearchCost(
    {
      municipality: targets[0]?.municipality ?? goal.zone,
      sector: targets[0]?.sector,
      subsector: targets[0]?.subsector,
      maxBusinesses: goal.maxLeads,
      depth: goal.maxDepth,
    },
    {}
  );

  const plan: ResearchPlan = {
    goal,
    targets,
    sources,
    depth: goal.maxDepth,
    stop,
    deepening,
    estimatedRequests: estimate.discoveryRequests * Math.max(1, targets.length),
    estimatedCostUsd: estimate.estimatedCostUsd * Math.max(1, targets.length),
    decisions: [...decisions, ...sources.map((s) => s.justification)],
    createdAt: now.toISOString(),
  };

  recordEvent({
    type: "DECISION_MADE",
    runId: null,
    businessId: null,
    businessName: null,
    municipality: null,
    sector: null,
    source: null,
    summary: `Plan creado: ${plan.targets.length} objetivos, hasta ${goal.maxLeads} leads, profundidad ${goal.maxDepth}.`,
    data: {
      targets: plan.targets.length,
      estimatedCostUsd: plan.estimatedCostUsd,
      historicalEvidenceUsed: plan.decisions.some((d) => d.basis === "historical_evidence"),
    },
    at: plan.createdAt,
  });

  return plan;
}

/** True when the plan rests on real history rather than defaults. */
export function planUsesHistory(plan: ResearchPlan): boolean {
  return plan.decisions.some((d) => d.basis === "historical_evidence" && d.sampleSize >= MIN_SAMPLE_FOR_ACTION);
}
