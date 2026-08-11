import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CsvImportForm } from "./CsvImportForm";

export default function NewProspectSearchPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Nueva búsqueda de discovery</h1>
        <p className="text-sm text-text-secondary">
          Importa negocios desde un CSV o, cuando actives Google Places, lanza una búsqueda automática.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Importar desde CSV / Excel (exportado a CSV)</CardTitle>
          <Badge tone="accent">Activo</Badge>
        </CardHeader>
        <CardContent>
          <CsvImportForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Búsqueda automática (Google Places API)</CardTitle>
          <Badge tone="neutral">Inactivo — falta GOOGLE_PLACES_API_KEY</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset disabled className="grid grid-cols-2 gap-4 opacity-50">
            <Field label="País" placeholder="España" />
            <Field label="Ciudad / Zona" placeholder="Lloret de Mar" />
            <Field label="Código postal" placeholder="17310" />
            <Field label="Sector" placeholder="Restaurantes" />
            <Field label="Cantidad máxima" placeholder="500" />
            <Field label="Idioma" placeholder="es" />
          </fieldset>
          <p className="text-sm text-text-secondary">
            Google Places API (New) es de pago por uso y requiere una cuenta de Google Cloud con
            facturación. El conector ya está implementado en{" "}
            <code className="rounded bg-surface-2 px-1">lib/integrations/business-sources/google-places-provider.ts</code>
            ; se activará automáticamente en cuanto configures{" "}
            <code className="rounded bg-surface-2 px-1">GOOGLE_PLACES_API_KEY</code> (ver ENVIRONMENT.md).
          </p>
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
