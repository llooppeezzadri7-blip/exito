import { DemoOddsProvider } from "./demo";
import { TheOddsApiProvider } from "./the-odds-api";
import type { OddsProvider } from "./types";

export * from "./types";
export { DemoOddsProvider } from "./demo";
export { TheOddsApiProvider } from "./the-odds-api";

export interface ProviderResolution {
  provider: OddsProvider;
  /** True when a real source is configured and will be used. */
  usingRealData: boolean;
  /** Explains what is active and, if on demo, what to connect. */
  notice: string;
}

/**
 * Pick the odds provider.
 *
 * Real source when ODDS_API_KEY is set; otherwise the demo provider, and the
 * caller is told exactly what is missing. This never throws and never silently
 * substitutes demo data for real — `usingRealData` and every row's provenance
 * say which is which.
 */
export function resolveOddsProvider(
  apiKey = process.env.ODDS_API_KEY,
  region = process.env.ODDS_API_REGION
): ProviderResolution {
  const real = new TheOddsApiProvider(apiKey, region || "eu");

  if (real.isConfigured()) {
    return {
      provider: real,
      usingRealData: true,
      notice: `Cuotas reales vía ${real.name} (región ${region || "eu"}).`,
    };
  }

  return {
    provider: new DemoOddsProvider(),
    usingRealData: false,
    notice: `Sin cuotas reales. ${real.configurationHint()}`,
  };
}
