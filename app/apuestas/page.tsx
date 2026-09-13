import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/Card";
import { generateRecommendations, RECOMMENDATIONS_PATH } from "@/lib/betting/generate";
import { HISTORY_PATH } from "@/lib/betting/history";
import { SYSTEM_BAND } from "@/lib/betting/sportium";
import { Nav } from "./Nav";
import { ProvenanceBanner } from "./ProvenanceBanner";
import { RecommendationsTable } from "./RecommendationsTable";
import { Metric } from "./ui";

export const metadata: Metadata = {
  title: "Dashboard de apuestas",
  description: "Apuestas que el sistema considera recomendables, con el origen de cada dato.",
};

// Prices go stale in minutes, so this page is never cached.
export const dynamic = "force-dynamic";

const BANKROLL_EUR = 100;

export default async function DashboardPage() {
  const result = await generateRecommendations({ bankrollEur: BANKROLL_EUR });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-text-primary">Dashboard de apuestas</h1>
          <Nav active="/apuestas" />
        </div>

        <ProvenanceBanner
          provenance={result.overallProvenance}
          notice={result.notice}
          extra={result.estimateNotice}
        />

        {result.error ? (
          <p className="rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
            {result.error}
          </p>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Cuotas leídas" value={String(result.quotesFetched)} hint={result.source} />
        <Metric label="Recomendaciones" value={String(result.recommendations.length)} hint="Ordenadas por valor" />
        <Metric
          label="Apostables de verdad"
          value={String(result.bettableCount)}
          tone={result.bettableCount > 0 ? "good" : "bad"}
          hint="Cuota real + probabilidad real"
        />
        <Metric label="Banca" value={`${BANKROLL_EUR} €`} hint="Kelly 1/4, tope 2%" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-text-primary">Apuestas recomendadas</h2>
            <span className="text-xs text-text-muted">
              Banda del sistema {SYSTEM_BAND.min.toFixed(2)} – {SYSTEM_BAND.max.toFixed(2)} · ordenadas por valor esperado
            </span>
          </div>
          <RecommendationsTable recommendations={result.recommendations} />
        </CardContent>
      </Card>

      {result.unanalysed.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-text-primary">
              Cuotas vistas pero no analizadas ({result.unanalysed.length})
            </h2>
            <p className="text-xs text-text-muted">
              El sistema las ha leído y ha decidido no puntuarlas. No se ocultan: se listan para que sepas qué
              vio y por qué no dijo nada.
            </p>
            <ul className="flex flex-col gap-1.5 text-xs text-text-secondary">
              {result.unanalysed.slice(0, 12).map(({ quote, reason }) => (
                <li key={`${quote.eventId}-${quote.marketKey}-${quote.selection}-${quote.bookmaker}`}>
                  <span className="text-text-primary">
                    {quote.homeTeam} - {quote.awayTeam} · {quote.marketLabel} · {quote.selection} @{" "}
                    {quote.odds.toFixed(2)}
                  </span>{" "}
                  — {reason}
                </li>
              ))}
            </ul>
            {result.unanalysed.length > 12 ? (
              <p className="text-xs text-text-muted">… y {result.unanalysed.length - 12} más.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-2 text-xs leading-relaxed text-text-secondary">
          <h2 className="text-sm font-medium text-text-primary">Dónde vive todo esto</h2>
          <p>
            <strong className="text-text-primary">Generar apuestas:</strong>{" "}
            <code className="rounded bg-surface-0 px-1.5 py-0.5">npm run apuestas:generar</code>
          </p>
          <p>
            <strong className="text-text-primary">Fichero de apuestas:</strong>{" "}
            <code className="rounded bg-surface-0 px-1.5 py-0.5">{RECOMMENDATIONS_PATH}</code>
          </p>
          <p>
            <strong className="text-text-primary">Historial:</strong>{" "}
            <code className="rounded bg-surface-0 px-1.5 py-0.5">data/apuestas-historial.json</code>{" "}
            <span className="text-text-muted">({HISTORY_PATH})</span>
          </p>
          <p>
            <strong className="text-text-primary">Para cuotas reales:</strong> crea una clave gratuita en{" "}
            <a
              href="https://the-odds-api.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-500 underline"
            >
              the-odds-api.com
            </a>{" "}
            y añade <code className="rounded bg-surface-0 px-1.5 py-0.5">ODDS_API_KEY=...</code> a{" "}
            <code className="rounded bg-surface-0 px-1.5 py-0.5">.env.local</code>. Sin esa clave el sistema usa
            datos DEMO y lo dice en cada fila.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
