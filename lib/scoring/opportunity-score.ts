import type { ScoringInput, OpportunityBreakdown, OpportunityResult, SubScore } from "./types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

interface ProblemCheck {
  triggered: boolean;
  points: number;
  reason: string;
}

function scoreFromProblems(checks: ProblemCheck[]): { value: number; reasons: string[] } {
  const triggeredChecks = checks.filter((c) => c.triggered);
  const value = clamp(triggeredChecks.reduce((sum, c) => sum + c.points, 0));
  return { value, reasons: triggeredChecks.map((c) => c.reason) };
}

function noWebsiteScore(): SubScore {
  return { value: 100, reasons: ["No se ha detectado ninguna web"], limitedSignal: false };
}

function unscannedScore(): SubScore {
  return { value: 50, reasons: ["Web sin analizar todavía"], limitedSignal: true };
}

function websiteQualityScore({ business, scan }: ScoringInput): SubScore {
  if (!business.website_url) return noWebsiteScore();
  if (!scan) return unscannedScore();

  const t = scan.technical;
  const imageCount = Number(t.image_count ?? 0);
  const missingAltRatio = imageCount > 0 ? Number(t.images_missing_alt ?? 0) / imageCount : 0;

  const { value, reasons } = scoreFromProblems([
    { triggered: t.https !== true, points: 30, reason: "La web no usa HTTPS" },
    { triggered: t.schema_markup_present !== true, points: 15, reason: "Sin datos estructurados (schema.org)" },
    { triggered: t.robots_txt_present !== true, points: 10, reason: "Sin robots.txt" },
    { triggered: t.sitemap_present !== true, points: 10, reason: "Sin sitemap.xml" },
    { triggered: t.canonical_present !== true, points: 10, reason: "Sin URL canónica" },
    { triggered: missingAltRatio > 0.3, points: 15, reason: "Muchas imágenes sin texto alternativo" },
    { triggered: Number(t.html_size_bytes ?? 0) > 3_000_000, points: 10, reason: "Página muy pesada (>3MB)" },
  ]);

  return { value, reasons, limitedSignal: false };
}

function seoScore({ business, scan }: ScoringInput): SubScore {
  if (!business.website_url) return noWebsiteScore();
  if (!scan) return unscannedScore();

  const s = scan.seo;
  const title = s.title as string | null;
  const metaDescription = s.meta_description as string | null;
  const titleLen = Number(s.title_length ?? 0);
  const metaLen = Number(s.meta_description_length ?? 0);

  const { value, reasons } = scoreFromProblems([
    { triggered: !title, points: 20, reason: "Sin meta title" },
    { triggered: Boolean(title) && (titleLen < 10 || titleLen > 65), points: 10, reason: "Title poco optimizado (longitud)" },
    { triggered: !metaDescription, points: 20, reason: "Sin meta description" },
    { triggered: Boolean(metaDescription) && (metaLen < 50 || metaLen > 160), points: 10, reason: "Meta description poco optimizada (longitud)" },
    { triggered: Number(s.h1_count ?? 0) !== 1, points: 15, reason: "Estructura de H1 incorrecta (0 o más de 1)" },
    { triggered: Number(s.word_count_estimate ?? 0) < 300, points: 15, reason: "Contenido escaso (menos de 300 palabras)" },
    { triggered: Number(s.internal_link_count ?? 0) < 3, points: 10, reason: "Enlazado interno débil" },
  ]);

  return { value, reasons, limitedSignal: false };
}

function localSeoScore({ business }: ScoringInput): SubScore {
  // Real local SEO analysis needs Google Business Profile data (Phase 4,
  // blocked on a local-SEO data source) — this is a rough proxy from what we
  // already store on the business record.
  const { value, reasons } = scoreFromProblems([
    { triggered: !business.gbp_place_id, points: 40, reason: "Sin ficha de Google Business Profile detectada" },
    { triggered: !business.review_count || business.review_count === 0, points: 30, reason: "Sin reseñas registradas" },
    { triggered: business.rating !== null && business.rating < 4.0, points: 20, reason: "Valoración media por debajo de 4.0" },
  ]);

  return { value, reasons: [...reasons, "Señal limitada: análisis completo de Google Business Profile pendiente (Fase 4)"], limitedSignal: true };
}

function performanceScore({ business, scan }: ScoringInput): SubScore {
  if (!business.website_url) return noWebsiteScore();
  if (!scan) return unscannedScore();

  const p = scan.performance;
  const lighthouseScore = p.lighthouse_performance_score as number | undefined;

  if (typeof lighthouseScore === "number") {
    const value = clamp(100 - lighthouseScore);
    const reasons = value > 40 ? [`Puntuación Lighthouse de rendimiento: ${lighthouseScore}/100`] : [];
    return { value, reasons, limitedSignal: false };
  }

  const responseMs = Number(p.server_response_time_ms ?? 0);
  const value = clamp((responseMs - 300) / 20);
  return {
    value,
    reasons: value > 30 ? [`Tiempo de respuesta del servidor elevado (${responseMs}ms, proxy aproximado)`] : [],
    limitedSignal: true,
  };
}

function mobileUxScore({ business, scan }: ScoringInput): SubScore {
  if (!business.website_url) return noWebsiteScore();
  if (!scan) return unscannedScore();

  const hasViewport = scan.technical.has_viewport_meta === true;
  const value = hasViewport ? 15 : 70;
  return {
    value,
    reasons: hasViewport ? [] : ["Sin meta viewport — probablemente no responsive"],
    limitedSignal: true, // real mobile UX needs a rendered screenshot, see unavailable_metrics
  };
}

function conversionScore({ business, scan }: ScoringInput): SubScore {
  if (!business.website_url) return noWebsiteScore();
  if (!scan) return unscannedScore();

  const c = scan.conversion;
  const { value, reasons } = scoreFromProblems([
    { triggered: c.has_phone_link !== true, points: 15, reason: "Sin enlace de teléfono directo (tel:)" },
    { triggered: c.has_whatsapp_link !== true, points: 10, reason: "Sin enlace de WhatsApp" },
    { triggered: c.has_contact_form !== true, points: 25, reason: "Sin formulario de contacto" },
    { triggered: Number(c.cta_mentions_count ?? 0) === 0, points: 25, reason: "Sin llamadas a la acción claras" },
    { triggered: c.has_testimonials_section !== true, points: 15, reason: "Sin sección de testimonios/reseñas" },
  ]);

  return { value, reasons, limitedSignal: false };
}

function competitiveGapScore(): SubScore {
  // Blocked on Phase 4 (competitor analysis needs Google Places API).
  return {
    value: 50,
    reasons: ["Sin datos de competencia todavía (Fase 4 pendiente, requiere Google Places API)"],
    limitedSignal: true,
  };
}

export function computeOpportunityScore(input: ScoringInput): OpportunityResult {
  const breakdown: OpportunityBreakdown = {
    website_quality: websiteQualityScore(input),
    seo: seoScore(input),
    local_seo: localSeoScore(input),
    performance: performanceScore(input),
    mobile_ux: mobileUxScore(input),
    conversion: conversionScore(input),
    competitive_gap: competitiveGapScore(),
  };

  const weights = input.weights.opportunity;
  const score = clamp(
    Object.entries(breakdown).reduce((sum, [key, sub]) => {
      const weight = weights[key as keyof typeof weights] ?? 0;
      return sum + weight * sub.value;
    }, 0)
  );

  return { score: Math.round(score), breakdown };
}
