import { cn } from "@/lib/utils/cn";
import { Card } from "./Card";

export interface StatTileProps {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; goodDirection: "up" | "down" };
  icon?: React.ReactNode;
  emphasis?: boolean;
}

export function StatTile({ label, value, delta, icon, emphasis }: StatTileProps) {
  const deltaIsGood = delta && delta.direction === delta.goodDirection;

  return (
    <Card className={cn("p-5", emphasis && "border-accent-450/40")}>
      <div className="flex items-start justify-between">
        <span className="text-sm text-text-secondary">{label}</span>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-text-primary">{value}</span>
        {delta && (
          <span
            className={cn(
              "text-xs font-medium",
              deltaIsGood ? "text-status-good" : "text-status-critical"
            )}
          >
            {delta.direction === "up" ? "▲" : "▼"} {delta.value}
          </span>
        )}
      </div>
    </Card>
  );
}
