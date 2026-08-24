import * as cheerio from "cheerio";
import { fetchSafely, UnsafeUrlError, type SafetyOptions } from "@/lib/security/ssrf-guard";
import { auditMobile, type MobileAuditResult } from "@/backend/scanner/mobile-audit";
import { accessibilityChecks } from "./accessibility";
import { analyzeStructuredData, VALIDATED_TYPES } from "./structured-data";
import {
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
  SEVERITY_RANK,
  type AuditCheck,
  type AuditDimensionKey,
  type DimensionScore,
  type QualityGateResult,
  type WebAuditResult,
} from "./types";

/**
 * W1 — the audit engine.
 *
 * Runs every check it can against a real page and scores nine dimensions.
 * It measures; it does not redesign. §39 is explicit that an existing site
 * gets audited before anyone touches it, and this is that step.
 *
 * The scoring rule, restated because everything depends on it: a check that
 * could not run contributes zero weight, not zero points. A dimension where
 * nothing could run scores `null`, and the overall score simply excludes it
 * rather than pretending it was a bad result.
 */

export interface AuditOptions extends SafetyOptions {
  /** Skips the headless-browser pass. Mobile is then NO_EVALUABLE, not zero. */
  skipMobile?: boolean;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
  now?: Date;
}

function pass(
  id: string,
  dimension: AuditDimensionKey,
  label: string,
  severity: AuditCheck["severity"],
  weight: number,
  condition: boolean,
  evidence: string,
  fix: string,
  reference?: string
): AuditCheck {
  return {
    id,
    dimension,
    label,
    status: condition ? "PASS" : "FAIL",
    severity,
    weight,
    evidence,
    ...(condition ? {} : { fix }),
    ...(reference ? { reference } : {}),
  };
}

function unmeasurable(
  id: string,
  dimension: AuditDimensionKey,
  label: string,
  severity: AuditCheck["severity"],
  missing: string
): AuditCheck {
  return {
    id,
    dimension,
    label,
    status: "NO_EVALUABLE",
    severity,
    weight: 0,
    evidence: "No comprobado.",
    missing,
  };
}

const SEARCH_CENTRAL = "https://developers.google.com/search/docs";

