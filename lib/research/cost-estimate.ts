import { PLACES_COST_PER_REQUEST_USD } from "@/lib/integrations/business-sources/google-places-provider";
import { DEPTH_PRESETS, type ResearchConfig } from "@/backend/research/types";

/**
 * Pre-flight cost estimate (brief §2). Nothing here calls anything: it turns
 * a configuration into the number of requests it can possibly make, so a run
 * is approved on numbers rather than on optimism.
 *
 * Every figure is an upper bound. Under-estimating would defeat the purpose.
 */

/** Requests the discovery step can issue for one query. */
const PLACES_PAGE_SIZE = 20;
const MAX_PLACES_PAGES = 5;

/** Default ceiling for one run, in USD. Configurable per call. */
export const DEFAULT_COST_LIMIT_USD = 1;

export interface ExternalCallEstimate {
  provider: string;
  operation: string;
  /** Upper bound on how many calls this run can make. */
  maxCalls: number;
  billable: boolean;
  note: string;
}

export interface CostEstimate {
  /** Phases that will actually run at this depth. */
  phases: string[];
  calls: ExternalCallEstimate[];
  placesRequests: number;
  estimatedCostUsd: number;
  limitUsd: number;
  exceedsLimit: boolean;
  /** Businesses that can enter the pipeline. Hard cap, not a target. */
  maxBusinesses: number;
  notes: string[];
}

export function estimateResearchCost(
  config: ResearchConfig,
  options: { limitUsd?: number; mobileAvailable?: boolean } = {}
): CostEstimate {
  const preset = DEPTH_PRESETS[config.depth];
  const limitUsd = options.limitUsd ?? DEFAULT_COST_LIMIT_USD;
  const businesses = config.maxBusinesses;

  // Discovery: one page per 20 results requested, capped by the provider's
  // own page ceiling. Retries can add up to 3 more per page on failure.
  const pagesNeeded = Math.min(MAX_PLACES_PAGES, Math.ceil(businesses / PLACES_PAGE_SIZE));
  const placesRequests = pagesNeeded;

  const calls: ExternalCallEstimate[] = [
    {
      provider: "Google Places",
      operation: "places:searchText",
      maxCalls: pagesNeeded,
      billable: true,
      note: `Hasta ${MAX_PLACES_PAGES} páginas por consulta; ${pagesNeeded} para ${businesses} negocios. Los reintentos por error pueden añadir hasta 3 peticiones por página.`,
    },
  ];

  if (preset.resolveWebsite) {
    calls.push({
      provider: "Web del negocio",
      operation: "GET página principal (verificación de identidad)",
      maxCalls: businesses,
      billable: false,
      note: "Una petición por negocio con web en la ficha. Timeout de 10 s.",
    });
  }

  if (preset.scanWebsite) {
    calls.push({
      provider: "Web del negocio",
      operation: "GET documento + robots.txt + sitemap.xml + hasta 8 enlaces internos",
      maxCalls: businesses * 11,
      billable: false,
      note: "Máximo 11 peticiones por negocio. Timeouts de 12 s, 6 s y 5 s.",
    });
  }

  if (preset.auditMobile) {
    calls.push({
      provider: "Chromium local",
      operation: "Render móvil (390×844)",
      maxCalls: options.mobileAvailable === false ? 0 : businesses,
      billable: false,
      note:
        options.mobileAvailable === false
          ? "No disponible en este entorno: se reportará como NO_VERIFICADO, no se estimará."
          : "Una carga de página por negocio. Timeout de 20 s.",
    });
  }

  if (preset.secondResearch) {
    calls.push({
      provider: "Web del negocio",
      operation: "Segunda comprobación (solo leads de 70+)",
      maxCalls: businesses * 11,
      billable: false,
      note: "Solo se ejecuta sobre los que superan 70 puntos; el máximo asume el peor caso.",
    });
  }

  const estimatedCostUsd = Number((placesRequests * PLACES_COST_PER_REQUEST_USD).toFixed(4));

  const notes = [
    `ESTIMACIÓN: ${PLACES_COST_PER_REQUEST_USD} $ por petición a Places, tarifa de referencia sin descontar el tramo gratuito mensual.`,
    "Solo Google Places factura. El resto de peticiones son a las webs de los negocios y no tienen coste.",
    `El pipeline no puede procesar más de ${businesses} negocios únicos aunque la búsqueda devuelva más.`,
  ];

  if (preset.secondResearch) {
    notes.push("La segunda investigación no vuelve a llamar a Google: solo revisa webs.");
  }

  return {
    phases: preset.steps,
    calls,
    placesRequests,
    estimatedCostUsd,
    limitUsd,
    exceedsLimit: estimatedCostUsd > limitUsd,
    maxBusinesses: businesses,
    notes,
  };
}
