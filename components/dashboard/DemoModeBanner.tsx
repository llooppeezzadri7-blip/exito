import { Info } from "lucide-react";

export function DemoModeBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-border-hairline bg-accent-450/5 px-6 py-2 text-xs text-text-secondary">
      <Info className="h-3.5 w-3.5 text-accent-450" />
      Modo demostración: Supabase no está configurado, estás viendo datos de ejemplo
      ficticios. Configura las variables en ENVIRONMENT.md para conectar datos reales.
    </div>
  );
}
