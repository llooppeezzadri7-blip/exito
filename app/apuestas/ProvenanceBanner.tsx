import { cn } from "@/lib/utils/cn";
import { PROVENANCE_DESCRIPTION, PROVENANCE_LABEL, type Provenance } from "@/lib/betting/providers/types";

const TONE: Record<Provenance, string> = {
  real: "border-status-good/40 bg-status-good/10 text-status-good",
  backtest: "border-status-warning/40 bg-status-warning/10 text-[#8a5a00] dark:text-status-warning",
  demo: "border-status-critical/40 bg-status-critical/10 text-status-critical",
};

/**
 * The loudest element on the page. If the data is not real, the user has to
 * see it before they see any number.
 */
export function ProvenanceBanner({
  provenance,
  notice,
  extra,
}: {
  provenance: Provenance;
  notice: string;
  extra?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-4", TONE[provenance])}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-current px-2 py-0.5 text-xs font-bold tracking-wide">
          {PROVENANCE_LABEL[provenance]}
        </span>
        <span className="text-sm font-medium">{PROVENANCE_DESCRIPTION[provenance]}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{notice}</p>
      {extra ? <p className="mt-1 text-sm leading-relaxed opacity-90">{extra}</p> : null}
    </div>
  );
}

/** Inline tag for a single row. */
export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return (
    <span
      className={cn(
        "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide",
        TONE[provenance]
      )}
    >
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}
