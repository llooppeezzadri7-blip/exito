import { Card, CardContent } from "@/components/ui/Card";

/**
 * Shown whenever the dashboard is running without real odds. The point is that
 * the user should never have to dig through docs to find out what is missing.
 */
export function SetupCard() {
  return (
    <Card className="border-status-critical/30">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text-primary">
          Para ver apuestas reales faltan 3 pasos
        </h2>
        <ol className="flex flex-col gap-2 text-sm text-text-secondary">
          <li className="flex gap-2">
            <span className="font-semibold text-text-primary">1.</span>
            <span>
              Crea una clave gratuita en{" "}
              <a
                href="https://the-odds-api.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-500 underline"
              >
                the-odds-api.com
              </a>{" "}
              <span className="text-text-muted">(500 peticiones al mes, sin tarjeta)</span>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-text-primary">2.</span>
            <span>
              Crea el fichero <code className="rounded bg-surface-0 px-1.5 py-0.5">.env.local</code> en
              la raíz del proyecto con:
              <code className="mt-1 block rounded bg-surface-0 px-2 py-1.5 text-xs">
                ODDS_API_KEY=tu_clave_aqui
                <br />
                ODDS_API_REGION=eu
              </code>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-text-primary">3.</span>
            <span>
              Reinicia el servidor y recarga esta página. El aviso rojo de arriba pasará a verde y la
              columna &quot;Apostables de verdad&quot; dejará de ser 0.
            </span>
          </li>
        </ol>
        <p className="text-xs leading-relaxed text-text-muted">
          Sin esa clave el sistema no se queda en blanco ni se inventa nada: enseña datos DEMO
          etiquetados como tales para que puedas ver funcionar el panel.
        </p>
      </CardContent>
    </Card>
  );
}
