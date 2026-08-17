import { DEPTH_PRESETS, type ResearchConfig } from "@/backend/research/types";

/**
 * Pre-flight cost estimate (brief §2). Nothing here calls anything: it turns
 * a configuration into the number of requests it can possibly make, so a run
 * is approved on numbers rather than on optimism.
 *
 * Every figure is an upper bound. Under-estimating would defeat the purpose.
 */

/** Discovery is now free: one Overpass query plus, for tourism, one register
 * query. Kept as constants so the estimate stays honest if that changes. */
const OVERPASS_REQUESTS_PER_QUERY = 1;
const TOURISM_REGISTER_REQUESTS = 1;
const DISCOVERY_COST_PER_REQUEST_USD = 0;

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
  discoveryRequests: number;
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

  // Discovery is one Overpass query, plus one register query for tourism.
  const usesRegister = config.sector === "Turismo";
  const discoveryRequests =
    OVERPASS_REQUESTS_PER_QUERY + (usesRegister ? TOURISM_REGISTER_REQUESTS : 0);

  const calls: ExternalCallEstimate[] = [
    {
      provider: "OpenStreetMap (Overpass)",
      operation: "overpass:interpreter",
      maxCalls: OVERPASS_REQUESTS_PER_QUERY,
      billable: false,
      note: "Datos abiertos, sin clave ni facturación. Hasta 2 reintentos si el servidor está saturado.",
    },
  ];

  if (usesRegister) {
    calls.push({
      provider: "Registre de Turisme de Catalunya",
      operation: "socrata:establiments",
      maxCalls: TOURISM_REGISTER_REQUESTS,
      billable: false,
      note: "Registro oficial en datos abiertos, sin clave.",
    });
  }

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

  const estimatedCostUsd = Number(
    (discoveryRequests * DISCOVERY_COST_PER_REQUEST_USD).toFixed(4)
  );

  const notes = [
    "Ninguna fuente de descubrimiento factura: OpenStreetMap y el registro de turismo son datos abiertos sin clave.",
    "El resto de peticiones son a las webs de los propios negocios y tampoco tienen coste.",
    `El pipeline no puede procesar más de ${businesses} negocios únicos aunque las fuentes devuelvan más.`,
    "Un negocio hallado por una sola fuente queda PROBABLE; hacen falta dos fuentes independientes para VERIFICADO.",
  ];

  return {
    phases: preset.steps,
    calls,
    discoveryRequests,
    estimatedCostUsd,
    limitUsd,
    exceedsLimit: estimatedCostUsd > limitUsd,
    maxBusinesses: businesses,
    notes,
  };
}
