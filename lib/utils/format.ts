export function formatCurrencyEUR(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-ES").format(value);
}

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return "Sin analizar";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 1) return "Hace instantes";
  if (diffH < 24) return `Hace ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `Hace ${diffD}d`;
}
