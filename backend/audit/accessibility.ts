import type { CheerioAPI } from "cheerio";
import type { AuditCheck } from "./types";

/**
 * W1 — accessibility checks against the served HTML.
 *
 * Scoped honestly: these are the WCAG failures that are detectable from
 * static markup. Contrast, focus order and keyboard traps need a rendered
 * page with computed styles, so they are reported as NO_EVALUABLE here rather
 * than guessed at — claiming AA compliance from HTML alone would be exactly
 * the kind of confident-sounding invention this project refuses.
 *
 * References are to the WCAG 2.2 success criteria, so every claim can be
 * checked instead of trusted.
 */

const WCAG = "https://www.w3.org/WAI/WCAG22/quickref/";

function check(
  id: string,
  label: string,
  severity: AuditCheck["severity"],
  weight: number,
  passed: boolean,
  evidence: string,
  fix: string,
  reference: string
): AuditCheck {
  return {
    id,
    dimension: "accessibility",
    label,
    status: passed ? "PASS" : "FAIL",
    severity,
    weight,
    evidence,
    ...(passed ? {} : { fix }),
    reference,
  };
}

export function accessibilityChecks($: CheerioAPI): AuditCheck[] {
  const checks: AuditCheck[] = [];

  // --- 3.1.1 Language of page -------------------------------------------
  const lang = $("html").attr("lang")?.trim();
  checks.push(
    check(
      "a11y-lang",
      "El idioma de la página está declarado",
      "serious",
      3,
      Boolean(lang),
      lang ? `<html lang="${lang}">` : "El elemento <html> no tiene atributo lang.",
      'Añade lang="es" (o el idioma real) al elemento <html> para que los lectores de pantalla lo pronuncien correctamente.',
      `${WCAG}#language-of-page`
    )
  );

  // --- 1.1.1 Non-text content -------------------------------------------
  const images = $("img").toArray();
  // A decorative image with alt="" is correct, not a failure. Only a missing
  // attribute is a defect: it leaves the screen reader announcing the
  // filename, which is worse than announcing nothing.
  const missingAlt = images.filter((el) => $(el).attr("alt") === undefined);
  checks.push(
    check(
      "a11y-img-alt",
      "Todas las imágenes tienen atributo alt",
      "serious",
      4,
      missingAlt.length === 0,
      images.length === 0
        ? "La página no tiene imágenes."
        : `${missingAlt.length} de ${images.length} imágenes sin atributo alt.`,
      'Añade alt descriptivo a las imágenes informativas y alt="" a las decorativas.',
      `${WCAG}#non-text-content`
    )
  );

  // --- 2.4.6 / 1.3.1 Heading structure ----------------------------------
  const h1s = $("h1");
  checks.push(
    check(
      "a11y-h1",
      "La página tiene exactamente un H1",
      "moderate",
      3,
      h1s.length === 1,
      h1s.length === 0 ? "No hay ningún H1." : `Hay ${h1s.length} elementos H1.`,
      "Usa un único H1 que describa el propósito de la página; el resto, H2 y H3.",
      `${WCAG}#info-and-relationships`
    )
  );

  const headingLevels = $("h1, h2, h3, h4, h5, h6")
    .toArray()
    .map((el) => Number(el.tagName.slice(1)));
  let skipped: string | null = null;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) {
      skipped = `H${headingLevels[i - 1]} seguido de H${headingLevels[i]}`;
      break;
    }
  }
  checks.push(
    check(
      "a11y-heading-order",
      "Los encabezados no saltan niveles",
      "minor",
      2,
      skipped === null,
      skipped ? `Salto detectado: ${skipped}.` : "La jerarquía de encabezados es continua.",
      "No saltes niveles: después de un H2 viene un H3, no un H4.",
      `${WCAG}#info-and-relationships`
    )
  );

  // --- 3.3.2 Labels or instructions --------------------------------------
  const inputs = $("input, select, textarea")
    .toArray()
    .filter((el) => {
      const type = $(el).attr("type")?.toLowerCase();
      return type !== "hidden" && type !== "submit" && type !== "button";
    });

  const unlabelled = inputs.filter((el) => {
    const $el = $(el);
    if ($el.attr("aria-label")?.trim()) return false;
    if ($el.attr("aria-labelledby")?.trim()) return false;
    if ($el.attr("title")?.trim()) return false;
    const id = $el.attr("id");
    if (id && $(`label[for="${id}"]`).length > 0) return false;
    // A control wrapped in its own <label> is labelled too.
    return $el.parents("label").length === 0;
  });

  checks.push(
    check(
      "a11y-form-labels",
      "Los campos de formulario tienen etiqueta",
      "critical",
      5,
      unlabelled.length === 0,
      inputs.length === 0
        ? "La página no tiene campos de formulario."
        : `${unlabelled.length} de ${inputs.length} campos sin etiqueta asociada.`,
      "Asocia cada campo con un <label for> o dale un aria-label. Un placeholder no es una etiqueta.",
      `${WCAG}#labels-or-instructions`
    )
  );

  // --- 2.4.4 Link purpose ------------------------------------------------
  const links = $("a[href]").toArray();
  const emptyLinks = links.filter((el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text.length > 0) return false;
    if ($el.attr("aria-label")?.trim()) return false;
    if ($el.attr("title")?.trim()) return false;
    // An icon link is fine if the image inside carries the alt text.
    return $el.find("img[alt]").filter((_, img) => Boolean($(img).attr("alt")?.trim())).length === 0;
  });

  checks.push(
    check(
      "a11y-link-text",
      "Los enlaces tienen texto perceptible",
      "serious",
      3,
      emptyLinks.length === 0,
      links.length === 0
        ? "La página no tiene enlaces."
        : `${emptyLinks.length} de ${links.length} enlaces sin texto ni alternativa accesible.`,
      "Da texto visible al enlace, o un aria-label si es un icono.",
      `${WCAG}#link-purpose-in-context`
    )
  );

  // --- 2.4.2 Page titled -------------------------------------------------
  const title = $("title").first().text().trim();
  checks.push(
    check(
      "a11y-title",
      "La página tiene título",
      "serious",
      2,
      title.length > 0,
      title ? `Título: "${title}".` : "La página no tiene <title>.",
      "Añade un <title> descriptivo y único por página.",
      `${WCAG}#page-titled`
    )
  );

  // --- 1.4.4 Resize text -------------------------------------------------
  const viewport = $('meta[name="viewport"]').attr("content") ?? "";
  const blocksZoom = /user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport);
  checks.push(
    check(
      "a11y-zoom",
      "El usuario puede ampliar la página",
      "serious",
      3,
      !blocksZoom,
      blocksZoom
        ? `El meta viewport impide ampliar: "${viewport}".`
        : "El zoom no está bloqueado.",
      "Quita user-scalable=no y maximum-scale=1 del meta viewport.",
      `${WCAG}#resize-text`
    )
  );

  // --- 4.1.2 Name, role, value ------------------------------------------
  const buttons = $("button").toArray();
  const namelessButtons = buttons.filter((el) => {
    const $el = $(el);
    if ($el.text().trim().length > 0) return false;
    if ($el.attr("aria-label")?.trim()) return false;
    if ($el.attr("title")?.trim()) return false;
    return $el.find("img[alt]").filter((_, img) => Boolean($(img).attr("alt")?.trim())).length === 0;
  });

  checks.push(
    check(
      "a11y-button-name",
      "Los botones tienen nombre accesible",
      "serious",
      3,
      namelessButtons.length === 0,
      buttons.length === 0
        ? "La página no tiene elementos <button>."
        : `${namelessButtons.length} de ${buttons.length} botones sin nombre accesible.`,
      "Da texto al botón o un aria-label que describa qué hace.",
      `${WCAG}#name-role-value`
    )
  );

  // --- 1.3.1 Landmarks ---------------------------------------------------
  const hasMain = $("main, [role='main']").length > 0;
  const hasNav = $("nav, [role='navigation']").length > 0;
  checks.push(
    check(
      "a11y-landmarks",
      "La página usa regiones semánticas",
      "moderate",
      2,
      hasMain && hasNav,
      `main: ${hasMain ? "sí" : "no"}, nav: ${hasNav ? "sí" : "no"}.`,
      "Envuelve el contenido principal en <main> y la navegación en <nav>: permite saltar directamente al contenido.",
      `${WCAG}#info-and-relationships`
    )
  );

  // --- What HTML alone cannot answer -------------------------------------
  // Reported rather than guessed. Contrast in particular is the single most
  // common real failure, and asserting it from markup would be a lie.
  for (const [id, label, missing] of [
    ["a11y-contrast", "Contraste de texto (AA 4.5:1)", "Requiere estilos calculados sobre la página renderizada."],
    ["a11y-focus", "Estados de foco visibles", "Requiere renderizar y recorrer la página con el teclado."],
    ["a11y-keyboard", "Navegación completa por teclado", "Requiere interacción real, no solo el HTML servido."],
  ] as const) {
    checks.push({
      id,
      dimension: "accessibility",
      label,
      status: "NO_EVALUABLE",
      severity: "serious",
      weight: 0,
      evidence: "No comprobado.",
      missing,
      reference: WCAG,
    });
  }

  return checks;
}
