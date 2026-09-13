"use client";

import { useState, type ChangeEvent } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MIN_SAMPLE, oddsNeededForRoi } from "@/lib/betting/backtest";
import { parseSeasons } from "@/lib/betting/football-data";
import { PLAYBOOK, runPlaybook, type StrategyReport } from "@/lib/betting/playbook";
import { Note, pct } from "./ui";

/**
 * Drop in football-data.co.uk season CSVs and measure the playbook against
 * them. Nothing leaves the browser — the files are parsed locally.
 */
export function BacktestTab() {
  const [reports, setReports] = useState<StrategyReport[] | null>(null);
  const [loaded, setLoaded] = useState<{ matches: number; files: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const contents = await Promise.all(files.map((file) => file.text()));
      const { matches, skipped } = parseSeasons(contents);
      if (matches.length === 0) {
        setError("No se ha podido leer ningún partido. ¿Seguro que son CSV de football-data.co.uk?");
        setReports(null);
        setLoaded(null);
        return;
      }
      setLoaded({ matches: matches.length, files: files.length, skipped });
      setReports(runPlaybook(matches));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error leyendo los ficheros.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-text-primary">Cargar temporadas</h3>
          <p className="text-xs text-text-muted">
            Descarga los CSV de{" "}
            <a
              href="https://www.football-data.co.uk/spainm.php"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-500 underline"
            >
              football-data.co.uk
            </a>{" "}
            (SP1 para LaLiga, E0 para Premier) y suéltalos aquí. Se procesan en tu navegador: no se suben a ningún
            sitio. Cuantas más temporadas, menos ruido.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={handleFiles}
            className="text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-accent-450 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-accent-500"
          />
          {busy ? <p className="text-xs text-text-muted">Procesando…</p> : null}
          {error ? <p className="text-xs text-status-critical">{error}</p> : null}
          {loaded ? (
            <p className="text-xs text-text-secondary">
              {loaded.matches} partidos de {loaded.files} fichero(s). {loaded.skipped} filas descartadas.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {reports ? <Results reports={reports} /> : <Preview />}
    </div>
  );
}

function Preview() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text-primary">Estrategias que se van a medir</h3>
        <p className="text-xs text-text-muted">
          Cada una es una hipótesis, no un resultado. El backtest decide cuáles sobreviven.
        </p>
        <ul className="flex flex-col gap-3">
          {PLAYBOOK.map((strategy) => (
            <li key={strategy.key} className="rounded-lg border border-border-hairline bg-surface-0 p-3">
              <div className="text-sm font-medium text-text-primary">{strategy.label}</div>
              <p className="mt-1 text-xs text-text-secondary">{strategy.rationale}</p>
              {strategy.assumedOdds ? (
                <p className="mt-1.5 text-xs text-status-warning">
                  Cuota asumida {strategy.assumedOdds.toFixed(2)} — el histórico no trae precio para este mercado.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Results({ reports }: { reports: StrategyReport[] }) {
  const passed = reports.filter((r) => r.sampleIsSufficient && r.edgeIsSignificant);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">Resultados</h3>
            <Badge tone={passed.length > 0 ? "good" : "critical"}>
              {passed.length} de {reports.length} sobreviven
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
                  <th className="pb-2 pr-3 font-medium">Estrategia</th>
                  <th className="pb-2 pr-3 text-right font-medium">n</th>
                  <th className="pb-2 pr-3 text-right font-medium">Acierto</th>
                  <th className="pb-2 pr-3 text-right font-medium">IC 95%</th>
                  <th className="pb-2 pr-3 text-right font-medium">Cuota</th>
                  <th className="pb-2 pr-3 text-right font-medium">Necesita</th>
                  <th className="pb-2 pr-3 text-right font-medium">ROI</th>
                  <th className="pb-2 font-medium">Veredicto</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <Row key={report.strategy.key} report={report} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Note>
        Una estrategia solo &quot;sobrevive&quot; si tiene al menos {MIN_SAMPLE} apuestas <em>y</em> el extremo bajo de su
        intervalo de confianza sigue por encima del punto de equilibrio. Con menos que eso, un buen porcentaje es
        indistinguible de la suerte. Las cuotas marcadas como asumidas no son precios reales de Sportium: sustitúyelas
        por precios que hayas visto de verdad antes de creerte el ROI.
      </Note>
    </div>
  );
}

function Row({ report }: { report: StrategyReport }) {
  if (report.settled === 0) {
    return (
      <tr className="border-b border-border-hairline/60">
        <td className="py-2 pr-3 text-text-primary">{report.strategy.label}</td>
        <td className="py-2 pr-3 text-right tabular-nums text-text-muted">0</td>
        <td colSpan={6} className="py-2 text-xs text-text-muted">
          Sin apuestas tras los filtros.
        </td>
      </tr>
    );
  }

  const survives = report.sampleIsSufficient && report.edgeIsSignificant;

  return (
    <tr className="border-b border-border-hairline/60">
      <td className="py-2 pr-3 text-text-primary">
        {report.strategy.label}
        {report.pricesWereAssumed ? (
          <span className="ml-2 text-xs text-status-warning">cuota asumida</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-text-secondary">{report.settled}</td>
      <td className="py-2 pr-3 text-right tabular-nums font-medium text-text-primary">{pct(report.hitRate, 1)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-xs text-text-muted">
        {pct(report.hitRate95.low, 1)} – {pct(report.hitRate95.high, 1)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-text-secondary">{report.averageOdds.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-text-secondary">
        {report.breakEvenOdds.toFixed(2)}
      </td>
      <td
        className={`py-2 pr-3 text-right tabular-nums font-medium ${report.roi > 0 ? "text-status-good" : "text-status-critical"}`}
      >
        {pct(report.roi, 1)}
      </td>
      <td className="py-2 text-xs">
        {survives ? (
          <Badge tone="good">Edge medible</Badge>
        ) : !report.sampleIsSufficient ? (
          <span className="text-text-muted">Muestra corta</span>
        ) : (
          <span className="text-text-muted">
            Indistinguible de la suerte · +5% ROI pediría {oddsNeededForRoi(report.hitRate, 0.05).toFixed(2)}
          </span>
        )}
      </td>
    </tr>
  );
}
