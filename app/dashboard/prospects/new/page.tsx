import { buttonVariants } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function NewProspectSearchPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Nueva búsqueda de discovery</h1>
        <p className="text-sm text-text-secondary">
          Define el sector y la zona para lanzar un job de prospección en segundo plano.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parámetros de búsqueda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone="accent">CSV / Excel — activo</Badge>
            <Badge tone="neutral">Google Places API — inactivo (sin API key)</Badge>
          </div>

          <fieldset disabled className="grid grid-cols-2 gap-4 opacity-60">
            <Field label="País" placeholder="España" />
            <Field label="Ciudad / Zona" placeholder="Lloret de Mar" />
            <Field label="Código postal" placeholder="17310" />
            <Field label="Sector" placeholder="Restaurantes" />
            <Field label="Cantidad máxima" placeholder="500" />
            <Field label="Idioma" placeholder="es" />
          </fieldset>

          <div className="rounded-lg border border-dashed border-border-hairline p-4 text-sm text-text-secondary">
            El formulario de discovery y la importación CSV se conectan en la <strong>Fase 2</strong> (ver
            ROADMAP.md), justo después de este shell. Por ahora esta pantalla documenta el flujo previsto:
            subir un CSV de negocios (nombre, dirección, teléfono, web…) o, cuando actives
            <code className="mx-1 rounded bg-surface-2 px-1">GOOGLE_PLACES_API_KEY</code>
            con facturación en Google Cloud, lanzar una búsqueda automática por país/ciudad/sector.
          </div>

          <button type="button" className={buttonVariants()} disabled>
            Lanzar búsqueda (Fase 2)
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-text-secondary">{label}</span>
      <input
        className="h-10 w-full rounded-lg border border-border-hairline bg-surface-1 px-3 text-sm"
        placeholder={placeholder}
      />
    </label>
  );
}
