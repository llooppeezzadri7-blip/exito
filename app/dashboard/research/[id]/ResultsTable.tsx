"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ResearchResultItem } from "@/backend/research/types";
import { TIER_LABELS, type CommercialTier } from "@/lib/scoring/commercial-score";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";

type ScoreFilter = "all" | "90" | "80" | "70" | "60";
type ConfidenceFilter = "all" | "alta" | "media" | "investigar";

const SCORE_OPTIONS: { id: ScoreFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "90", label: "90+" },
  { id: "80", label: "80+" },
  { id: "70", label: "70+" },
  { id: "60", label: "60+" },
];

const CONFIDENCE_OPTIONS: { id: ConfidenceFilter; label: string }[] = [
  { id: "all", label: "Toda confianza" },
  { id: "alta", label: "Confianza alta (80%+)" },
  { id: "media", label: "Confianza media (66-79%)" },
  { id: "investigar", label: "Investigar más (<66%)" },
];

const TIER_TONES: Record<CommercialTier, "good" | "warning" | "serious" | "critical" | "neutral"> = {
  EXCEPCIONAL: "critical",
  MUY_ALTA: "serious",
  ALTA: "warning",
  MEDIA: "neutral",
  NO_PRIORITARIO: "neutral",
  INVESTIGAR_MAS: "neutral",
};

const chipClass = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-xs transition-colors",
    active
      ? "border-accent-450 bg-accent-450 text-white"
      : "border-border-hairline text-text-secondary hover:bg-surface-2"
  );

export function ResultsTable({ results }: { results: ResearchResultItem[] }) {
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [tier, setTier] = useState<CommercialTier | "all">("all");
  const [sector, setSector] = useState("all");
  const [city, setCity] = useState("all");
  const [service, setService] = useState("all");

  const sectors = useMemo(
    () => [...new Set(results.map((r) => r.sector).filter(Boolean))] as string[],
    [results]
  );
  const cities = useMemo(
    () => [...new Set(results.map((r) => r.city).filter(Boolean))] as string[],
    [results]
  );
  const services = useMemo(
    () => [...new Set(results.map((r) => r.recommendedService).filter(Boolean))] as string[],
    [results]
  );

  const filtered = useMemo(() => {
    return results.filter((item) => {
      if (scoreFilter !== "all" && item.score < Number(scoreFilter)) return false;

      const confidencePct = item.confidence * 100;
      if (confidenceFilter === "alta" && confidencePct < 80) return false;
      if (confidenceFilter === "media" && (confidencePct < 66.67 || confidencePct >= 80)) return false;
      if (confidenceFilter === "investigar" && confidencePct >= 66.67) return false;

      if (tier !== "all" && item.tier !== tier) return false;
      if (sector !== "all" && item.sector !== sector) return false;
      if (city !== "all" && item.city !== city) return false;
      if (service !== "all" && item.recommendedService !== service) return false;
      return true;
    });
  }, [results, scoreFilter, confidenceFilter, tier, sector, city, service]);

  const selectClass =
    "h-8 rounded-lg border border-border-hairline bg-surface-2 px-2 text-xs text-text-primary";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SCORE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setScoreFilter(option.id)}
            className={chipClass(scoreFilter === option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CONFIDENCE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setConfidenceFilter(option.id)}
            className={chipClass(confidenceFilter === option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as CommercialTier | "all")}
          className={selectClass}
        >
          <option value="all">Todos los niveles</option>
          {(Object.keys(TIER_LABELS) as CommercialTier[]).map((key) => (
            <option key={key} value={key}>
              {TIER_LABELS[key]}
            </option>
          ))}
        </select>

        <select value={sector} onChange={(e) => setSector(e.target.value)} className={selectClass}>
          <option value="all">Todos los sectores</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select value={city} onChange={(e) => setCity(e.target.value)} className={selectClass}>
          <option value="all">Todos los municipios</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select value={service} onChange={(e) => setService(e.target.value)} className={selectClass}>
          <option value="all">Cualquier servicio</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-text-muted">
        Mostrando <span className="tabular-nums">{filtered.length}</span> de{" "}
        <span className="tabular-nums">{results.length}</span> oportunidades.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border-hairline text-left text-xs text-text-muted">
              <th className="py-2 pr-3 font-medium">Negocio</th>
              <th className="py-2 pr-3 font-medium">Localidad</th>
              <th className="py-2 pr-3 font-medium">Punt.</th>
              <th className="py-2 pr-3 font-medium">Confianza</th>
              <th className="py-2 pr-3 font-medium">Nivel</th>
              <th className="py-2 pr-3 font-medium">Problema principal</th>
              <th className="py-2 font-medium">Servicio</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.businessId} className="border-b border-border-hairline align-top">
                <td className="py-2.5 pr-3">
                  <Link
                    href={`/dashboard/prospects/${item.businessId}`}
                    className="text-text-primary hover:text-accent-450"
                  >
                    {item.name}
                  </Link>
                  {item.failedPhases.length > 0 && (
                    <span className="ml-2 text-xs text-status-warning">
                      {item.failedPhases.join(", ")}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-text-secondary">{item.city ?? "—"}</td>
                <td className="py-2.5 pr-3 tabular-nums">{item.score}</td>
                <td className="py-2.5 pr-3 tabular-nums text-text-secondary">
                  {Math.round(item.confidence * 100)}%
                </td>
                <td className="py-2.5 pr-3">
                  <Badge tone={TIER_TONES[item.tier]}>{TIER_LABELS[item.tier]}</Badge>
                </td>
                <td className="max-w-xs py-2.5 pr-3 text-xs text-text-secondary">
                  {item.primaryProblem ?? "—"}
                </td>
                <td className="py-2.5 text-xs text-text-secondary">
                  {item.recommendedService ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-text-secondary">
          Ningún resultado cumple estos filtros.
        </p>
      )}
    </div>
  );
}
