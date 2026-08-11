import type { DemoContent } from "@/backend/demo-generator/generate-demo";

export function DemoPreview({ content }: { content: DemoContent }) {
  const { copy, business, reviews } = content;

  return (
    <div className="overflow-hidden rounded-xl border border-border-hairline">
      <div className="flex items-center gap-1.5 border-b border-border-hairline bg-surface-2 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-status-critical/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-status-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-status-good/60" />
        <span className="ml-2 text-xs text-text-muted">Vista previa — no publicada</span>
      </div>

      <div className="bg-surface-0 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-500">{business.name}</p>
        <h2 className="mt-2 text-2xl font-semibold text-text-primary">{copy.headline}</h2>
        <p className="mt-2 text-text-secondary">{copy.subheadline}</p>
        <button className="mt-5 rounded-lg bg-accent-450 px-5 py-2.5 text-sm font-medium text-white" disabled>
          {copy.cta_text}
        </button>

        <div className="mx-auto mt-8 flex h-40 max-w-md items-center justify-center rounded-lg border border-dashed border-border-hairline text-xs text-text-muted">
          Galería de fotos (añade fotos reales del negocio aquí)
        </div>

        <div className="mx-auto mt-8 max-w-lg text-left">
          <h3 className="text-sm font-semibold text-text-primary">Sobre {business.name}</h3>
          <p className="mt-1 text-sm text-text-secondary">{copy.about}</p>
        </div>

        {reviews.rating && (
          <div className="mt-6 text-sm text-text-secondary">
            ⭐ {reviews.rating}/5 {reviews.review_count ? `(${reviews.review_count} reseñas reales)` : ""}
          </div>
        )}

        <div className="mx-auto mt-6 max-w-md rounded-lg border border-dashed border-border-hairline p-4 text-xs text-text-muted">
          Testimonios de clientes (pendiente — añade reseñas reales)
        </div>

        <div className="mt-8 border-t border-border-hairline pt-6 text-left text-sm text-text-secondary">
          <p className="font-semibold text-text-primary">Contacto</p>
          {business.address && <p>{business.address}{business.city ? `, ${business.city}` : ""}</p>}
          {business.phone && <p>{business.phone}</p>}
          {business.email && <p>{business.email}</p>}
        </div>
      </div>
    </div>
  );
}
