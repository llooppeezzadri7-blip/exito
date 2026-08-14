import type { Business, Settings, WebsiteScan } from "@/lib/database/types";

/**
 * Commercial opportunity model — the 7-factor score from the agency brief
 * (§16/§17), with the evidence + verification discipline from §6/§7/§21.
 *
 * The rule that shapes the whole module: a missing signal is never scored as
 * if it were a zero-value finding. "No tenemos web registrada" and "hemos
 * comprobado que no tiene web" are different facts, and conflating them is
 * exactly how a prospect list ends up with claims nobody can defend in front
 * of the owner. Unverifiable factors score 0 points AND reduce `confidence`,
 * and a lead can never be top-priority on unverified data (see classify()).
 */

export type VerificationStatus = "VERIFICADO" | "PROBABLE" | "NO_VERIFICADO";

export type CommercialFactorKey =
  | "necesidad"
  | "impacto_economico"
  | "capacidad_pago"
  | "facilidad_contacto"
  | "competencia"
  | "urgencia"
  | "ajuste_servicios";

export interface CommercialFactor {
  key: CommercialFactorKey;
  label: string;
  /** Maximum points this factor can contribute (brief §16). */
  max: number;
  points: number;
  status: VerificationStatus;
  /** What we actually observed, in terms defensible in front of the owner (§21). */
  evidence: string[];
  /** What we would need to check to raise `status` to VERIFICADO. */
  missing?: string;
}

export type CommercialTier =
  | "EXCEPCIONAL"
  | "MUY_ALTA"
  | "ALTA"
  | "MEDIA"
  | "NO_PRIORITARIO"
  | "INVESTIGAR_MAS";

export interface CommercialScoreResult {
  score: number;
  /** Share of the 100 points we could actually assess with evidence (0-1). */
  confidence: number;
  tier: CommercialTier;
  factors: CommercialFactor[];
  /** The single service to lead with (§15: never sell the same thing to everyone). */
  recommendedService: string | null;
  recommendationReason: string | null;
}

export interface CommercialScoreInput {
  business: Business;
  scan: WebsiteScan | null;
  settings: Settings;
  /** Same-sector, same-city businesses already in the database, for §19. */
  peers?: { review_count: number | null; rating: number | null }[];
  /** Injected for testability; defaults to now. */
  now?: Date;
}

const FACTOR_MAX: Record<CommercialFactorKey, number> = {
  necesidad: 25,
  impacto_economico: 20,
  capacidad_pago: 15,
  facilidad_contacto: 10,
  competencia: 10,
  urgencia: 10,
  ajuste_servicios: 10,
};

const FACTOR_LABELS: Record<CommercialFactorKey, string> = {
  necesidad: "Necesidad",
  impacto_economico: "Impacto económico",
  capacidad_pago: "Capacidad de pago",
  facilidad_contacto: "Facilidad de contacto",
  competencia: "Competencia",
  urgencia: "Urgencia",
  ajuste_servicios: "Ajuste con nuestros servicios",
};

/** Sectors whose customer lifetime value justifies a higher project budget. */
const HIGH_TICKET_SECTORS = ["Clínicas dentales", "Hoteles", "Inmobiliarias", "Clínicas estéticas"];

/** Costa Brava seasonality (§36): months when the sector is too busy to buy. */
const PEAK_MONTHS_BY_SECTOR: Record<string, number[]> = {
  Hoteles: [6, 7, 8],
  Restaurantes: [6, 7, 8],
  Campings: [6, 7, 8],
  "Apartamentos turísticos": [6, 7, 8],
};

function factor(
  key: CommercialFactorKey,
  points: number,
  status: VerificationStatus,
  evidence: string[],
  missing?: string
): CommercialFactor {
  return {
    key,
    label: FACTOR_LABELS[key],
    max: FACTOR_MAX[key],
    points: Math.max(0, Math.min(FACTOR_MAX[key], Math.round(points))),
    status,
    evidence,
    missing,
  };
}

/**
 * Whether a null `website_url` is evidence of "has no website" or merely
 * "we never collected it". Google Places returns the website field on every
 * place, so a null there is a real absence. A CSV column that was left blank
 * is not — the business may well have a site nobody typed in.
 */
function websiteAbsenceIsEvidence(business: Business): boolean {
  return business.source === "google_places";
}

