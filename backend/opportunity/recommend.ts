import type { Settings } from "@/lib/database/types";
import type { WebAuditResult } from "@/backend/audit/types";
import type { SiteAnalysis } from "@/backend/crawl/crawl-site";
import {
  SERVICE_LABELS,
  SERVICE_TO_CATALOGUE,
  type BusinessProblem,
  type ServiceKind,
} from "./diagnose";

/**
 * Decides what to sell, in what order, and why.
 *
 * The rule that governs it: recommend the smallest intervention that fixes
 * the problems actually found. A business whose only real defect is a missing
 * phone link does not need a new website, and proposing one is how an agency
 * loses a deal it had already won.
 *
 * Prices come from the agency's configured catalogue. When a service has no
 * configured price the recommendation says so rather than inventing a number
 * — a proposal with a made-up figure is worse than one that says "a
 * presupuestar".
 */

export type Verdict =
  | "web_nueva"
  | "rediseno"
  | "mejoras_puntuales"
  | "solo_seo"
  | "sin_oportunidad_clara"
  | "evidencia_insuficiente";

export interface RecommendedService {
  kind: ServiceKind;
  label: string;
  /** Lower runs first. Ordered by what recovers money soonest. */
  priority: number;
  /** The problems this service resolves. */
  solves: string[];
  /** Evidence, carried through so the pitch can be defended. */
  evidence: string[];
  /** From the agency catalogue. Null when the service is not priced. */
  catalogueService: string | null;
  priceEur: number | null;
}

export interface Recommendation {
  verdict: Verdict;
  /** One sentence: what we would tell this owner. */
  headline: string;
  /** Why this verdict and not another. */
  rationale: string;
  services: RecommendedService[];
  /** Sum of the priced services. Null when nothing could be priced. */
  totalEur: number | null;
  /** Services recommended but not priced in the catalogue. */
  unpriced: string[];
  problems: BusinessProblem[];
  /** What we do not know, carried into the proposal. */
  limitations: string[];
  /** Confidence in the recommendation, from the share of the model measured. */
  evidenceCoverage: number;
}

interface RecommendInput {
  problems: BusinessProblem[];
  settings: Settings;
  audit: WebAuditResult | null;
  site: SiteAnalysis | null;
  limitations: string[];
  /** True when the business has no website at all (established elsewhere). */
  hasNoWebsite?: boolean;
}

function priceFor(kind: ServiceKind, settings: Settings): { name: string | null; price: number | null } {
  const candidates = SERVICE_TO_CATALOGUE[kind];

  for (const candidate of candidates) {
    const offered = settings.services.find(
      (service) => service.toLowerCase() === candidate.toLowerCase()
    );
    if (!offered) continue;

    const raw = (settings.pricing as Record<string, unknown>)[offered];
    return { name: offered, price: typeof raw === "number" ? raw : null };
  }

  return { name: null, price: null };
}

/**
 * How much of the audit model actually produced a measurement. A
 * recommendation from a third of the checks is a different claim from one
 * built on all of them, and the caller has to be able to tell.
 */
function coverage(audit: WebAuditResult | null, site: SiteAnalysis | null): number {
  if (!audit) return 0;
  if (!site) return audit.confidence;
  // A completed crawl is what makes site-level conclusions trustworthy.
  const crawlFactor = site.site.stats.stoppedBy === "completed" ? 1 : 0.6;
  return audit.confidence * crawlFactor;
}

