import { describe, expect, it } from "vitest";
import { computeScores } from "./compute-scores";
import { computeOpportunityScore } from "./opportunity-score";
import { computeBuyingIntentScore } from "./buying-intent-score";
import type { Business, Settings, WebsiteScan } from "@/lib/database/types";

const WEIGHTS: Settings["scoring_weights"] = {
  opportunity: {
    website_quality: 0.2,
    seo: 0.2,
    local_seo: 0.15,
    performance: 0.1,
    mobile_ux: 0.1,
    conversion: 0.15,
    competitive_gap: 0.1,
  },
  lead_score: { opportunity: 0.35, buying_intent: 0.35, business_value: 0.15, competitive_gap: 0.15 },
};

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: "b1",
    owner_id: "o1",
    name: "Test Business",
    category: null,
    sector: null,
    address: null,
    city: null,
    region: null,
    postal_code: null,
    country: "España",
    phone: null,
    website_url: "https://example.com",
    email: null,
    social_links: {},
    gbp_place_id: null,
    rating: null,
    review_count: null,
    opening_hours: null,
    latitude: null,
    longitude: null,
    source: "csv_import",
  corroborating_sources: [],
  verification_status: "PROBABLE",
    source_job_id: null,
    last_analyzed_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeScan(overrides: Partial<WebsiteScan> = {}): WebsiteScan {
  return {
    id: "s1",
    website_id: "w1",
    business_id: "b1",
    status: "completed",
    source: "internal-scanner",
    technical: {
      https: true,
      schema_markup_present: true,
      robots_txt_present: true,
      sitemap_present: true,
      canonical_present: true,
      image_count: 10,
      images_missing_alt: 0,
      html_size_bytes: 500_000,
      has_viewport_meta: true,
    },
    seo: {
      title: "A good title between 10 and 65 chars",
      title_length: 38,
      meta_description: "A meta description with a reasonable length between fifty and one sixty characters total.",
      meta_description_length: 90,
      h1_count: 1,
      word_count_estimate: 600,
      internal_link_count: 10,
    },
    conversion: {
      has_phone_link: true,
      has_whatsapp_link: true,
      has_contact_form: true,
      cta_mentions_count: 3,
      has_testimonials_section: true,
    },
    design: {},
    performance: { lighthouse_performance_score: 90 },
    unavailable_metrics: [],
    scanned_at: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

describe("computeOpportunityScore", () => {
  it("gives maximum website_quality opportunity when there is no website", () => {
    const result = computeOpportunityScore({ business: makeBusiness({ website_url: null }), scan: null, weights: WEIGHTS });
    expect(result.breakdown.website_quality.value).toBe(100);
  });

  it("scores a technically solid site low on website_quality/seo/conversion opportunity", () => {
    const result = computeOpportunityScore({ business: makeBusiness(), scan: makeScan(), weights: WEIGHTS });
    expect(result.breakdown.website_quality.value).toBeLessThan(20);
    expect(result.breakdown.seo.value).toBeLessThan(20);
    expect(result.breakdown.conversion.value).toBeLessThan(20);
  });

  it("scores a broken/thin site high on opportunity", () => {
    const badScan = makeScan({
      technical: { https: false, schema_markup_present: false, robots_txt_present: false, sitemap_present: false, canonical_present: false, image_count: 20, images_missing_alt: 20, html_size_bytes: 5_000_000, has_viewport_meta: false },
      seo: { title: null, title_length: 0, meta_description: null, meta_description_length: 0, h1_count: 0, word_count_estimate: 50, internal_link_count: 0 },
      conversion: { has_phone_link: false, has_whatsapp_link: false, has_contact_form: false, cta_mentions_count: 0, has_testimonials_section: false },
    });
    const result = computeOpportunityScore({ business: makeBusiness(), scan: badScan, weights: WEIGHTS });
    expect(result.breakdown.website_quality.value).toBeGreaterThanOrEqual(80);
    expect(result.breakdown.seo.value).toBeGreaterThanOrEqual(80);
    expect(result.breakdown.conversion.value).toBeGreaterThanOrEqual(80);
    expect(result.score).toBeGreaterThan(70);
  });

  it("never exceeds 100 or goes below 0 regardless of inputs", () => {
    const badScan = makeScan({
      technical: { https: false, schema_markup_present: false, robots_txt_present: false, sitemap_present: false, canonical_present: false, image_count: 100, images_missing_alt: 100, html_size_bytes: 10_000_000, has_viewport_meta: false },
    });
    const result = computeOpportunityScore({ business: makeBusiness({ rating: 1, review_count: 0 }), scan: badScan, weights: WEIGHTS });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("computeBuyingIntentScore", () => {
  it("scores highest when there is no website at all", () => {
    const withSite = computeBuyingIntentScore({ business: makeBusiness(), scan: makeScan(), weights: WEIGHTS });
    const withoutSite = computeBuyingIntentScore({ business: makeBusiness({ website_url: null }), scan: null, weights: WEIGHTS });
    expect(withoutSite.score).toBeGreaterThan(withSite.score);
  });

  it("flags high review count + poor web presence as a distinct signal", () => {
    const badScan = makeScan({ technical: { ...makeScan().technical, https: false }, seo: { ...makeScan().seo, title: null } });
    const result = computeBuyingIntentScore({
      business: makeBusiness({ review_count: 200 }),
      scan: badScan,
      weights: WEIGHTS,
    });
    const triggered = result.signals.find((s) => s.label.includes("reputación offline"));
    expect(triggered?.triggered).toBe(true);
  });
});

describe("computeScores", () => {
  it("keeps opportunity, buying intent and lead score independent (not the same number)", () => {
    const result = computeScores({ business: makeBusiness({ website_url: null }), scan: null, weights: WEIGHTS });
    expect(result.opportunity_score).not.toBe(result.buying_intent_score);
  });

  it("respects custom weights (e.g. zeroing out SEO removes its influence)", () => {
    const zeroSeoWeights: Settings["scoring_weights"] = {
      ...WEIGHTS,
      opportunity: { ...WEIGHTS.opportunity, seo: 0, website_quality: WEIGHTS.opportunity.website_quality + WEIGHTS.opportunity.seo },
    };
    const badSeoScan = makeScan({ seo: { title: null, title_length: 0, meta_description: null, meta_description_length: 0, h1_count: 0, word_count_estimate: 0, internal_link_count: 0 } });

    const withDefaultWeights = computeOpportunityScore({ business: makeBusiness(), scan: badSeoScan, weights: WEIGHTS });
    const withZeroSeoWeight = computeOpportunityScore({ business: makeBusiness(), scan: badSeoScan, weights: zeroSeoWeights });

    expect(withZeroSeoWeight.score).toBeLessThan(withDefaultWeights.score);
  });
});