export async function auditWebsite(url: string, options: AuditOptions = {}): Promise<WebAuditResult> {
  const now = options.now ?? new Date();
  const limitations: string[] = [];

  let page: Awaited<ReturnType<typeof fetchSafely>>;
  try {
    page = await fetchSafely(url, { timeoutMs: 15_000, maxBytes: 3_000_000, ...options });
  } catch (err) {
    // A site that does not respond cannot be audited. Reporting zeros would
    // say "everything is bad" when the truth is "nothing could be seen".
    const message =
      err instanceof UnsafeUrlError
        ? err.message
        : err instanceof Error
          ? err.message
          : "La web no respondió.";
    return {
      url,
      finalUrl: url,
      auditedAt: now.toISOString(),
      overall: null,
      confidence: 0,
      dimensions: [],
      gate: {
        passed: false,
        blockers: [],
        warnings: [],
        reason: `No se pudo auditar: ${message}`,
      },
      priorities: [],
      limitations: [`La web no respondió, así que no se comprobó nada: ${message}`],
    };
  }

  // A 404 or a 500 still comes back with a body, and parsing it would score
  // the error page as if it were the site — an audit of something that is
  // not there. The fetch succeeding is not the same as the page existing.
  if (page.status >= 400) {
    return {
      url,
      finalUrl: page.finalUrl,
      auditedAt: now.toISOString(),
      overall: null,
      confidence: 0,
      dimensions: [],
      gate: {
        passed: false,
        blockers: [],
        warnings: [],
        reason: `No se pudo auditar: la URL devolvió HTTP ${page.status}.`,
      },
      priorities: [],
      limitations: [
        `La URL devolvió HTTP ${page.status}, así que no se auditó nada: lo que respondió es una página de error, no el sitio.`,
      ],
    };
  }

  const $ = cheerio.load(page.body);
  const origin = new URL(page.finalUrl).origin;
  const checks: AuditCheck[] = [];

  // ---- Technical SEO -----------------------------------------------------
  const isHttps = page.finalUrl.startsWith("https://");
  checks.push(
    pass(
      "tech-https",
      "technical_seo",
      "El sitio se sirve por HTTPS",
      "critical",
      5,
      isHttps,
      isHttps ? `Servido desde ${origin}.` : `Servido por HTTP sin cifrar: ${origin}.`,
      "Instala un certificado TLS y redirige todo el tráfico HTTP a HTTPS.",
      `${SEARCH_CENTRAL}/crawling-indexing/https`
    )
  );

  const [robots, sitemap] = await Promise.all([
    probe(`${origin}/robots.txt`, options),
    probe(`${origin}/sitemap.xml`, options),
  ]);

  checks.push(
    pass(
      "tech-robots",
      "technical_seo",
      "Existe robots.txt",
      "moderate",
      2,
      robots,
      robots ? "robots.txt responde correctamente." : "No se encontró robots.txt.",
      "Publica un robots.txt que apunte al sitemap y no bloquee recursos necesarios para renderizar.",
      `${SEARCH_CENTRAL}/crawling-indexing/robots/intro`
    ),
    pass(
      "tech-sitemap",
      "technical_seo",
      "Existe sitemap.xml",
      "serious",
      3,
      sitemap,
      sitemap ? "sitemap.xml responde correctamente." : "No se encontró sitemap.xml en la raíz.",
      "Genera un sitemap.xml con las URLs indexables y decláralo en robots.txt y en Search Console.",
      `${SEARCH_CENTRAL}/crawling-indexing/sitemaps/overview`
    )
  );

  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  checks.push(
    pass(
      "tech-canonical",
      "technical_seo",
      "La página declara su URL canónica",
      "moderate",
      2,
      Boolean(canonical),
      canonical ? `canonical → ${canonical}` : "No hay etiqueta canonical.",
      "Añade <link rel=\"canonical\"> apuntando a la versión preferida de la URL.",
      `${SEARCH_CENTRAL}/crawling-indexing/consolidate-duplicate-urls`
    )
  );

  const robotsMeta = $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
  const blocked = robotsMeta.includes("noindex");
  checks.push({
    id: "tech-indexable",
    dimension: "technical_seo",
    label: "La página es indexable",
    status: blocked ? "FAIL" : "PASS",
    severity: "critical",
    weight: 5,
    evidence: blocked
      ? `La meta robots contiene noindex: "${robotsMeta}". Google no la mostrará jamás.`
      : "No hay ninguna directiva noindex.",
    ...(blocked ? { fix: "Quita noindex de la meta robots si esta página debe posicionar." } : {}),
    reference: `${SEARCH_CENTRAL}/crawling-indexing/block-indexing`,
  });

  const structured = analyzeStructuredData($);
  checks.push(...structured.checks);
  limitations.push(
    `La validación de datos estructurados cubre ${VALIDATED_TYPES.length} tipos (${VALIDATED_TYPES.join(", ")}); otros tipos se detectan pero no se validan.`
  );

  // ---- On-page SEO -------------------------------------------------------
  const title = $("title").first().text().trim();
  const titleOk = title.length >= 15 && title.length <= 65;
  checks.push({
    id: "onpage-title",
    dimension: "onpage_seo",
    label: "El title existe y tiene longitud adecuada",
    status: title.length === 0 ? "FAIL" : titleOk ? "PASS" : "WARN",
    severity: title.length === 0 ? "critical" : "moderate",
    weight: 5,
    evidence:
      title.length === 0
        ? "La página no tiene <title>."
        : `"${title}" (${title.length} caracteres).`,
    ...(titleOk
      ? {}
      : {
          fix:
            title.length === 0
              ? "Añade un <title> único y descriptivo."
              : "Ajusta el title a 15–65 caracteres: fuera de ese rango Google suele reescribirlo.",
        }),
    reference: `${SEARCH_CENTRAL}/appearance/title-link`,
  });

  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const descOk = metaDescription.length >= 50 && metaDescription.length <= 165;
  checks.push({
    id: "onpage-description",
    dimension: "onpage_seo",
    label: "La meta description existe y tiene longitud adecuada",
    status: metaDescription.length === 0 ? "FAIL" : descOk ? "PASS" : "WARN",
    severity: "moderate",
    weight: 3,
    evidence:
      metaDescription.length === 0
        ? "No hay meta description."
        : `${metaDescription.length} caracteres.`,
    ...(descOk
      ? {}
      : { fix: "Escribe una meta description de 50–165 caracteres que invite a hacer clic." }),
    reference: `${SEARCH_CENTRAL}/appearance/snippet`,
  });

  const h1s = $("h1");
  checks.push(
    pass(
      "onpage-h1",
      "onpage_seo",
      "La página tiene un único H1",
      "serious",
      4,
      h1s.length === 1,
      h1s.length === 0 ? "No hay H1." : `Hay ${h1s.length} H1.`,
      "Usa un único H1 que declare de qué va la página.",
      `${SEARCH_CENTRAL}/appearance/structured-heading`
    )
  );

  const h2Count = $("h2").length;
  checks.push(
    pass(
      "onpage-subheadings",
      "onpage_seo",
      "El contenido está estructurado con subtítulos",
      "minor",
      2,
      h2Count > 0,
      h2Count > 0 ? `${h2Count} H2 en la página.` : "No hay ningún H2: el contenido no está segmentado.",
      "Divide el contenido con H2 que respondan a lo que busca el usuario."
    )
  );

  const images = $("img").toArray();
  const withoutAlt = images.filter((el) => !$(el).attr("alt")?.trim()).length;
  checks.push({
    id: "onpage-image-alt",
    dimension: "onpage_seo",
    label: "Las imágenes tienen alt descriptivo",
    status: images.length === 0 ? "NO_EVALUABLE" : withoutAlt === 0 ? "PASS" : "WARN",
    severity: "minor",
    weight: images.length === 0 ? 0 : 2,
    evidence:
      images.length === 0
        ? "No comprobado."
        : `${withoutAlt} de ${images.length} imágenes sin alt con texto.`,
    ...(images.length === 0 ? { missing: "La página no contiene imágenes." } : {}),
    ...(withoutAlt > 0 ? { fix: "Describe el contenido de cada imagen informativa en su alt." } : {}),
  });

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim();
  checks.push(
    pass(
      "onpage-opengraph",
      "onpage_seo",
      "Metadatos Open Graph para compartir",
      "minor",
      2,
      Boolean(ogTitle && ogImage),
      ogTitle && ogImage
        ? "og:title y og:image presentes."
        : `Falta ${!ogTitle ? "og:title" : ""}${!ogTitle && !ogImage ? " y " : ""}${!ogImage ? "og:image" : ""}.`,
      "Añade og:title, og:description y og:image para que el enlace se vea bien al compartirlo."
    )
  );

  // ---- Content -----------------------------------------------------------
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.length > 0 ? bodyText.split(" ").length : 0;
  checks.push({
    id: "content-depth",
    dimension: "content",
    label: "La página tiene contenido suficiente",
    status: wordCount >= 300 ? "PASS" : wordCount >= 120 ? "WARN" : "FAIL",
    severity: "moderate",
    weight: 4,
    evidence: `${wordCount} palabras de texto visible.`,
    ...(wordCount < 300
      ? { fix: "Desarrolla el contenido para responder de verdad a lo que busca el usuario. No se trata de rellenar: se trata de responder." }
      : {}),
  });

  // ---- Local SEO ---------------------------------------------------------
  const hasTel = $('a[href^="tel:"]').length > 0;
  const bodyLower = bodyText.toLowerCase();
  // A postal-code-and-street shape, not a guess about which address it is.
  const looksLikeAddress = /\b(calle|carrer|avinguda|avenida|plaça|plaza|c\/|passeig)\b/i.test(bodyText);
  const hasMap = $('iframe[src*="maps.google"], iframe[src*="google.com/maps"], iframe[src*="openstreetmap"]').length > 0;
  const hasHours = /\b(horario|obert|abierto|lunes|dilluns|monday)\b/i.test(bodyLower);

  checks.push(
    pass(
      "local-phone",
      "local_seo",
      "El teléfono es pulsable",
      "serious",
      4,
      hasTel,
      hasTel ? "Hay al menos un enlace tel:." : "El teléfono no es un enlace tel: (o no aparece).",
      'Enlaza el teléfono con <a href="tel:+34...">: en móvil es la vía de contacto más usada.'
    ),
    pass(
      "local-address",
      "local_seo",
      "La dirección aparece en la página",
      "serious",
      3,
      looksLikeAddress,
      looksLikeAddress ? "Se detecta una dirección postal en el texto." : "No se detecta ninguna dirección postal.",
      "Muestra la dirección completa en texto (no solo en una imagen) y márcala con schema PostalAddress."
    ),
    pass(
      "local-hours",
      "local_seo",
      "Se indican los horarios",
      "moderate",
      2,
      hasHours,
      hasHours ? "Se menciona horario en la página." : "No se detecta información de horarios.",
      "Publica los horarios y márcalos con openingHours: es una de las cosas que más se busca."
    ),
    pass(
      "local-map",
      "local_seo",
      "Hay un mapa incrustado",
      "minor",
      1,
      hasMap,
      hasMap ? "Hay un mapa incrustado." : "No hay mapa incrustado.",
      "Incrusta un mapa para que el cliente vea de un vistazo si le pilla cerca."
    )
  );

  const localSchema = structured.nodes.some((node) =>
    ["LocalBusiness", "Restaurant", "Hotel", "Store"].includes(node.type)
  );
  checks.push(
    pass(
      "local-schema",
      "local_seo",
      "Datos estructurados de negocio local",
      "serious",
      4,
      localSchema,
      localSchema
        ? `Presente: ${structured.nodes.map((n) => n.type).join(", ")}.`
        : "No hay schema de negocio local.",
      "Añade LocalBusiness (o el subtipo que corresponda) con name, address, telephone y openingHours.",
      "https://developers.google.com/search/docs/appearance/structured-data/local-business"
    )
  );

  // ---- CRO ---------------------------------------------------------------
  const hasWhatsapp = $('a[href*="wa.me"], a[href*="api.whatsapp.com"]').length > 0;
  const hasForm = $("form").length > 0;
  const hasEmail = $('a[href^="mailto:"]').length > 0;
  const contactRoutes = [hasTel, hasWhatsapp, hasForm, hasEmail].filter(Boolean).length;

  checks.push(
    pass(
      "cro-contact-routes",
      "cro",
      "Hay vías de contacto directas",
      "critical",
      5,
      contactRoutes > 0,
      contactRoutes > 0
        ? `${contactRoutes} vía(s): ${[hasTel && "teléfono", hasWhatsapp && "WhatsApp", hasForm && "formulario", hasEmail && "email"].filter(Boolean).join(", ")}.`
        : "No hay ninguna forma directa de contactar desde la página.",
      "Añade al menos una vía de contacto visible sin hacer scroll: teléfono, WhatsApp o formulario."
    ),
    pass(
      "cro-multiple-routes",
      "cro",
      "Más de una vía de contacto",
      "moderate",
      2,
      contactRoutes >= 2,
      `${contactRoutes} vía(s) de contacto.`,
      "Ofrece al menos dos vías: no todo el mundo quiere llamar."
    )
  );

  const socialProof = /\b(opinion|opinión|reseña|review|testimoni|valoración)\b/i.test(bodyLower);
  checks.push(
    pass(
      "cro-social-proof",
      "cro",
      "Hay prueba social en la página",
      "moderate",
      2,
      socialProof,
      socialProof ? "Se detectan menciones a reseñas u opiniones." : "No se detecta prueba social.",
      "Muestra reseñas reales: es lo que más reduce la desconfianza de un cliente nuevo."
    )
  );

  // ---- Code quality ------------------------------------------------------
  const semanticTags = ["header", "nav", "main", "footer", "section", "article"].filter(
    (tag) => $(tag).length > 0
  );
  checks.push(
    pass(
      "code-semantics",
      "code_quality",
      "El HTML usa etiquetas semánticas",
      "moderate",
      3,
      semanticTags.length >= 3,
      semanticTags.length > 0
        ? `Usa: ${semanticTags.join(", ")}.`
        : "No se detecta ninguna etiqueta semántica; todo son <div>.",
      "Sustituye los <div> estructurales por header, nav, main, section y footer."
    )
  );

  const inlineStyles = $("[style]").length;
  checks.push({
    id: "code-inline-styles",
    dimension: "code_quality",
    label: "Los estilos no están incrustados en el marcado",
    status: inlineStyles === 0 ? "PASS" : inlineStyles < 15 ? "WARN" : "FAIL",
    severity: "minor",
    weight: 2,
    evidence: `${inlineStyles} elemento(s) con atributo style.`,
    ...(inlineStyles > 0
      ? { fix: "Lleva los estilos a hojas CSS o clases: los estilos en línea no se cachean ni se reutilizan." }
      : {}),
  });

  const hasLang = Boolean($("html").attr("lang")?.trim());
  checks.push(
    pass(
      "code-lang",
      "code_quality",
      "El documento declara su idioma",
      "moderate",
      2,
      hasLang,
      hasLang ? `lang="${$("html").attr("lang")}".` : "El <html> no declara lang.",
      'Añade lang="es" al elemento <html>.'
    )
  );

  // ---- Accessibility -----------------------------------------------------
  checks.push(...accessibilityChecks($));

  // ---- Performance -------------------------------------------------------
  // Measured from what the fetch itself observed. Real Core Web Vitals need
  // field data or Lighthouse, and saying otherwise would be a fabrication.
  const pageWeightKb = Math.round(page.body.length / 1024);
  checks.push({
    id: "perf-html-weight",
    dimension: "performance",
    label: "El HTML no es excesivamente pesado",
    status: pageWeightKb <= 150 ? "PASS" : pageWeightKb <= 400 ? "WARN" : "FAIL",
    severity: "moderate",
    weight: 3,
    evidence: `${pageWeightKb} KB de HTML.`,
    ...(pageWeightKb > 150
      ? { fix: "Reduce el HTML: normalmente el exceso viene de contenido incrustado que debería cargarse aparte." }
      : {}),
  });

  const scripts = $("script[src]").toArray();
  const blockingScripts = scripts.filter(
    (el) => !$(el).attr("defer") && !$(el).attr("async") && $(el).attr("type") !== "module"
  ).length;
  checks.push({
    id: "perf-blocking-scripts",
    dimension: "performance",
    label: "Los scripts no bloquean el renderizado",
    status: blockingScripts === 0 ? "PASS" : blockingScripts <= 2 ? "WARN" : "FAIL",
    severity: "serious",
    weight: 4,
    evidence:
      scripts.length === 0
        ? "No hay scripts externos."
        : `${blockingScripts} de ${scripts.length} scripts sin defer ni async.`,
    ...(blockingScripts > 0
      ? { fix: "Añade defer (o async cuando el orden no importe) a los scripts externos: bloquean el primer pintado." }
      : {}),
    reference: "https://web.dev/articles/lcp",
  });

  const lazyImages = images.filter((el) => $(el).attr("loading") === "lazy").length;
  checks.push({
    id: "perf-lazy-images",
    dimension: "performance",
    label: "Las imágenes se cargan de forma diferida",
    status: images.length === 0 ? "NO_EVALUABLE" : lazyImages > 0 ? "PASS" : "WARN",
    severity: "minor",
    weight: images.length === 0 ? 0 : 2,
    evidence:
      images.length === 0
        ? "No comprobado."
        : `${lazyImages} de ${images.length} imágenes con loading="lazy".`,
    ...(images.length === 0 ? { missing: "La página no contiene imágenes." } : {}),
    ...(images.length > 0 && lazyImages === 0
      ? { fix: 'Añade loading="lazy" a las imágenes que no se ven al abrir la página.' }
      : {}),
  });

  checks.push(
    unmeasurable(
      "perf-core-web-vitals",
      "performance",
      "Core Web Vitals (LCP, INP, CLS)",
      "serious",
      "Requiere datos de campo o Lighthouse; configura GOOGLE_PAGESPEED_API_KEY para medirlos."
    )
  );
  limitations.push(
    "Los Core Web Vitals reales (LCP, INP, CLS) no se han medido: hacen falta datos de campo o Lighthouse."
  );

  // ---- Mobile ------------------------------------------------------------
  let mobile: MobileAuditResult | null = null;
  if (options.skipMobile) {
    checks.push(
      unmeasurable(
        "mobile-render",
        "mobile",
        "Comportamiento real en móvil",
        "critical",
        "La auditoría móvil se ha omitido en esta ejecución."
      )
    );
    limitations.push("No se ejecutó la auditoría móvil, así que la dimensión Móvil no tiene puntuación.");
  } else {
    try {
      mobile = await auditMobile(page.finalUrl, options.mobileOptions);
    } catch {
      mobile = null;
    }

    if (mobile && mobile.status === "completed") {
      checks.push(
        pass(
          "mobile-overflow",
          "mobile",
          "El contenido no se sale de la pantalla",
          "critical",
          5,
          !mobile.hasHorizontalOverflow,
          mobile.hasHorizontalOverflow
            ? `A 390 px el documento mide ${mobile.documentWidth} px: hay scroll horizontal.`
            : "A 390 px el contenido cabe sin scroll horizontal.",
          "Corrige los elementos que desbordan: en móvil obligan a hacer scroll lateral para leer."
        ),
        pass(
          "mobile-tap-targets",
          "mobile",
          "Los elementos pulsables tienen tamaño suficiente",
          "serious",
          4,
          mobile.smallTapTargets === 0,
          `${mobile.smallTapTargets} de ${mobile.tapTargetsChecked} elementos por debajo de 24 px.`,
          "Agranda los enlaces y botones pequeños a 24 px como mínimo, 44 px idealmente."
        ),
        pass(
          "mobile-legibility",
          "mobile",
          "El texto es legible sin ampliar",
          "serious",
          4,
          mobile.tinyTextNodes === 0,
          `${mobile.tinyTextNodes} bloque(s) de texto por debajo de 12 px.`,
          "Sube el tamaño del cuerpo de texto a 16 px."
        ),
        pass(
          "mobile-renders",
          "mobile",
          "La página muestra contenido en móvil",
          "critical",
          5,
          mobile.rendersContent,
          mobile.rendersContent ? "Renderiza contenido visible." : "No se renderizó contenido en el viewport móvil.",
          "Comprueba que el contenido no dependa de JavaScript que falla en móvil."
        )
      );
    } else {
      checks.push(
        unmeasurable(
          "mobile-render",
          "mobile",
          "Comportamiento real en móvil",
          "critical",
          mobile?.unavailableReason ?? "No se pudo abrir un navegador para renderizar la página."
        )
      );
      limitations.push(
        `La auditoría móvil no se pudo ejecutar: ${mobile?.unavailableReason ?? "no hay navegador disponible"}.`
      );
    }
  }

  const viewportMeta = $('meta[name="viewport"]').attr("content");
  checks.push(
    pass(
      "mobile-viewport",
      "mobile",
      "Declara meta viewport",
      "critical",
      4,
      Boolean(viewportMeta),
      viewportMeta ? `viewport: "${viewportMeta}".` : "No hay meta viewport: el móvil renderizará la versión de escritorio.",
      'Añade <meta name="viewport" content="width=device-width, initial-scale=1">.'
    )
  );

  const dimensions = scoreDimensions(checks);
  const overall = weightedOverall(dimensions);
  const confidence = modelConfidence(dimensions);
  const gate = qualityGate(checks, dimensions);

  return {
    url,
    finalUrl: page.finalUrl,
    auditedAt: now.toISOString(),
    overall,
    confidence,
    dimensions,
    gate,
    priorities: prioritise(checks),
    limitations,
  };
}

