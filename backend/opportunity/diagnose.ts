import type { WebAuditResult, AuditCheck } from "@/backend/audit/types";
import type { SiteAnalysis } from "@/backend/crawl/crawl-site";
import type { SiteIssue } from "@/backend/crawl/issues";

/**
 * The bridge from technical findings to commercial reality.
 *
 * W1 and W2 answer "what is wrong with this website". Nobody buys the answer
 * to that. What a business owner buys is the answer to "what is this costing
 * me, and what do I do about it" — so this translates checks into problems
 * stated in their terms, with the technical evidence kept underneath so the
 * claim can always be defended.
 *
 * The discipline is the same as everywhere else in this project: a problem is
 * only reported when something was actually observed. There is no rule here
 * that invents a consequence from an absence of data, and a check that could
 * not run produces no problem at all — not a mild one.
 */

export type ProblemArea =
  | "no_encontrable"
  | "no_contactable"
  | "movil_roto"
  | "lento"
  | "poco_creible"
  | "inaccesible"
  | "estructura_rota"
  | "contenido_insuficiente";

export type ProblemImpact = "pierde_clientes" | "pierde_visibilidad" | "pierde_confianza" | "riesgo_legal";

export interface BusinessProblem {
  area: ProblemArea;
  /** Stated the way an owner would say it, not the way a developer would. */
  statement: string;
  impact: ProblemImpact;
  /** Why this matters commercially. One sentence, no jargon. */
  consequence: string;
  /** The observation underneath. Always technical, always checkable. */
  evidence: string[];
  severity: "critical" | "serious" | "moderate";
  /** Which of the agency's services addresses it. */
  addressedBy: ServiceKind;
}

export type ServiceKind =
  | "web_nueva"
  | "rediseno"
  | "landing"
  | "seo_tecnico"
  | "seo_local"
  | "contenido"
  | "conversion"
  | "accesibilidad"
  | "rendimiento";

export const SERVICE_LABELS: Record<ServiceKind, string> = {
  web_nueva: "Web nueva",
  rediseno: "Rediseño de la web actual",
  landing: "Landing page de captación",
  seo_tecnico: "SEO técnico",
  seo_local: "SEO local",
  contenido: "Estrategia de contenidos",
  conversion: "Optimización de conversión",
  accesibilidad: "Accesibilidad",
  rendimiento: "Optimización de rendimiento",
};

/** Maps a service to the agency's configured catalogue, when it has a match. */
export const SERVICE_TO_CATALOGUE: Record<ServiceKind, string[]> = {
  web_nueva: ["Diseño y desarrollo web"],
  rediseno: ["Diseño y desarrollo web"],
  landing: ["Diseño y desarrollo web"],
  seo_tecnico: ["SEO"],
  seo_local: ["SEO local", "Optimización Google Business Profile"],
  contenido: ["SEO", "Contenido"],
  conversion: ["Optimización de conversión"],
  accesibilidad: ["Diseño y desarrollo web"],
  rendimiento: ["Diseño y desarrollo web"],
};

interface DiagnosisInput {
  /** The homepage audit, or the best available page audit. */
  audit: WebAuditResult | null;
  /** The whole-site analysis, when a crawl was run. */
  site: SiteAnalysis | null;
}

function failed(audit: WebAuditResult, id: string): AuditCheck | null {
  const check = audit.dimensions.flatMap((dimension) => dimension.checks).find((entry) => entry.id === id);
  if (!check) return null;
  return check.status === "FAIL" || check.status === "WARN" ? check : null;
}

function issueOf(site: SiteAnalysis, code: SiteIssue["code"]): SiteIssue | null {
  return site.issues.find((issue) => issue.code === code) ?? null;
}

/**
 * Produces the business-level problem list.
 *
 * Ordered by what costs money soonest: a visitor who cannot contact you is a
 * sale lost today; a missing sitemap is a sale lost over months.
 */