function scoreNecesidad(business: Business, scan: WebsiteScan | null): CommercialFactor {
  if (!business.website_url) {
    return websiteAbsenceIsEvidence(business)
      ? factor("necesidad", 25, "VERIFICADO", [
          "Google Places no devuelve web para esta ficha: el negocio no tiene sitio propio.",
        ])
      : factor(
          "necesidad",
          0,
          "NO_VERIFICADO",
          ["No consta web en nuestros datos, pero el origen (importación manual/CSV) no prueba que no exista."],
          "Buscar el negocio en Google y Maps antes de afirmar que no tiene web."
        );
  }

  if (!scan) {
    return factor(
      "necesidad",
      0,
      "NO_VERIFICADO",
      ["Tiene web registrada, pero todavía no se ha analizado."],
      "Ejecutar el análisis de la web para medir HTTPS, SEO, móvil y conversión."
    );
  }

  const problems: string[] = [];
  let points = 0;

  if (scan.technical.https !== true) {
    points += 8;
    problems.push("La web no usa HTTPS: el navegador la marca como no segura.");
  }
  if (scan.technical.has_viewport_meta !== true) {
    points += 6;
    problems.push("Sin viewport móvil: la web no está adaptada al teléfono.");
  }
  if (!scan.seo.title || !scan.seo.meta_description) {
    points += 5;
    problems.push("Falta title o meta description: Google no sabe cómo presentarla.");
  }
  if (
    scan.conversion.has_phone_link !== true &&
    scan.conversion.has_whatsapp_link !== true &&
    scan.conversion.has_contact_form !== true
  ) {
    points += 6;
    problems.push("Sin vía de contacto directa: ni teléfono pulsable, ni WhatsApp, ni formulario.");
  }

  return problems.length > 0
    ? factor("necesidad", points, "VERIFICADO", problems)
    : factor("necesidad", 0, "VERIFICADO", [
        "La web analizada no presenta carencias técnicas básicas. No hay necesidad demostrable por esta vía.",
      ]);
}

function scoreImpacto(business: Business, settings: Settings): CommercialFactor {
  const sector = business.sector;
  const reviews = business.review_count;

  if (!sector && reviews === null) {
    return factor(
      "impacto_economico",
      0,
      "NO_VERIFICADO",
      ["Sin sector ni volumen de reseñas no se puede estimar el impacto."],
      "Completar sector y número de reseñas (Google Places los devuelve)."
    );
  }

  const evidence: string[] = [];
  let points = 0;

  if (sector && HIGH_TICKET_SECTORS.includes(sector)) {
    points += 12;
    evidence.push(`Sector de ticket alto (${sector}): un solo cliente amortiza el proyecto.`);
  } else if (sector) {
    points += 6;
    evidence.push(`Sector de ticket medio (${sector}).`);
  }

  if (reviews !== null && reviews >= 100) {
    points += 8;
    evidence.push(`${reviews} reseñas: volumen de clientes alto, la mejora se multiplica.`);
  } else if (reviews !== null && reviews >= 30) {
    points += 5;
    evidence.push(`${reviews} reseñas: volumen de clientes medio.`);
  } else if (reviews !== null) {
    evidence.push(`Solo ${reviews} reseñas: volumen bajo, el impacto sería limitado.`);
  }

  // Anchoring the estimate in the agency's own price list, never in an
  // invented turnover figure (§23: no inventar facturación).
  const webPrice = settings.pricing["Diseño y desarrollo web"];
  if (typeof webPrice === "number") {
    evidence.push(`ESTIMACIÓN — referencia de precio propio: ${webPrice} € el proyecto web.`);
  }

  const status: VerificationStatus = sector && reviews !== null ? "VERIFICADO" : "PROBABLE";
  return factor(
    "impacto_economico",
    points,
    status,
    evidence,
    status === "PROBABLE" ? "Falta sector o número de reseñas para confirmarlo." : undefined
  );
}

