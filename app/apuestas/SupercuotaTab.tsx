"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { evaluateSupercuota, freebetRetention, SPORTIUM_DEFAULTS } from "@/lib/betting/sportium";
import { Field, Metric, Note, num, pct, Verdict } from "./ui";

/**
 * What a Sportium supercuota is really worth once the free-bet half of the
 * prize is discounted and the stake cap is applied.
 */
export function SupercuotaTab() {
  const [stake, setStake] = useState("10");
  const [boosted, setBoosted] = useState("7.00");
  const [base, setBase] = useState("1.90");
  const [probability, setProbability] = useState("20");
  const [cap, setCap] = useState(String(SPORTIUM_DEFAULTS.supercuotaStakeCapEur));
  const [freebetOdds, setFreebetOdds] = useState("4.00");
  const [asFreebet, setAsFreebet] = useState(true);

  const stakeEur = num(stake);
  const boostedOdds = num(boosted);
  const baseOdds = num(base);
  const p = num(probability);
  const capEur = num(cap);
  const fbOdds = num(freebetOdds);

  const retention = fbOdds !== null && fbOdds > 1 ? freebetRetention(fbOdds) : SPORTIUM_DEFAULTS.freebetRetention;

  const valid =
    stakeEur !== null && stakeEur > 0 &&
    boostedOdds !== null && baseOdds !== null && baseOdds > 1 &&
    boostedOdds >= baseOdds &&
    p !== null && p > 0 && p < 100 &&
    capEur !== null && capEur > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Field label="Lo que apuestas" value={stake} onChange={setStake} step="1" suffix="€" />
          <Field label="Supercuota anunciada" value={boosted} onChange={setBoosted} step="0.05" min="1.01" />
          <Field
            label="Cuota normal de la selección"
            hint="La parte que Sportium paga en dinero real."
            value={base}
            onChange={setBase}
            step="0.05"
            min="1.01"
          />
          <Field label="Tu probabilidad estimada" value={probability} onChange={setProbability} step="0.5" suffix="%" />
          <Field
            label="Tope con supercuota"
            hint="Importe máximo que se paga a cuota mejorada."
            value={cap}
            onChange={setCap}
            step="1"
            suffix="€"
          />
          <Field
            label="Cuota a la que jugarías la apuesta gratis"
            hint="Cuanto más alta, más vale la freebet."
            value={freebetOdds}
            onChange={setFreebetOdds}
            step="0.25"
            min="1.01"
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={asFreebet}
              onChange={(event) => setAsFreebet(event.target.checked)}
              className="h-4 w-4 rounded border-border-hairline accent-[var(--accent-450)]"
            />
            El extra se paga como apuesta gratis
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {valid ? (
          <Result
            stakeEur={stakeEur}
            boostedOdds={boostedOdds}
            baseOdds={baseOdds}
            probability={p / 100}
            capEur={capEur}
            retention={retention}
            asFreebet={asFreebet}
          />
        ) : (
          <Card>
            <CardContent className="text-sm text-text-secondary">
              Revisa los datos: la supercuota no puede ser menor que la cuota normal y la probabilidad debe estar
              entre 0 y 100.
            </CardContent>
          </Card>
        )}

        <Note>
          Los valores por defecto son los términos <em>típicos</em> de Sportium, no una garantía: el tope y la forma
          de pago cambian en cada promoción. Lee siempre las condiciones concretas y ajústalos aquí. Una apuesta
          gratis no vale su valor nominal porque no te devuelve la parte de la apuesta: a cuota{" "}
          {(num(freebetOdds) ?? 4).toFixed(2)} conservas alrededor del {pct(retention, 0)}.
        </Note>
      </div>
    </div>
  );
}

function Result({
  stakeEur,
  boostedOdds,
  baseOdds,
  probability,
  capEur,
  retention,
  asFreebet,
}: {
  stakeEur: number;
  boostedOdds: number;
  baseOdds: number;
  probability: number;
  capEur: number;
  retention: number;
  asFreebet: boolean;
}) {
  const result = evaluateSupercuota({
    stakeEur,
    boostedOdds,
    baseOdds,
    probability,
    stakeCapEur: capEur,
    freebetRetention: retention,
    boostPaidAsFreebet: asFreebet,
  });

  const positive = result.expectedValueEur > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Verdict ok={positive}>
          {positive
            ? `Vale la pena: ${result.expectedValueEur.toFixed(2)} € de valor esperado (${pct(result.expectedValuePerEur)} por euro).`
            : `No la cojas: ${result.expectedValueEur.toFixed(2)} € de valor esperado (${pct(result.expectedValuePerEur)} por euro).`}
        </Verdict>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="Premio anunciado" value={`${result.nominalReturnEur.toFixed(2)} €`} hint="Lo que dice el banner" />
          <Metric label="Valor real" value={`${result.realReturnEur.toFixed(2)} €`} hint="Freebet ya descontada" />
          <Metric
            label="Cuota efectiva"
            value={result.effectiveOdds.toFixed(2)}
            tone={result.effectiveOdds < boostedOdds ? "bad" : "good"}
            hint={`Anunciada: ${boostedOdds.toFixed(2)}`}
          />
          <Metric label="En dinero real" value={`${result.cashReturnEur.toFixed(2)} €`} />
          <Metric label="En apuesta gratis" value={`${result.freebetFaceEur.toFixed(2)} €`} hint={`Valen ~${(result.freebetFaceEur * retention).toFixed(2)} €`} />
          <Metric
            label="Necesitas acertar"
            value={pct(1 / result.effectiveOdds, 1)}
            hint="Sobre la cuota efectiva real"
          />
        </div>

        <ul className="flex flex-col gap-1.5 text-xs text-text-secondary">
          {result.notes.map((note) => (
            <li key={note} className="flex gap-2">
              <span className="text-text-muted">·</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