async function probe(url: string, options: SafetyOptions): Promise<boolean> {
  try {
    const response = await fetchSafely(url, { timeoutMs: 6000, maxBytes: 200_000, ...options });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

/** WARN counts as half credit: it is a real defect, not a failure. */
function creditFor(status: AuditCheck["status"]): number {
  if (status === "PASS") return 1;
  if (status === "WARN") return 0.5;
  return 0;
}

export function scoreDimensions(checks: AuditCheck[]): DimensionScore[] {
  const keys = Object.keys(DIMENSION_LABELS) as AuditDimensionKey[];

  return keys.map((key) => {
    const own = checks.filter((check) => check.dimension === key);
    const measurable = own.filter((check) => check.status !== "NO_EVALUABLE");
    const totalWeight = measurable.reduce((sum, check) => sum + check.weight, 0);
    const earned = measurable.reduce((sum, check) => sum + check.weight * creditFor(check.status), 0);

    // Confidence is the share of *declared* weight that could be measured.
    // Checks that cannot run declare zero weight, so the denominator here is
    // the count of checks, not their weight.
    const confidence = own.length === 0 ? 0 : measurable.length / own.length;

    return {
      key,
      label: DIMENSION_LABELS[key],
      score: totalWeight === 0 ? null : Math.round((earned / totalWeight) * 100),
      confidence,
      checks: own,
      passed: own.filter((c) => c.status === "PASS").length,
      failed: own.filter((c) => c.status === "FAIL").length,
      notEvaluable: own.filter((c) => c.status === "NO_EVALUABLE").length,
    };
  });
}

function weightedOverall(dimensions: DimensionScore[]): number | null {
  const scored = dimensions.filter((dimension) => dimension.score !== null);
  if (scored.length === 0) return null;

  const totalWeight = scored.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d.key], 0);
  const earned = scored.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d.key] * (d.score ?? 0), 0);
  return Math.round(earned / totalWeight);
}