function scoreCapacidadPago(business: Business): CommercialFactor {
  const { rating, review_count: reviews } = business;

  if (rating === null || reviews === null) {
    return factor(
      "capacidad_pago",
      0,
      "NO_VERIFICADO",
      ["Sin valoración ni número de reseñas no hay indicio de solidez del negocio."],
      "Obtener rating y review_count de la ficha de Google."
    );
  }

  const evidence: string[] = [];
  let points = 0;

  if (reviews >= 100) {
    points += 9;
    evidence.push(`${reviews} reseñas: negocio consolidado y con recorrido.`);
  } else if (reviews >= 30) {
    points += 6;
    evidence.push(`${reviews} reseñas: negocio en marcha.`);
  } else {
    evidence.push(`${reviews} reseñas: trayectoria corta o poca actividad.`);
  }

  if (rating >= 4.5) {
    points += 6;
    evidence.push(`Valoración ${rating}: reputación excelente, suele acompañar a un negocio sano.`);
  } else if (rating >= 4) {
    points += 4;
    evidence.push(`Valoración ${rating}: reputación buena.`);
  } else {
    evidence.push(`Valoración ${rating}: reputación mejorable, puede indicar problemas de fondo.`);
  }

  return factor("capacidad_pago", points, "VERIFICADO", evidence);
}

function scoreFacilidadContacto(business: Business): CommercialFactor {
  const hasPhone = Boolean(business.phone);
  const hasEmail = Boolean(business.email);
  const evidence: string[] = [];
  let points = 0;

  if (hasPhone) {
    points += 6;
    evidence.push(`Teléfono directo disponible: ${business.phone}.`);
  }
  if (hasEmail) {
    points += 4;
    evidence.push(`Email disponible: ${business.email}.`);
  }
  if (!hasPhone && !hasEmail) {
    evidence.push("Sin teléfono ni email en nuestros datos: no hay forma de iniciar el contacto.");
  }

  // Contactability is a fact about our own database, so it is always
  // verifiable — unlike claims about the business's website.
  return factor("facilidad_contacto", points, "VERIFICADO", evidence);
}

function scoreCompetencia(
  business: Business,
  peers: CommercialScoreInput["peers"]
): CommercialFactor {
  const comparable = (peers ?? []).filter((p) => p.review_count !== null);

  if (comparable.length < 3 || business.review_count === null) {
    return factor(
      "competencia",
      0,
      "NO_VERIFICADO",
      ["No hay suficientes competidores del mismo sector y ciudad en la base para comparar."],
      "Importar al menos 3 competidores del mismo sector y ciudad, o activar el análisis competitivo."
    );
  }

  const reviews = comparable.map((p) => p.review_count!);
  const median = [...reviews].sort((a, b) => a - b)[Math.floor(reviews.length / 2)];
  const own = business.review_count;

  if (own < median) {
    const gap = median - own;
    return factor(
      "competencia",
      Math.min(10, 4 + Math.round((gap / Math.max(median, 1)) * 6)),
      "VERIFICADO",
      [
        `${own} reseñas frente a una mediana de ${median} entre ${comparable.length} competidores del mismo sector y ciudad.`,
        "En Google Maps, quien busca el servicio ve primero al que acumula más reseñas.",
      ]
    );
  }

  return factor("competencia", 0, "VERIFICADO", [
    `${own} reseñas, por encima de la mediana (${median}) de sus competidores: no hay brecha que vender por esta vía.`,
  ]);
}

function scoreUrgencia(business: Business, now: Date): CommercialFactor {
  const sector = business.sector;
  if (!sector) {
    return factor(
      "urgencia",
      0,
      "NO_VERIFICADO",
      ["Sin sector no se puede valorar el momento de compra."],
      "Asignar sector al negocio."
    );
  }

  const month = now.getMonth() + 1;
  const peak = PEAK_MONTHS_BY_SECTOR[sector];

  if (!peak) {
    return factor("urgencia", 5, "PROBABLE", [
      `${sector} no es un sector marcadamente estacional en la Costa Brava: se puede abordar todo el año.`,
    ]);
  }

  if (peak.includes(month)) {
    return factor(
      "urgencia",
      2,
      "PROBABLE",
      [
        `Temporada alta (mes ${month}) para ${sector}: está saturado y es mal momento para vender.`,
        "Mejor momento: los meses previos a la temporada, para llegar preparado.",
      ]
    );
  }

  return factor("urgencia", 9, "PROBABLE", [
    `Fuera de temporada alta (mes ${month}) para ${sector}: tiene tiempo para escuchar y margen para preparar la próxima campaña.`,
  ]);
}

