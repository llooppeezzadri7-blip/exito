import { Badge } from "@/components/ui/Badge";
import type { ConfidenceLevel, Recommendation } from "@/lib/betting/recommendations";
import { CONFIDENCE_LABEL, PROBABILITY_SOURCE_LABEL } from "@/lib/betting/recommendations";
import { ProvenanceTag } from "./ProvenanceBanner";

const CONFIDENCE_TONE: Record<ConfidenceLevel, "good" | "warning" | "serious" | "neutral"> = {
  alta: "good",
  media: "warning",
  baja: "serious",
  ninguna: "neutral",
};

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

function dateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function time(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(date);
}

/**
 * Every field the dashboard promises, in one row per bet, ordered by expected
 * value. The provenance tag is the first column on purpose.
 */
export function RecommendationsTable({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <p className="rounded-lg border border-border-hairline bg-surface-0 p-4 text-sm text-text-secondary">
        No hay ninguna apuesta recomendada ahora mismo.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-sm">
        <thead>
          <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
            <th className="pb-2 pr-3 font-medium">Origen</th>
            <th className="pb-2 pr-3 font-medium">Partido</th>
            <th className="pb-2 pr-3 font-medium">Deporte</th>
            <th className="pb-2 pr-3 font-medium">Fecha y hora</th>
            <th className="pb-2 pr-3 font-medium">Mercado</th>
            <th className="pb-2 pr-3 font-medium">Apuesta</th>
            <th className="pb-2 pr-3 text-right font-medium">Cuota</th>
            <th className="pb-2 pr-3 text-right font-medium">Implícita</th>
            <th className="pb-2 pr-3 text-right font-medium">Estimada</th>
            <th className="pb-2 pr-3 text-right font-medium">Valor</th>
            <th className="pb-2 pr-3 text-right font-medium">Stake</th>
            <th className="pb-2 pr-3 font-medium">Confianza</th>
            <th className="pb-2 pr-3 font-medium">Fuente</th>
            <th className="pb-2 font-medium">Actualizada</th>
          </tr>
        </thead>
        <tbody>
          {recommendations.map((rec) => (
            <tr key={rec.id} className="border-b border-border-hairline/60 align-top">
              <td className="py-2.5 pr-3">
                <ProvenanceTag provenance={rec.overallProvenance} />
              </td>
              <td className="py-2.5 pr-3 text-text-primary">
                {rec.event}
                <div className="text-xs text-text-muted">{rec.competition}</div>
              </td>
              <td className="py-2.5 pr-3 text-text-secondary">{rec.sport}</td>
              <td className="py-2.5 pr-3 whitespace-nowrap text-text-secondary">{dateTime(rec.commenceTime)}</td>
              <td className="py-2.5 pr-3 text-text-secondary">{rec.market}</td>
              <td className="py-2.5 pr-3 font-medium text-text-primary">{rec.selection}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-text-primary">
                {rec.odds.toFixed(2)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                {pct(rec.impliedProbability)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                {pct(rec.estimatedProbability)}
              </td>
              <td
                className={`py-2.5 pr-3 text-right tabular-nums font-medium ${
                  rec.edge > 0 ? "text-status-good" : "text-status-critical"
                }`}
              >
                {rec.edge > 0 ? "+" : ""}
                {pct(rec.edge, 2)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                {rec.stakeEur > 0 ? `${rec.stakeEur.toFixed(2)} €` : "—"}
              </td>
              <td className="py-2.5 pr-3">
                <Badge tone={CONFIDENCE_TONE[rec.confidence]}>{CONFIDENCE_LABEL[rec.confidence]}</Badge>
              </td>
              <td className="py-2.5 pr-3 text-text-secondary">
                {rec.bookmaker}
                <div className="text-xs text-text-muted">{rec.source}</div>
              </td>
              <td className="py-2.5 whitespace-nowrap text-xs text-text-muted">{time(rec.fetchedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-col gap-2">
        {recommendations.map((rec) => (
          <div key={`${rec.id}-detail`} className="rounded-lg border border-border-hairline bg-surface-0 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceTag provenance={rec.overallProvenance} />
              <span className="font-medium text-text-primary">
                {rec.event} · {rec.market} · {rec.selection}
              </span>
              <span className={rec.bettable ? "text-status-good" : "text-status-critical"}>
                {rec.bettable ? "Apostable" : "NO apostable"}
              </span>
            </div>
            <p className="mt-1.5 text-text-secondary">
              <strong className="text-text-primary">Resultado del análisis:</strong> {rec.verdict}
            </p>
            <p className="mt-1 text-text-secondary">
              <strong className="text-text-primary">Probabilidad</strong> (
              {PROBABILITY_SOURCE_LABEL[rec.probabilitySource]}): {rec.probabilityBasis}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
