"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { assessValue, breakEvenOdds, fairOddsForMarket, roiAt } from "@/lib/betting/odds";
import { screenSelection, SYSTEM_BAND } from "@/lib/betting/sportium";
import { closingLineValue, fractionalKellyStake } from "@/lib/betting/staking";
import { Field, Metric, Note, num, pct, Verdict } from "../ui";

/**
 * The gatekeeper screen: does this selection enter the system at all?
 */
export function ValorTab() {
  const [probability, setProbability] = useState("80");
  const [odds, setOdds] = useState("1.32");
  const [bankroll, setBankroll] = useState("1000");
  const [closing, setClosing] = useState("1.30");
  const [sideA, setSideA] = useState("1.30");
  const [sideB, setSideB] = useState("3.40");

  const p = num(probability);
  const o = num(odds);
  const valid = p !== null && p > 0 && p < 100 && o !== null && o > 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Field
            label="Tu probabilidad estimada"
            hint="Lo que tú crees que pasa, no lo que paga la casa."
            value={probability}
            onChange={setProbability}
            step="0.5"
            suffix="%"
          />
          <Field label="Cuota de Sportium" value={odds} onChange={setOdds} step="0.01" min="1.01" />
          <Field label="Bankroll" value={bankroll} onChange={setBankroll} step="10" suffix="€" />
          <Field
            label="Cuota de cierre"
            hint="El precio al que cerró Pinnacle o Betfair. Para medir CLV."
            value={closing}
            onChange={setClosing}
            step="0.01"
            min="1.01"
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {valid ? <Assessment probability={p / 100} odds={o} bankroll={num(bankroll) ?? 0} closingOdds={num(closing)} /> : (
          <Card>
            <CardContent className="text-sm text-text-secondary">
              Introduce una probabilidad entre 0 y 100 y una cuota mayor que 1.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-text-primary">Quitar el margen a un mercado</h3>
            <p className="text-xs text-text-muted">
              Mete las dos caras del mercado (por ejemplo Más 2,5 / Menos 2,5) y saca la probabilidad real
              que está usando la casa, sin su comisión.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cuota selección A" value={sideA} onChange={setSideA} step="0.01" min="1.01" />
              <Field label="Cuota selección B" value={sideB} onChange={setSideB} step="0.01" min="1.01" />
            </div>
            <Devig a={num(sideA)} b={num(sideB)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Assessment({
  probability,
  odds,
  bankroll,
  closingOdds,
}: {
  probability: number;
  odds: number;
  bankroll: number;
  closingOdds: number | null;
}) {
  const assessment = assessValue(probability, odds);
  const verdict = screenSelection(probability, odds);
  const stake = fractionalKellyStake(bankroll, probability, odds);
  const clv = closingOdds !== null && closingOdds > 1 ? closingLineValue(odds, closingOdds) : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Verdict ok={verdict.accepted}>{verdict.reason}</Verdict>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Valor esperado"
            value={pct(assessment.edge)}
            tone={assessment.edge > 0 ? "good" : "bad"}
            hint="Beneficio por cada euro apostado"
          />
          <Metric
            label="Necesitas acertar"
            value={pct(assessment.breakEvenProbability, 1)}
            hint={`A cuota ${odds.toFixed(2)}`}
          />
          <Metric
            label="Cuota mínima"
            value={breakEvenOdds(probability).toFixed(3)}
            hint={`Para no perder al ${pct(probability, 0)}`}
          />
          <Metric
            label="Stake sugerido"
            value={`${stake.toFixed(2)} €`}
            hint="Kelly 1/4, tope 2% del bankroll"
          />
          <Metric label="ROI a largo plazo" value={pct(roiAt(probability, odds))} tone={roiAt(probability, odds) > 0 ? "good" : "bad"} />
          {clv !== null ? (
            <Metric
              label="CLV"
              value={pct(clv)}
              tone={clv > 0 ? "good" : "bad"}
              hint={clv > 0 ? "Batiste la línea de cierre" : "No batiste la línea de cierre"}
            />
          ) : null}
        </div>

        <Note>
          La banda del sistema es {SYSTEM_BAND.min.toFixed(2)} – {SYSTEM_BAND.max.toFixed(2)}. Por debajo de{" "}
          {SYSTEM_BAND.min.toFixed(2)} un 80% de acierto no deja margen; por encima de {SYSTEM_BAND.max.toFixed(2)},
          si el mercado te paga tanto es que tu 80% probablemente no es real. El CLV es el único dato que te
          dice si tienes ventaja <em>antes</em> de saber el resultado.
        </Note>
      </CardContent>
    </Card>
  );
}

function Devig({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null || a <= 1 || b <= 1) {
    return <p className="text-xs text-text-muted">Introduce las dos cuotas del mercado.</p>;
  }
  if (1 / a + 1 / b < 1) {
    return <p className="text-xs text-status-warning">Esas cuotas suman menos de 1: sería arbitraje, revisa los números.</p>;
  }

  const [fairA, fairB] = fairOddsForMarket([a, b]);
  const margin = 1 / a + 1 / b - 1;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Margen de la casa" value={pct(margin)} tone={margin > 0.07 ? "bad" : "neutral"} />
      <Metric label="Cuota justa A" value={fairA.toFixed(3)} hint={`Prob. real ${pct(1 / fairA, 1)}`} />
      <Metric label="Cuota justa B" value={fairB.toFixed(3)} hint={`Prob. real ${pct(1 / fairB, 1)}`} />
    </div>
  );
}
