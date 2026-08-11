import type { Business } from "@/lib/database/types";
import type { AIProvider, DemoCopy } from "@/lib/ai/provider";

export interface DemoContent {
  copy: DemoCopy;
  business: {
    name: string;
    category: string | null;
    city: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website_url: string | null;
  };
  reviews: { rating: number | null; review_count: number | null };
  gallery_placeholder: true;
  testimonials_placeholder: true;
}

/**
 * Assembles demo page content from real business data only. The AI
 * (DemoCopy) is used strictly for headline/subheadline/about/CTA text —
 * every structural field (name, contact, address, reviews) is copied
 * verbatim from the database, never generated. See brief §17: no
 * inventar dirección, teléfono, servicios, precios, historia o
 * testimonios; usar placeholders cuando falten datos.
 */
export async function generateDemo(ai: AIProvider, business: Business): Promise<DemoContent> {
  const copy = await ai.generateDemoCopy({ business });

  return {
    copy,
    business: {
      name: business.name,
      category: business.category,
      city: business.city,
      address: business.address,
      phone: business.phone,
      email: business.email,
      website_url: business.website_url,
    },
    reviews: { rating: business.rating, review_count: business.review_count },
    gallery_placeholder: true,
    testimonials_placeholder: true,
  };
}
