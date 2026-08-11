import type { BuyingIntentResult, ScoringInput } from "./types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

// Illustrative high-LTV sectors for an agency like this one. Intentionally a
// small hardcoded seed, not settings-driven yet — see ROADMAP.md: wiring
// this to settings.pricing per sector is future work.
const HIGH_VALUE_SECTORS = ["Hoteles", "Clínicas dentales", "Restaurantes"];

/**
 * "How likely is this business to need/buy our services now" — kept
 * strictly separate from the Opportunity Score (how much room there is to
 * improve). See ARCHITECTURE.md §5 / brief §12.
 */
export function computeBuyingIntentScore(input: ScoringInput): BuyingIntentResult {
  const { business, scan } = input;

  const signals: BuyingIntentResult["signals"] = [
    { label: "No tiene web", weight: 35, triggered: !business.website_url },
  ];

  if (scan) {
    signals.push(
      { label: "La web no usa HTTPS", weight: 10, triggered: scan.technical.https !== true },
      {
        label: "SEO on-page muy pobre (sin title o sin meta description)",
        weight: 10,
        triggered: !scan.seo.title || !scan.seo.meta_description,
      },
      {
        label: "Sin ninguna vía de contacto clara (teléfono, WhatsApp o formulario)",
        weight: 15,
        triggered:
          scan.conversion.has_phone_link !== true &&
          scan.conversion.has_whatsapp_link !== true &&
          scan.conversion.has_contact_form !== true,
      },
      { label: "Web no responsive (sin viewport)", weight: 10, triggered: scan.technical.has_viewport_meta !== true },
      {
        label: "Muchas reseñas pero presencia web deficiente — reputación offline desaprovechada online",
        weight: 15,
        triggered:
          (business.review_count ?? 0) > 50 && (scan.technical.https !== true || !scan.seo.title),
      }
    );
  }

  signals.push({
    label: "Sector de alto valor por cliente",
    weight: 5,
    triggered: Boolean(business.sector && HIGH_VALUE_SECTORS.includes(business.sector)),
  });

  const score = clamp(signals.filter((s) => s.triggered).reduce((sum, s) => sum + s.weight, 0));
  return { score: Math.round(score), signals };
}