function scoreAjuste(
  business: Business,
  scan: WebsiteScan | null,
  settings: Settings
): { factor: CommercialFactor; service: string | null; reason: string | null } {
  const services = settings.services;

  const pick = (needle: string) => services.find((s) => s.toLowerCase().includes(needle));

  // §15: the recommendation follows the dominant problem, never a default.
  if (!business.website_url && websiteAbsenceIsEvidence(business)) {
    const service = pick("web") ?? null;
    return {
      factor: factor("ajuste_servicios", 10, "VERIFICADO", [
        "No tiene web y nuestro servicio principal es construirla: encaje directo.",
      ]),
      service,
      reason: "El negocio no tiene sitio propio: lo primero es dárselo.",
    };
  }

  if (!scan) {
    return {
      factor: factor(
        "ajuste_servicios",
        0,
        "NO_VERIFICADO",
        ["Sin analizar la web no se puede saber qué servicio le encaja."],
        "Ejecutar el análisis de la web."
      ),
      service: null,
      reason: null,
    };
  }

  if (
    scan.conversion.has_phone_link !== true &&
    scan.conversion.has_whatsapp_link !== true &&
    scan.conversion.has_contact_form !== true
  ) {
    const service = pick("conversión") ?? pick("conversion") ?? null;
    return {
      factor: factor("ajuste_servicios", 9, "VERIFICADO", [
        "Recibe visitas pero no hay forma clara de contactar: problema de conversión, no de tráfico.",
      ]),
      service,
      reason: "La web no convierte la visita en contacto: falta teléfono pulsable, WhatsApp o formulario.",
    };
  }

  if (!scan.seo.title || !scan.seo.meta_description) {
    const service = pick("seo local") ?? pick("seo") ?? null;
    return {
      factor: factor("ajuste_servicios", 8, "VERIFICADO", [
        "SEO on-page incompleto: encaja con el servicio de posicionamiento.",
      ]),
      service,
      reason: "Sin title ni meta description, Google no tiene con qué posicionarla.",
    };
  }

  if (scan.technical.https !== true || scan.technical.has_viewport_meta !== true) {
    const service = pick("web") ?? null;
    return {
      factor: factor("ajuste_servicios", 8, "VERIFICADO", [
        "Carencias técnicas de base (HTTPS o adaptación móvil): encaja con rehacer la web.",
      ]),
      service,
      reason: "La web tiene fallos técnicos de base que no se arreglan por partes.",
    };
  }

  return {
    factor: factor("ajuste_servicios", 2, "VERIFICADO", [
      "La web cubre lo básico: el encaje con nuestros servicios actuales es bajo.",
    ]),
    service: null,
    reason: null,
  };
}

function classify(score: number, confidence: number): CommercialTier {
  // §18/§43: a lead cannot be top-priority on data we could not verify. Below
  // two thirds of the model assessed, the honest answer is "investigar más",
  // never "contactar hoy".
  if (confidence < 0.66) return "INVESTIGAR_MAS";
  if (score >= 90) return "EXCEPCIONAL";
  if (score >= 80) return "MUY_ALTA";
  if (score >= 70) return "ALTA";
  if (score >= 60) return "MEDIA";
  return "NO_PRIORITARIO";
}

export function computeCommercialScore(input: CommercialScoreInput): CommercialScoreResult {
  const { business, scan, settings, peers, now = new Date() } = input;

  const ajuste = scoreAjuste(business, scan, settings);

  const factors: CommercialFactor[] = [
    scoreNecesidad(business, scan),
    scoreImpacto(business, settings),
    scoreCapacidadPago(business),
    scoreFacilidadContacto(business),
    scoreCompetencia(business, peers),
    scoreUrgencia(business, now),
    ajuste.factor,
  ];

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const assessed = factors
    .filter((f) => f.status !== "NO_VERIFICADO")
    .reduce((sum, f) => sum + f.max, 0);
  const confidence = assessed / 100;

  return {
    score,
    confidence,
    tier: classify(score, confidence),
    factors,
    recommendedService: ajuste.service,
    recommendationReason: ajuste.reason,
  };
}

export const TIER_LABELS: Record<CommercialTier, string> = {
  EXCEPCIONAL: "Oportunidad excepcional — contactar hoy",
  MUY_ALTA: "Oportunidad muy alta — prioridad máxima",
  ALTA: "Oportunidad alta — contactar",
  MEDIA: "Oportunidad media",
  NO_PRIORITARIO: "No prioritario",
  INVESTIGAR_MAS: "Investigar más — evidencia insuficiente",
};
