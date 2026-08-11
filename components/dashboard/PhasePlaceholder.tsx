import { EmptyState } from "@/components/ui/EmptyState";

export function PhasePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <EmptyState title={`Disponible en la ${phase}`} description={description} />
    </div>
  );
}
