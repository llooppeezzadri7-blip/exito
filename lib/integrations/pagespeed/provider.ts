import { env, hasPageSpeed } from "@/lib/config/env";
import { ProviderNotConfiguredError } from "@/lib/integrations/business-sources/types";

export interface PageSpeedResult {
  performanceScore: number; // 0-100
  coreWebVitals: {
    largestContentfulPaintMs?: number;
    totalBlockingTimeMs?: number;
    cumulativeLayoutShift?: number;
  };
  strategy: "mobile" | "desktop";
}

/**
 * Google PageSpeed Insights API v5 connector — implemented but inactive
 * until GOOGLE_PAGESPEED_API_KEY is set (free tier available, see
 * ENVIRONMENT.md). Endpoint verified against
 * developers.google.com/speed/docs/insights/v5/get-started:
 *   GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed
 *       ?url=<url>&key=<key>&strategy=mobile|desktop&category=performance
 *   lighthouseResult.categories.performance.score (0-1)
 *   lighthouseResult.audits['largest-contentful-paint' | 'total-blocking-time' | 'cumulative-layout-shift']
 */
export class PageSpeedProvider {
  get isActive() {
    return hasPageSpeed;
  }

  async analyze(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<PageSpeedResult> {
    if (!hasPageSpeed) {
      throw new ProviderNotConfiguredError("Google PageSpeed Insights API", ["GOOGLE_PAGESPEED_API_KEY"]);
    }

    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("key", env.GOOGLE_PAGESPEED_API_KEY!);
    endpoint.searchParams.set("strategy", strategy);
    endpoint.searchParams.set("category", "performance");

    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`PageSpeed Insights API error: ${res.status}`);
    const data = await res.json();

    const perfScore = data?.lighthouseResult?.categories?.performance?.score;
    const audits = data?.lighthouseResult?.audits ?? {};

    return {
      performanceScore: typeof perfScore === "number" ? Math.round(perfScore * 100) : 0,
      coreWebVitals: {
        largestContentfulPaintMs: audits["largest-contentful-paint"]?.numericValue,
        totalBlockingTimeMs: audits["total-blocking-time"]?.numericValue,
        cumulativeLayoutShift: audits["cumulative-layout-shift"]?.numericValue,
      },
      strategy,
    };
  }
}
