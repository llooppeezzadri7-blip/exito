"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getResearchProgress, type ResearchProgressView } from "../actions";
import type { ProgressStep } from "@/backend/research/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

const POLL_MS = 1500;

const STATUS_MARK: Record<ProgressStep["status"], string> = {
  PENDING: "·",
  RUNNING: "…",
  DONE: "✓",
  FAILED: "✕",
  SKIPPED: "—",
};

const STATUS_CLASS: Record<ProgressStep["status"], string> = {
  PENDING: "text-text-muted",
  RUNNING: "text-accent-450",
  DONE: "text-status-good",
  FAILED: "text-status-critical",
  SKIPPED: "text-text-muted",
};

/**
 * Polls the run while it is in flight. A server action cannot stream, and the
 * pipeline takes minutes, so the alternative would be a frozen screen — the
 * one thing the brief explicitly rules out (§3).
 */
export function ProgressView({ runId, initial }: { runId: string; initial: ResearchProgressView }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);

  useEffect(() => {
    if (progress.status !== "RUNNING") return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await getResearchProgress(runId);
      if (cancelled || !next) return;
      setProgress(next);
      // Once finished, re-render the server component to show the results.
      if (next.status !== "RUNNING") router.refresh();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, progress.status, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Progreso</CardTitle>
        {progress.status === "RUNNING" && (
          <span className="text-xs text-accent-450">Investigando…</span>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {progress.steps.length === 0 && (
          <p className="text-sm text-text-secondary">Preparando la investigación…</p>
        )}

        {progress.steps.map((step) => (
          <div key={step.key} className="flex items-baseline gap-3 text-sm">
            <span className={`w-4 shrink-0 ${STATUS_CLASS[step.status]}`}>
              {STATUS_MARK[step.status]}
            </span>
            <span className="w-48 shrink-0 text-text-secondary">{step.label}</span>
            <span className="tabular-nums text-text-primary">
              {step.detail ??
                (step.status === "RUNNING" && step.total > 0
                  ? `${step.current}/${step.total}`
                  : "")}
            </span>
          </div>
        ))}

        {progress.error && (
          <p className="pt-2 text-sm text-status-critical">{progress.error}</p>
        )}
        {progress.issueCount > 0 && (
          <p className="pt-2 text-xs text-text-muted">
            {progress.issueCount} incidencias registradas (la investigación continúa pese a ellas).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
