import type { CheerioAPI } from "cheerio";
import type { AuditCheck } from "./types";

/**
 * W1 — structured data validation.
 *
 * The existing scanner extracts `@type` values, which answers "does it have
 * schema" but not "is the schema any good". Google only produces a rich
 * result when the required properties are present, so a page can carry a
 * perfectly formed LocalBusiness block and still be invisible in the rich
 * results it was written for.
 *
 * Required properties come from Google's structured-data documentation, not
 * from Schema.org's full vocabulary: Schema.org marks almost everything
 * optional, while Google's requirements are what actually gate eligibility.
 * Cited per type so the claim is checkable.
 */

const GOOGLE_DOCS = "https://developers.google.com/search/docs/appearance/structured-data";

interface TypeRequirement {
  /** Properties Google requires for the rich result. */
  required: string[];
  /** Properties that materially improve the result without being required. */
  recommended: string[];
  reference: string;
}

const REQUIREMENTS: Record<string, TypeRequirement> = {
  LocalBusiness: {
    required: ["name", "address"],
    recommended: ["telephone", "openingHours", "geo", "url", "image", "priceRange"],
    reference: `${GOOGLE_DOCS}/local-business`,
  },
  Restaurant: {
    required: ["name", "address"],
    recommended: ["telephone", "openingHours", "servesCuisine", "menu", "priceRange", "geo", "image"],
    reference: `${GOOGLE_DOCS}/local-business`,
  },
  Hotel: {
    required: ["name", "address"],
    recommended: ["telephone", "priceRange", "starRating", "image", "geo"],
    reference: `${GOOGLE_DOCS}/local-business`,
  },
  Organization: {
    required: ["name"],
    recommended: ["url", "logo", "sameAs", "contactPoint"],
    reference: `${GOOGLE_DOCS}/organization`,
  },
  Product: {
    required: ["name"],
    recommended: ["image", "description", "offers", "aggregateRating", "brand"],
    reference: `${GOOGLE_DOCS}/product`,
  },
  Service: {
    required: ["name"],
    recommended: ["provider", "areaServed", "description"],
    reference: `${GOOGLE_DOCS}/local-business`,
  },
  Article: {
    required: ["headline"],
    recommended: ["image", "datePublished", "dateModified", "author"],
    reference: `${GOOGLE_DOCS}/article`,
  },
  BreadcrumbList: {
    required: ["itemListElement"],
    recommended: [],
    reference: `${GOOGLE_DOCS}/breadcrumb`,
  },
  FAQPage: {
    required: ["mainEntity"],
    recommended: [],
    reference: `${GOOGLE_DOCS}/faqpage`,
  },
  WebSite: {
    required: ["name", "url"],
    recommended: ["potentialAction"],
    reference: `${GOOGLE_DOCS}/sitelinks-searchbox`,
  },
};

export interface ParsedSchemaNode {
  type: string;
  properties: string[];
  raw: Record<string, unknown>;
}

export interface StructuredDataReport {
  blocks: number;
  /** Blocks that were not valid JSON at all. */
  malformed: number;
  nodes: ParsedSchemaNode[];
  checks: AuditCheck[];
}

/** Flattens @graph and nested arrays so a node is found wherever it sits. */
function collectNodes(value: unknown, out: ParsedSchemaNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;

  const node = value as Record<string, unknown>;

  if (Array.isArray(node["@graph"])) {
    collectNodes(node["@graph"], out);
  }

  const rawType = node["@type"];
  const types = typeof rawType === "string" ? [rawType] : Array.isArray(rawType) ? rawType : [];

  for (const type of types) {
    if (typeof type !== "string") continue;
    out.push({
      type,
      properties: Object.keys(node).filter((key) => !key.startsWith("@")),
      raw: node,
    });
  }
}

