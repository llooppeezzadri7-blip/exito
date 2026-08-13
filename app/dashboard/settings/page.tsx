import { getRepository } from "@/lib/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { dataProvider } from "@/lib/config/env";
import { ScoringWeightsForm } from "./ScoringWeightsForm";
import { RecalculateAllButton } from "./RecalculateAllButton";

export default async function SettingsPage() {
  const repo = await getRepository();
  const settings = await repo.getSettings();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-sm text-text-secondary">
          Sectores, ciudades, precios y pesos del scoring de tu agencia.
          {dataProvider === "mock" &&
            " Modo demostración: los pesos son editables, pero se guardan solo en memoria (se pierden al reiniciar) hasta que conectes Supabase."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identidad de agencia</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-primary">{settings.agency_name}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sectores y ciudades</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs text-text-muted">Sectores</p>
            <div className="flex flex-wrap gap-1.5">
              {settings.sectors.map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-text-muted">Ciudades</p>
            <div className="flex flex-wrap gap-1.5">
              {settings.cities.map((c) => (
                <Badge key={c}>{c}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <ScoringWeightsForm weights={settings.scoring_weights} />

      <Card>
        <CardHeader>
          <CardTitle>Puntuaciones ya calculadas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-text-secondary">
            Cada puntuación guarda los pesos con los que se calculó. Al cambiar los pesos, las puntuaciones
            existentes no se tocan: recalcúlalas para aplicar los nuevos pesos a todos los prospectos.
          </p>
          <RecalculateAllButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Servicios ofrecidos</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
            {settings.services.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
