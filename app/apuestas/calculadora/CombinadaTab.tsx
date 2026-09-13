"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { evaluateCombi, requiredCombiBoost, screenSelection } from "@/lib/betting/sportium";
import { Field, Metric, Note, num, pct, Verdict } from "../ui";

interface Leg {
  id: string;
  odds: string;
  probability: string;
}

const INITIAL_LEGS: Leg[] = [
  { id: "1", odds: "1.32", probability: "80" },
  { id: "2", odds: "1.32", probability: "80" },
];

let nextId = 3;

/**
 * Combinadas, and the margin they compound. The headline number here is
 * `requiredBoost`: what a combi promo would have to pay just to break even.
 */
export function CombinadaTab() {
  const [legs, setLegs] = useState<Leg[]>(INITIAL_LEGS);
  const [boost, setBoost] = useState("0");
  const [margin, setMargin] = useState("5");

  const update = (id: string, patch: Partial<Leg>) =>
    setLegs((current) => current.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));

  const addLeg = () =>
    setLegs((current) => [...current, { id: String(nextId++), odds: "1.32", probability: "80" }]);

  const removeLeg = (id: string) =>
    setLegs((current) => (current.length > 1 ? current.filter((leg) => leg.id !== id) : current));

  const parsed = legs.map((leg) => ({ odds: num(leg.odds), probability: num(leg.probability) }));
  const valid = parsed.every((leg) => leg.odds !== null && leg.odds > 1 && leg.probability !== null && leg.probability > 0 && leg.probability < 100);

  const boostPercent = (num(boost) ?? 0) / 100;
  const marginPerLeg = (num(margin) ?? 5) / 100;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {legs.map((leg, index) => (
              <div key={leg.id} className="rounded-lg border border-border-hairline bg-surface-0 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">Selección {index + 1}</span>
                  {legs.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeLeg(leg.id)}
                      className="text-xs text-text-muted hover:text-status-critical"
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Cuota" value={leg.odds} onChange={(v) => update(leg.id, { odds: v })} step="0.01" min="1.01" />
                  <Field
                    label="Probabilidad"
                    value={leg.probability}
                    onChange={(v) => update(leg.id, { probability: v })}
                    step="0.5"
                    suffix="%"
                  />
                </div>
                <LegVerdict odds={parsed[index].odds} probability={parsed[index].probability} />
              </div>
            ))}
          </div>

          <Button type="button" variant="secondary" size="sm" onClick={addLeg}>
            Añadir selección
          </Button>

          <Field label="Boost de la combinada" value={boost} onChange={setBoost} step="1" suffix="%" />
          <Field
            label="Margen por selección"
            hint="5% en mercados principales, 8% o más en córners y tarjetas."
            value={margin}
            onChange={setMargin}
            step="0.5"
            suffix="%"
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {valid ? (
          <Result
            odds={parsed.map((leg) => leg.odds as number)}
            probabilities={parsed.map((leg) => (leg.probability as number) / 100)}
            boostPercent={boostPercent}
            marginPerLeg={marginPerLeg}
          />
        ) : (
          <Card>
            <CardContent className="text-sm text-text-secondary">
              Cada selección necesita una cuota mayor que 1 y una probabilidad entre 0 y 100.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-text-primary">Lo que cuesta cada selección extra</h3>
            <p className="text-xs text-text-muted">
              El margen de la casa no se suma: se multiplica. Con un {margin}% por selección, esto es el boost que
              necesitarías solo para quedarte a cero.
            </p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Metric key={n} label={`${n} ${n === 1 ? "selección" : "selecciones"}`} value={pct(requiredCombiBoost(n, marginPerLeg), 1)} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LegVerdict({ odds, probability }: { odds: number | null; probability: number | null }) {
  if (odds === null || probability === null || odds <= 1 || probability <= 0 || probability >= 100) return null;
  const verdict = screenSelection(probability / 100, odds);
  return (
    <p className={`mt-2 text-xs ${verdict.accepted ? "text-status-good" : "text-status-critical"}`}>
      {verdict.reason}
    </p>
  );
}

function Result({
  odds,
  probabilities,
  boostPercent,
  marginPerLeg,
}: {
  odds: number[];
  probabilities: number[];
  boostPercent: number;
  marginPerLeg: number;
}) {
  const result = evaluateCombi(odds, probabilities, boostPercent, marginPerLeg);
  const positive = result.expectedValue > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Verdict ok={positive}>{result.verdict}</Verdict>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="Cuota combinada" value={result.combinedOdds.toFixed(3)} />
          {boostPercent > 0 ? <Metric label="Con boost" value={result.boostedOdds.toFixed(3)} tone="good" /> : null}
          <Metric
            label="Probabilidad de acierto"
            value={pct(result.combinedProbability, 1)}
            tone={result.combinedProbability >= 0.5 ? "good" : "bad"}
            hint={`${odds.length} selecciones`}
          />
          <Metric
            label="Valor esperado"
            value={pct(result.expectedValue)}
            tone={positive ? "good" : "bad"}
          />
          <Metric label="Boost necesario para empatar" value={pct(result.requiredBoost, 1)} />
          <Metric label="Necesitas acertar" value={pct(1 / result.boostedOdds, 1)} />
        </div>

        <Note>
          Las selecciones se tratan como independientes. Si son del mismo partido <strong>no lo son</strong>: usa
          directamente el precio del creador de apuestas de Sportium, que ya incluye la correlación (a favor de la
          casa). Fíjate en que un acierto del {pct(result.combinedProbability, 0)} puede seguir siendo una apuesta
          perdedora: lo que decide es el valor esperado, no el porcentaje.
        </Note>
      </CardContent>
    </Card>
  );
}