/** Share of the model's total weight that produced a score at all. */
function modelConfidence(dimensions: DimensionScore[]): number {
  const total = Object.values(DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const measured = dimensions
    .filter((dimension) => dimension.score !== null)
    .reduce((sum, dimension) => sum + DIMENSION_WEIGHTS[dimension.key], 0);
  return measured / total;
}

/**
 * §32 — the quality gate. A site does not ship because it works.
 *
 * Critical failures block. So does a dimension nobody could measure: shipping
 * while blind to a whole dimension is not the same as shipping something
 * checked and found acceptable, and the gate refuses to blur the two.
 */
export function qualityGate(checks: AuditCheck[], dimensions: DimensionScore[]): QualityGateResult {
  const blockers = checks.filter((check) => check.status === "FAIL" && check.severity === "critical");
  const warnings = checks.filter(
    (check) => (check.status === "FAIL" && check.severity === "serious") || check.status === "WARN"
  );
  const unmeasured = dimensions.filter((dimension) => dimension.score === null);

  if (blockers.length > 0) {
    return {
      passed: false,
      blockers,
      warnings,
      reason: `${blockers.length} fallo(s) crítico(s) bloquean la entrega: ${blockers.map((b) => b.label).join("; ")}.`,
    };
  }

  if (unmeasured.length > 0) {
    return {
      passed: false,
      blockers: [],
      warnings,
      reason: `No se pudo evaluar ${unmeasured.map((d) => d.label).join(", ")}. Entregar sin medir una dimensión entera no es lo mismo que entregar algo comprobado.`,
    };
  }

  return {
    passed: true,
    blockers: [],
    warnings,
    reason:
      warnings.length === 0
        ? "Sin fallos críticos ni advertencias: cumple el listón de entrega."
        : `Sin fallos críticos. Quedan ${warnings.length} mejora(s) recomendada(s) que no bloquean.`,
  };
}

/** Severity first, then weight: what to fix on Monday morning. */
export function prioritise(checks: AuditCheck[]): AuditCheck[] {
  return checks
    .filter((check) => check.status === "FAIL" || check.status === "WARN")
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return bySeverity !== 0 ? bySeverity : b.weight - a.weight;
    });
}