export function diagnose(input: DiagnosisInput): BusinessProblem[] {
  const problems: BusinessProblem[] = [];
  const { audit, site } = input;

  // ---- Can a visitor get in touch? --------------------------------------
  if (audit) {
    const contact = failed(audit, "cro-contact-routes");
    if (contact) {
      problems.push({
        area: "no_contactable",
        statement: "Quien entra en la web no tiene una forma directa de contactar.",
        impact: "pierde_clientes",
        consequence:
          "Cada visita interesada que no encuentra un teléfono o un formulario se va a buscar a otro. Es la pérdida más cara y la más fácil de arreglar.",
        evidence: [contact.evidence],
        severity: "critical",
        addressedBy: "conversion",
      });
    }

    const phone = failed(audit, "local-phone");
    if (phone && !contact) {
      problems.push({
        area: "no_contactable",
        statement: "El teléfono no se puede pulsar desde el móvil.",
        impact: "pierde_clientes",
        consequence:
          "En un negocio local la mayoría de las visitas llegan desde el móvil, y llamar es la acción más frecuente. Obligar a copiar el número pierde llamadas.",
        evidence: [phone.evidence],
        severity: "serious",
        addressedBy: "conversion",
      });
    }
  }

  // ---- Does the site work on a phone? -----------------------------------
  if (audit) {
    const mobileEvidence = [
      failed(audit, "mobile-viewport"),
      failed(audit, "mobile-overflow"),
      failed(audit, "mobile-tap-targets"),
      failed(audit, "mobile-legibility"),
      failed(audit, "mobile-renders"),
    ].filter((check): check is AuditCheck => check !== null);

    if (mobileEvidence.length > 0) {
      const critical = mobileEvidence.some((check) => check.severity === "critical");
      problems.push({
        area: "movil_roto",
        statement: "La web no funciona bien en el móvil.",
        impact: "pierde_clientes",
        consequence:
          "La mayor parte del tráfico de un negocio local llega desde el teléfono. Si ahí se ve mal, ese tráfico se pierde antes de leer nada.",
        evidence: mobileEvidence.map((check) => check.evidence),
        severity: critical ? "critical" : "serious",
        addressedBy: critical ? "rediseno" : "rendimiento",
      });
    }
  }

  // ---- Can Google find and understand it? -------------------------------
  if (audit) {
    const seoBasics = [failed(audit, "onpage-title"), failed(audit, "onpage-description"), failed(audit, "onpage-h1")]
      .filter((check): check is AuditCheck => check !== null);

    if (seoBasics.length > 0) {
      problems.push({
        area: "no_encontrable",
        statement: "Google no tiene con qué mostrar la web en los resultados.",
        impact: "pierde_visibilidad",
        consequence:
          "El título y la descripción son lo que aparece en Google. Sin ellos, el buscador improvisa o directamente no la muestra para lo que busca la gente.",
        evidence: seoBasics.map((check) => check.evidence),
        severity: seoBasics.some((check) => check.severity === "critical") ? "critical" : "serious",
        addressedBy: "seo_tecnico",
      });
    }

    const indexable = failed(audit, "tech-indexable");
    if (indexable) {
      problems.push({
        area: "no_encontrable",
        statement: "La web le está diciendo a Google que no la muestre.",
        impact: "pierde_visibilidad",
        consequence:
          "Con una etiqueta noindex la página no aparecerá jamás en los resultados, por mucho que se trabaje todo lo demás.",
        evidence: [indexable.evidence],
        severity: "critical",
        addressedBy: "seo_tecnico",
      });
    }
  }

  // ---- Local presence ----------------------------------------------------
  if (audit) {
    const localGaps = [
      failed(audit, "local-schema"),
      failed(audit, "local-address"),
      failed(audit, "local-hours"),
    ].filter((check): check is AuditCheck => check !== null);

    if (localGaps.length >= 2) {
      problems.push({
        area: "no_encontrable",
        statement: "El negocio no está identificado como negocio local para Google.",
        impact: "pierde_visibilidad",
        consequence:
          "Sin dirección, horarios y datos estructurados, Google no puede colocarlo en las búsquedas del tipo \"cerca de mí\", que es donde se decide la mayoría de las visitas locales.",
        evidence: localGaps.map((check) => check.evidence),
        severity: "serious",
        addressedBy: "seo_local",
      });
    }
  }

  // ---- Credibility -------------------------------------------------------
  if (audit) {
    const https = failed(audit, "tech-https");
    if (https) {
      problems.push({
        area: "poco_creible",
        statement: "El navegador marca la web como no segura.",
        impact: "pierde_confianza",
        consequence:
          "Chrome muestra un aviso de 'No es seguro' antes de que el visitante lea nada. Difícilmente va a dejar su teléfono ahí.",
        evidence: [https.evidence],
        severity: "critical",
        // A missing certificate is a technical fix, not a reason to rebuild.
        // Quoting a redesign for it would be charging four figures for an
        // afternoon's work.
        addressedBy: "seo_tecnico",
      });
    }

    const proof = failed(audit, "cro-social-proof");
    if (proof) {
      problems.push({
        area: "poco_creible",
        statement: "No hay ninguna reseña ni opinión visible en la web.",
        impact: "pierde_confianza",
        consequence:
          "Un cliente que no conoce el negocio busca señales de que otros ya confiaron. Sin ellas, compara solo por precio.",
        evidence: [proof.evidence],
        severity: "moderate",
        addressedBy: "conversion",
      });
    }
  }

  // ---- Accessibility -----------------------------------------------------
  if (audit) {
    const a11y = audit.dimensions.find((dimension) => dimension.key === "accessibility");
    const a11yFails = a11y?.checks.filter((check) => check.status === "FAIL") ?? [];

    if (a11yFails.length >= 3) {
      problems.push({
        area: "inaccesible",
        statement: "La web no es usable para personas con discapacidad.",
        impact: "riesgo_legal",
        consequence:
          "Además de dejar fuera a clientes reales, la accesibilidad es exigible por normativa a determinados negocios. Conviene comprobar si aplica en su caso.",
        evidence: a11yFails.slice(0, 4).map((check) => `${check.label}: ${check.evidence}`),
        severity: "serious",
        addressedBy: "accesibilidad",
      });
    }
  }

  // ---- Site-wide structure (W2 only) -------------------------------------
  if (site) {
    const dead = [issueOf(site, "SERVER_ERROR"), issueOf(site, "CLIENT_ERROR")].filter(
      (issue): issue is SiteIssue => issue !== null
    );

    if (dead.length > 0) {
      problems.push({
        area: "estructura_rota",
        statement: "Hay páginas de la web que no funcionan.",
        impact: "pierde_clientes",
        consequence:
          "Un visitante que aterriza en una página caída se va. Y Google, cuando encuentra varias, reduce el ritmo con el que revisa el resto del sitio.",
        evidence: dead.map((issue) => issue.evidence),
        severity: "critical",
        addressedBy: "seo_tecnico",
      });
    }

    const orphans = issueOf(site, "ORPHAN_PAGE");
    const missingFromSitemap = issueOf(site, "MISSING_FROM_SITEMAP");
    const noSitemap = issueOf(site, "NO_SITEMAP");

    const discoverability = [orphans, missingFromSitemap, noSitemap].filter(
      (issue): issue is SiteIssue => issue !== null
    );

    if (discoverability.length > 0) {
      problems.push({
        area: "no_encontrable",
        statement: "Hay páginas de la web a las que Google llega con dificultad o no llega.",
        impact: "pierde_visibilidad",
        consequence:
          "Una página que nadie enlaza y que no está en el sitemap es, a efectos prácticos, invisible: existe pero no trae visitas.",
        evidence: discoverability.map((issue) => issue.evidence),
        severity: "serious",
        // A structural discoverability problem is fixed by linking and
        // sitemap work, which is technical SEO, not a redesign.
        addressedBy: "seo_tecnico",
      });
    }

    const duplicates = [
      issueOf(site, "DUPLICATE_CONTENT"),
      issueOf(site, "DUPLICATE_TITLE"),
      issueOf(site, "CANONICAL_CONFLICT"),
    ].filter((issue): issue is SiteIssue => issue !== null);

    if (duplicates.length > 0) {
      problems.push({
        area: "estructura_rota",
        statement: "Varias páginas compiten entre sí por lo mismo.",
        impact: "pierde_visibilidad",
        consequence:
          "Cuando dos páginas dicen lo mismo, Google elige una y descarta la otra. El esfuerzo invertido en la descartada no rinde.",
        evidence: duplicates.map((issue) => issue.evidence),
        severity: "serious",
        addressedBy: "contenido",
      });
    }

    // Thin content across the site, measured rather than assumed.
    const thin = site.site.pages.filter(
      (page) => (page.state === "OK" || page.state === "REDIRECT") && page.wordCount > 0 && page.wordCount < 150
    );
    const substantive = site.site.pages.filter((page) => page.state === "OK" || page.state === "REDIRECT");

    if (substantive.length >= 3 && thin.length / substantive.length > 0.5) {
      problems.push({
        area: "contenido_insuficiente",
        statement: "La mayoría de las páginas tienen muy poco contenido.",
        impact: "pierde_visibilidad",
        consequence:
          "Una página que no responde a lo que la gente busca no compite. No se trata de escribir más, sino de responder de verdad.",
        evidence: [
          `${thin.length} de ${substantive.length} páginas rastreadas tienen menos de 150 palabras.`,
        ],
        severity: "moderate",
        addressedBy: "contenido",
      });
    }
  }

  const order = { critical: 0, serious: 1, moderate: 2 };
  return problems.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * What the diagnosis could NOT establish. Handed to the caller so a proposal
 * never implies a completeness it does not have.
 */
export function diagnosisLimitations(input: DiagnosisInput): string[] {
  const limitations: string[] = [];

  if (!input.audit) {
    limitations.push("No se auditó ninguna página, así que no hay diagnóstico de la web en sí.");
  } else {
    limitations.push(...input.audit.limitations);
  }

  if (!input.site) {
    limitations.push(
      "Solo se analizó una página. Los problemas de estructura, enlazado y duplicados requieren rastrear el sitio entero."
    );
  } else {
    limitations.push(...input.site.limitations);
  }

  return limitations;
}
