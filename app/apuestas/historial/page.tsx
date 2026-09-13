import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { loadHistory, RESULT_LABEL, summarizeHistory, type BetResult } from "@/lib/betting/history";
import { Nav } from "../Nav";
import { ProvenanceTag } from "../ProvenanceBanner";
import { Metric } from "../ui";
import { settleBetAction } from "./actions";

export const metadata: Metadata = {
  title: "Historial de apuestas",
  description: "Qué recomendó el sistema, a qué cuota, con qué resultado y cuánto ganó o perdió.",
};

export const dynamic = "force-dynamic";

const RESULT_TONE: Record<BetResult, "good" | "critical" | "neutral" | "warning"> = {
  ganada: "good",
  perdida: "critical",
  nula: "neutral",
  pendiente: "warning",
};

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

function dateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export default async function HistorialPage() {
  const entries = await loadHistory();
  const summary = summarizeHistory(entries);
  const newestFirst = [...entries].reverse();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text-primary">Historial</h1>
        <Nav active="/apuestas/historial" />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Apuestas resueltas" value={String(summary.settled)} hint={`${summary.pending} pendientes`} />
        <Metric
          label="Acierto"
          value={summary.settled > 0 ? pct(summary.hitRate) : "—"}
          hint={`${summary.wins} ganadas / ${summary.losses} perdidas`}
        />
        <Metric
          label="Beneficio"
          value={`${summary.profitEur >= 0 ? "+" : ""}${summary.profitEur.toFixed(2)} €`}
          tone={summary.profitEur > 0 ? "good" : summary.profitEur < 0 ? "bad" : "neutral"}
          hint={`${summary.stakedEur.toFixed(2)} € apostados`}
        />
        <Metric
          label="ROI"
          value={summary.stakedEur > 0 ? pct(summary.roi, 2) : "—"}
          tone={summary.roi > 0 ? "good" : summary.roi < 0 ? "bad" : "neutral"}
          hint={summary.averageOdds > 0 ? `Cuota media ${summary.averageOdds.toFixed(2)}` : undefined}
        />
      </div>

      {summary.demoExcluded > 0 ? (
        <p className="rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          {summary.demoExcluded} {summary.demoExcluded === 1 ? "apuesta DEMO está" : "apuestas DEMO están"} en el
          historial y <strong>no cuentan</strong> en el beneficio, el ROI ni el acierto de arriba. Un resultado
          inventado no puede formar parte de tu balance real.
        </p>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-primary">Apuestas registradas</h2>
          {entries.length === 0 ? (
            <p className="rounded-lg border border-border-hairline bg-surface-0 p-4 text-sm text-text-secondary">
              Todavía no hay nada. Ejecuta{" "}
              <code className="rounded bg-surface-1 px-1.5 py-0.5">npm run apuestas:generar</code> para registrar
              las recomendaciones actuales.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                    <th className="pb-2 pr-3 font-medium">Origen</th>
                    <th className="pb-2 pr-3 font-medium">Partido</th>
                    <th className="pb-2 pr-3 font-medium">Mercado</th>
                    <th className="pb-2 pr-3 font-medium">Apuesta</th>
                    <th className="pb-2 pr-3 text-right font-medium">Cuota</th>
                    <th className="pb-2 pr-3 text-right font-medium">Stake</th>
                    <th className="pb-2 pr-3 font-medium">Casa</th>
                    <th className="pb-2 pr-3 font-medium">Recomendada</th>
                    <th className="pb-2 pr-3 font-medium">Resultado</th>
                    <th className="pb-2 pr-3 text-right font-medium">P&amp;L</th>
                    <th className="pb-2 font-medium">Marcar</th>
                  </tr>
                </thead>
                <tbody>
                  {newestFirst.map((entry) => (
                    <tr key={entry.id} className="border-b border-border-hairline/60">
                      <td className="py-2.5 pr-3">
                        <ProvenanceTag provenance={entry.overallProvenance} />
                      </td>
                      <td className="py-2.5 pr-3 text-text-primary">{entry.event}</td>
                      <td className="py-2.5 pr-3 text-text-secondary">{entry.market}</td>
                      <td className="py-2.5 pr-3 text-text-primary">{entry.selection}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-text-primary">
                        {entry.odds.toFixed(2)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                        {entry.stakeEur.toFixed(2)} €
                      </td>
                      <td className="py-2.5 pr-3 text-text-secondary">{entry.bookmaker}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-text-muted">
                        {dateTime(entry.recommendedAt)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={RESULT_TONE[entry.result]}>{RESULT_LABEL[entry.result]}</Badge>
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right tabular-nums font-medium ${
                          entry.profitEur > 0
                            ? "text-status-good"
                            : entry.profitEur < 0
                              ? "text-status-critical"
                              : "text-text-muted"
                        }`}
                      >
                        {entry.result === "pendiente"
                          ? "—"
                          : `${entry.profitEur >= 0 ? "+" : ""}${entry.profitEur.toFixed(2)} €`}
                      </td>
                      <td className="py-2.5">
                        <form action={settleBetAction} className="flex flex-wrap gap-1">
                          <input type="hidden" name="id" value={entry.id} />
                          {(["ganada", "perdida", "nula", "pendiente"] as BetResult[]).map((result) => (
                            <button
                              key={result}
                              type="submit"
                              name="result"
                              value={result}
                              disabled={entry.result === result}
                              className="rounded border border-border-hairline px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
                            >
                              {RESULT_LABEL[result]}
                            </button>
                          ))}
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
