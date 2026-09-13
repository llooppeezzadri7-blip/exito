import { demoEstimates, devigEstimates } from "./estimates";
import { LA_LIGA, resolveOddsProvider, type OddsSnapshot, type Provenance } from "./providers";
import { analyseQuotes, type AnalysisResult } from "./recommendations";
import { SYSTEM_BAND } from "./sportium";

/**
 * One pass of the whole pipeline: fetch prices, estimate probabilities, screen
 * for value. Shared by the dashboard and the CLI so both show the same thing.
 */

export const RECOMMENDATIONS_PATH = "data/apuestas-recomendadas.json";

export interface GenerateOptions {
  /** Sport key as the provider spells it. */
  sport?: string;
  /** Bankroll for stake sizing, in euros. */
  bankrollEur?: number;
  /** Restrict the fetch to one bookmaker, e.g. "sportium". */
  bookmaker?: string;
  /** Markets to request from the provider. */
  markets?: string[];
  /** Odds band. Pass null to see everything, in or out of band. */
  band?: { min: number; max: number } | null;
}

export interface GenerationResult extends AnalysisResult {
  /** Name of the provider used. */
  source: string;
  sourceProvenance: Provenance;
  usingRealData: boolean;
  /** What is active, or what to connect if nothing real is. */
  notice: string;
  /** Set when the provider failed. */
  error?: string;
  /** Bookmaker used as the reference opinion for de-vigging, if any. */
  referenceBookmaker: string | null;
  /** How the probabilities were produced, in one line. */
  estimateNotice: string;
  quotesFetched: number;
  bankrollEur: number;
}

export async function generateRecommendations(
  options: GenerateOptions = {}
): Promise<GenerationResult> {
  const {
    sport = LA_LIGA,
    bankrollEur = 100,
    bookmaker,
    markets,
    band = SYSTEM_BAND,
  } = options;

  const { provider, usingRealData, notice } = resolveOddsProvider();
  const snapshot: OddsSnapshot = await provider.fetchOdds({ sport, bookmaker, markets });

  const { estimates, referenceBookmaker, estimateNotice } = buildEstimates(snapshot);

  const analysis = analyseQuotes(snapshot.quotes, estimates, {
    bankrollEur,
    band,
    source: snapshot.source,
  });

  return {
    ...analysis,
    source: snapshot.source,
    sourceProvenance: snapshot.provenance,
    usingRealData,
    notice,
    error: snapshot.error,
    referenceBookmaker,
    estimateNotice,
    quotesFetched: snapshot.quotes.length,
    bankrollEur,
  };
}

function buildEstimates(snapshot: OddsSnapshot) {
  if (snapshot.provenance === "demo") {
    return {
      estimates: demoEstimates(snapshot.quotes),
      referenceBookmaker: null,
      estimateNotice:
        "Probabilidades INVENTADAS: el proveedor es DEMO. No sirven para apostar, solo para ver funcionar el sistema.",
    };
  }

  const { estimates, reference } = devigEstimates(snapshot.quotes);
  return {
    estimates,
    referenceBookmaker: reference,
    estimateNotice: reference
      ? `Probabilidades obtenidas quitando el margen a las cuotas de ${reference}, la casa con menos comisión del snapshot.`
      : "No se han podido estimar probabilidades: ningún mercado venía completo para quitarle el margen.",
  };
}