export function recommend(input: RecommendInput): Recommendation {
  const { problems, settings, audit, site } = input;
  const evidenceCoverage = coverage(audit, site);

  // ---- No website at all: the only case where "build one" is the default.
  if (input.hasNoWebsite) {
    const { name, price } = priceFor("web_nueva", settings);
    return {
      verdict: "web_nueva",
      headline: "No tiene web propia: la oportunidad es construirla desde cero.",
      rationale:
        "Sin sitio propio, todo lo demás — SEO, conversión, contenido — no tiene dónde apoyarse. Es el único caso en el que empezar por una web nueva es lo correcto de partida.",
      services: [
        {
          kind: "web_nueva",
          label: SERVICE_LABELS.web_nueva,
          priority: 1,
          solves: ["No tiene presencia web propia."],
          evidence: ["Ausencia de web corroborada por las fuentes de descubrimiento."],
          catalogueService: name,
          priceEur: price,
        },
      ],
      totalEur: price,
      unpriced: name && price === null ? [name] : [],
      problems,
      limitations: input.limitations,
      evidenceCoverage,
    };
  }

  // ---- Nothing measured: refuse to recommend rather than guess.
  if (!audit || audit.overall === null) {
    return {
      verdict: "evidencia_insuficiente",
      headline: "No se ha podido analizar la web, así que no hay recomendación.",
      rationale:
        "Sin haber podido acceder al sitio no hay nada observado sobre lo que apoyar una propuesta. Proponer algo aquí sería inventarlo.",
      services: [],
      totalEur: null,
      unpriced: [],
      problems,
      limitations: input.limitations,
      evidenceCoverage,
    };
  }

  if (problems.length === 0) {
    return {
      verdict: "sin_oportunidad_clara",
      headline: `La web puntúa ${audit.overall}/100 y no se han detectado problemas de negocio.`,
      rationale:
        "No hay nada roto que justifique una venta. Insistir aquí quema el contacto para cuando sí haya algo que aportar.",
      services: [],
      totalEur: null,
      unpriced: [],
      problems,
      limitations: input.limitations,
      evidenceCoverage,
    };
  }

  // ---- The verdict, from the shape of the problems found ----------------
  const critical = problems.filter((problem) => problem.severity === "critical");

  // A rebuild is justified only when the site's structure itself fails — it
  // does not work on a phone — or when it is broadly bad on several fronts at
  // once. Individually fixable defects, however serious, are cheaper to fix
  // than to rebuild, and quoting a rebuild for one of them loses the deal.
  const mobileBroken = problems.some(
    (problem) => problem.area === "movil_roto" && problem.severity === "critical"
  );
  const foundationBroken = mobileBroken || (audit.overall < 40 && critical.length >= 2);

  const onlyVisibility = problems.every(
    (problem) => problem.impact === "pierde_visibilidad"
  );

  const verdict: Verdict = foundationBroken
    ? "rediseno"
    : onlyVisibility
      ? "solo_seo"
      : "mejoras_puntuales";

  // ---- Build the service list from the problems, deduplicated -----------
  const byService = new Map<ServiceKind, BusinessProblem[]>();
  for (const problem of problems) {
    byService.set(problem.addressedBy, [...(byService.get(problem.addressedBy) ?? []), problem]);
  }

  // A redesign subsumes the smaller front-end services: quoting both would
  // be charging twice for the same work.
  if (verdict === "rediseno") {
    for (const subsumed of ["rendimiento", "accesibilidad", "conversion"] as ServiceKind[]) {
      const absorbed = byService.get(subsumed);
      if (!absorbed) continue;
      byService.set("rediseno", [...(byService.get("rediseno") ?? []), ...absorbed]);
      byService.delete(subsumed);
    }
  }

  const severityRank = { critical: 0, serious: 1, moderate: 2 };
  const services: RecommendedService[] = [...byService.entries()]
    .map(([kind, solved]) => {
      const { name, price } = priceFor(kind, settings);
      const worst = Math.min(...solved.map((problem) => severityRank[problem.severity]));

      return {
        kind,
        label: SERVICE_LABELS[kind],
        // Sorting key for now; rewritten to 1..n below.
        priority: worst,
        solves: solved.map((problem) => problem.statement),
        evidence: solved.flatMap((problem) => problem.evidence).slice(0, 4),
        catalogueService: name,
        priceEur: price,
      };
    })
    .sort((a, b) => a.priority - b.priority)
    .map((service, index) => ({ ...service, priority: index + 1 }));

  const priced = services.filter((service) => service.priceEur !== null);
  const unpriced = services
    .filter((service) => service.priceEur === null)
    .map((service) => service.catalogueService ?? service.label);

  const headline =
    verdict === "rediseno"
      ? `La web tiene fallos de base (puntúa ${audit.overall}/100): arreglarla por partes sale más caro que rehacerla.`
      : verdict === "solo_seo"
        ? `La web funciona, pero no la encuentran. Puntúa ${audit.overall}/100 y todo lo detectado es visibilidad.`
        : `La web funciona pero pierde clientes por ${problems.length} problema(s) concretos. Puntúa ${audit.overall}/100.`;

  const rationale =
    verdict === "rediseno"
      ? "Los fallos afectan a la base del sitio —seguridad o comportamiento en móvil—, y eso no se parchea encima de lo que hay."
      : verdict === "solo_seo"
        ? "No hay nada que rehacer: lo que falta es que Google la encuentre y la entienda. Proponer una web nueva aquí sería vender de más."
        : "Los problemas detectados son puntuales y se arreglan sobre el sitio actual. Es la intervención más pequeña que los resuelve.";

  return {
    verdict,
    headline,
    rationale,
    services,
    totalEur: priced.length === 0 ? null : priced.reduce((sum, service) => sum + (service.priceEur ?? 0), 0),
    unpriced,
    problems,
    limitations: input.limitations,
    evidenceCoverage,
  };
}

/** Plain-text rendering, for a CLI or a proposal draft. */
export function renderRecommendation(recommendation: Recommendation): string {
  const lines: string[] = [];

  lines.push(recommendation.headline);
  lines.push("");
  lines.push(recommendation.rationale);

  if (recommendation.problems.length > 0) {
    lines.push("");
    lines.push("PROBLEMAS DETECTADOS");
    lines.push("─".repeat(74));
    for (const problem of recommendation.problems) {
      lines.push(`[${problem.severity}] ${problem.statement}`);
      lines.push(`   ${problem.consequence}`);
      for (const evidence of problem.evidence.slice(0, 2)) {
        lines.push(`   Observado: ${evidence}`);
      }
      lines.push("");
    }
  }

  if (recommendation.services.length > 0) {
    lines.push("QUÉ PROPONEMOS, POR ORDEN");
    lines.push("─".repeat(74));
    for (const service of recommendation.services) {
      const price = service.priceEur !== null ? `${service.priceEur} €` : "a presupuestar";
      lines.push(`${service.priority}. ${service.label} — ${price}`);
      for (const solved of service.solves) lines.push(`     Resuelve: ${solved}`);
    }

    lines.push("");
    lines.push(
      recommendation.totalEur !== null
        ? `Total de lo presupuestable: ${recommendation.totalEur} €`
        : "Ningún servicio recomendado tiene precio en el catálogo."
    );
    if (recommendation.unpriced.length > 0) {
      lines.push(`Sin precio configurado: ${recommendation.unpriced.join(", ")}.`);
    }
  }

  lines.push("");
  lines.push(`Cobertura de la evidencia: ${Math.round(recommendation.evidenceCoverage * 100)}%`);
  lines.push("");
  lines.push("LO QUE NO SE HA PODIDO COMPROBAR");
  lines.push("─".repeat(74));
  for (const limitation of recommendation.limitations) lines.push(`  · ${limitation}`);

  return lines.join("\n");
}
