"use client";

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

/** Small shared inputs for the betting calculators. */

export function Field({
  label,
  hint,
  value,
  onChange,
  step = "0.01",
  min,
  suffix,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      <span className="relative flex items-center">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-10 w-full rounded-lg border border-border-hairline bg-surface-2 px-3 text-sm text-text-primary",
            "focus:border-accent-450 focus:outline-none focus:ring-1 focus:ring-accent-450",
            suffix && "pr-10"
          )}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 text-xs text-text-muted">{suffix}</span>
        ) : null}
      </span>
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </label>
  );
}

export function Metric({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border-hairline bg-surface-2 p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "good" && "text-status-good",
          tone === "bad" && "text-status-critical",
          tone === "neutral" && "text-text-primary"
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-text-muted">{hint}</div> : null}
    </div>
  );
}

export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        ok
          ? "border-status-good/30 bg-status-good/10 text-status-good"
          : "border-status-critical/30 bg-status-critical/10 text-status-critical"
      )}
    >
      {children}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-border-hairline bg-surface-0 p-3 text-xs leading-relaxed text-text-secondary">
      {children}
    </p>
  );
}

/** Parse a user-typed number, returning null for anything unusable. */
export function num(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const pct = (n: number, digits = 2): string => `${(n * 100).toFixed(digits)}%`;
