import { cn } from "@/lib/utils/cn";

export type BadgeTone = "neutral" | "good" | "warning" | "serious" | "critical" | "accent";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-text-secondary border-border-hairline",
  good: "bg-status-good/10 text-status-good border-status-good/30",
  warning: "bg-status-warning/15 text-[#8a5a00] dark:text-status-warning border-status-warning/30",
  serious: "bg-status-serious/15 text-status-serious border-status-serious/30",
  critical: "bg-status-critical/10 text-status-critical border-status-critical/30",
  accent: "bg-accent-450/10 text-accent-500 dark:text-accent-400 border-accent-450/30",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Opportunity/Lead score (0-100) -> priority bucket, per ARCHITECTURE.md §5. */
export function scoreBucket(score: number): { label: string; tone: BadgeTone } {
  if (score >= 86) return { label: "Prioridad máxima", tone: "critical" };
  if (score >= 71) return { label: "Muy alta", tone: "serious" };
  if (score >= 51) return { label: "Alta", tone: "warning" };
  if (score >= 31) return { label: "Moderada", tone: "accent" };
  return { label: "Baja", tone: "neutral" };
}