export function analyzeStructuredData($: CheerioAPI): StructuredDataReport {
  const scripts = $('script[type="application/ld+json"]');
  const nodes: ParsedSchemaNode[] = [];
  let malformed = 0;

  scripts.each((_, el) => {
    try {
      collectNodes(JSON.parse($(el).text()), nodes);
    } catch {
      malformed += 1;
    }
  });

  const checks: AuditCheck[] = [];

  checks.push({
    id: "schema-present",
    dimension: "technical_seo",
    label: "La página incluye datos estructurados",
    status: nodes.length > 0 ? "PASS" : "FAIL",
    severity: "moderate",
    weight: 3,
    evidence:
      nodes.length > 0
        ? `${nodes.length} nodo(s): ${[...new Set(nodes.map((n) => n.type))].join(", ")}.`
        : "No se encontró ningún bloque JSON-LD válido.",
    ...(nodes.length === 0
      ? {
          fix: "Añade JSON-LD con el tipo que corresponda al negocio (LocalBusiness, Restaurant, Hotel…).",
        }
      : {}),
    reference: GOOGLE_DOCS,
  });

  if (scripts.length > 0) {
    checks.push({
      id: "schema-parses",
      dimension: "technical_seo",
      label: "Los bloques JSON-LD son JSON válido",
      status: malformed === 0 ? "PASS" : "FAIL",
      severity: "serious",
      weight: 3,
      evidence:
        malformed === 0
          ? `Los ${scripts.length} bloque(s) parsean correctamente.`
          : `${malformed} de ${scripts.length} bloque(s) no son JSON válido, así que Google los ignora por completo.`,
      ...(malformed > 0 ? { fix: "Corrige el JSON: un bloque malformado se descarta entero, no parcialmente." } : {}),
      reference: GOOGLE_DOCS,
    });
  }

  // Per-type completeness. Only types we have documented requirements for —
  // inventing requirements for an unknown type would be worse than silence.
  const seen = new Set<string>();
  for (const node of nodes) {
    const requirement = REQUIREMENTS[node.type];
    if (!requirement || seen.has(node.type)) continue;
    seen.add(node.type);

    const missingRequired = requirement.required.filter((prop) => !node.properties.includes(prop));
    const missingRecommended = requirement.recommended.filter((prop) => !node.properties.includes(prop));

    checks.push({
      id: `schema-${node.type.toLowerCase()}-required`,
      dimension: "technical_seo",
      label: `${node.type}: propiedades obligatorias`,
      status: missingRequired.length === 0 ? "PASS" : "FAIL",
      severity: "serious",
      weight: 3,
      evidence:
        missingRequired.length === 0
          ? `Están las ${requirement.required.length} propiedades que Google exige (${requirement.required.join(", ")}).`
          : `Faltan: ${missingRequired.join(", ")}. Sin ellas no hay resultado enriquecido.`,
      ...(missingRequired.length > 0
        ? { fix: `Añade ${missingRequired.join(", ")} al bloque ${node.type}.` }
        : {}),
      reference: requirement.reference,
    });

    if (requirement.recommended.length > 0) {
      checks.push({
        id: `schema-${node.type.toLowerCase()}-recommended`,
        dimension: "technical_seo",
        label: `${node.type}: propiedades recomendadas`,
        status: missingRecommended.length === 0 ? "PASS" : "WARN",
        severity: "minor",
        weight: 1,
        evidence:
          missingRecommended.length === 0
            ? "Incluye todas las propiedades recomendadas."
            : `Faltan ${missingRecommended.length}: ${missingRecommended.join(", ")}.`,
        ...(missingRecommended.length > 0
          ? { fix: `Considera añadir ${missingRecommended.slice(0, 4).join(", ")} para un resultado más completo.` }
          : {}),
        reference: requirement.reference,
      });
    }
  }

  return { blocks: scripts.length, malformed, nodes, checks };
}

/** Types this validator knows how to check, for the report's limitations. */
export const VALIDATED_TYPES = Object.keys(REQUIREMENTS);
