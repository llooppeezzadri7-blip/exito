import { getRepository } from "@/lib/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { dataProvider } from "@/lib/config/env";
import { ScoringWeightsForm } from "./ScoringWeightsForm";
import { RecalculateAllButton } from "./RecalculateAllButton";
import { hasAnthropic, hasPageSpeed, hasWebflow } from "@/lib/config/env";

/**
 * Credential status (§14). Only booleans reach this component — the values
 * themselves never leave the server, so there is nothing here that could leak
 * a key, not even a masked prefix.
 */
const API_STATUS = [
  {
    label: "OpenStreetMap (Overpass)",
    envVar: "— sin clave",
    configured: true,
    enables: "Descubrimiento de negocios por municipio y categoría. Datos abiertos, sin coste.",
    missingEffect: "",
  },
  {
    label: "Registre de Turisme de Catalunya",
    envVar: "— sin clave",
    configured: true,
    enables: "Alojamientos oficialmente registrados. Datos abiertos, sin coste.",
    missingEffect: "",
  },
  {
    label: "Google PageSpeed",
    envVar: "GOOGLE_PAGESPEED_API_KEY",
    configured: hasPageSpeed,
    enables: "Lighthouse y Core Web Vitals reales en el análisis de webs.",
    missingEffect: "Las métricas de rendimiento se marcan como no disponibles, nunca se estiman.",
  },
  {
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    configured: hasAnthropic,
    enables: "Redacción de auditorías, propuestas y copy de demos.",
    missingEffect: "La redacción con IA queda inactiva; el análisis y la puntuación no la necesitan.",
  },
  {
    label: "Webflow",
    envVar: "WEBFLOW_API_TOKEN + WEBFLOW_SITE_ID",
    configured: hasWebflow,
    enables: "Publicación de demos en Webflow.",
    missingEffect: "Las demos se quedan como vista previa dentro de la aplicación.",
  },
];

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
          <CardTitle>APIs e integraciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-text-muted">
            Solo se muestra si la credencial está presente. La clave nunca se envía al navegador ni
            se muestra, ni siquiera parcialmente.
          </p>
          <ul className="space-y-2.5 text-sm">
            {API_STATUS.map((api) => (
              <li key={api.envVar} className="flex flex-wrap items-baseline gap-2">
                <Badge tone={api.configured ? "good" : "neutral"}>
                  {api.configured ? "Configurada" : "No configurada"}
                </Badge>
                <span className="text-text-primary">{api.label}</span>
                <code className="text-xs text-text-muted">{api.envVar}</code>
                <span className="w-full text-xs text-text-secondary">
                  {api.configured ? api.enables : api.missingEffect}
                </span>
              </li>
            ))}
          </ul>
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
