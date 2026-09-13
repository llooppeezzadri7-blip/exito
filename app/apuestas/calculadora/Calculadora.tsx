"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { BacktestTab } from "./BacktestTab";
import { CombinadaTab } from "./CombinadaTab";
import { SupercuotaTab } from "./SupercuotaTab";
import { ValorTab } from "./ValorTab";

const TABS = [
  { key: "valor", label: "Valor", description: "¿Entra esta selección en el sistema?" },
  { key: "supercuota", label: "Supercuota", description: "Lo que vale de verdad una cuota mejorada" },
  { key: "combinada", label: "Combinada", description: "El margen que se multiplica" },
  { key: "backtest", label: "Backtest", description: "Medir el sistema contra datos reales" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function Calculadora() {
  const [tab, setTab] = useState<TabKey>("valor");
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-lg border border-border-hairline bg-surface-1 p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === item.key
                  ? "bg-accent-450 text-white"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">{active.description}</p>
      </div>

      {tab === "valor" ? <ValorTab /> : null}
      {tab === "supercuota" ? <SupercuotaTab /> : null}
      {tab === "combinada" ? <CombinadaTab /> : null}
      {tab === "backtest" ? <BacktestTab /> : null}
    </div>
  );
}
