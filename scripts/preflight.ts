import { OVERPASS_ENDPOINT } from "@/lib/integrations/business-sources/overpass-provider";
import { DATASET_URL as TURISME_ENDPOINT } from "@/lib/integrations/business-sources/turisme-cat-provider";

/**
 * Checks the open sources are actually reachable *before* a cycle spends any
 * time on them.
 *
 * This exists because of a real failure mode: in a sandboxed or firewalled
 * environment every request fails, the cycle dutifully records "fuente no
 * disponible" for each target, and finishes reporting zero leads — which
 * looks identical to "there are no businesses there". One command up front
 * tells the two apart.
 */

interface Probe {
  name: string;
  url: string;
  check: () => Promise<{ ok: boolean; detail: string }>;
}

const TIMEOUT_MS = 20_000;

async function timed<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const PROBES: Probe[] = [
  {
    name: "OpenStreetMap (Overpass)",
    url: OVERPASS_ENDPOINT,
    async check() {
      // The cheapest query that still proves the whole path works: one node
      // in a tiny bounding box. A HEAD request would prove nothing, because
      // Overpass only rejects malformed queries at execution time.
      const response = await timed((signal) =>
        fetch(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent("[out:json][timeout:10];node(41.67,2.79,41.68,2.80);out 1;")}`,
          signal,
        })
      );

      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
      const body = (await response.json()) as { elements?: unknown[] };
      return { ok: true, detail: `respondió con ${body.elements?.length ?? 0} elemento(s)` };
    },
  },
  {
    name: "Registre de Turisme de Catalunya",
    url: TURISME_ENDPOINT,
    async check() {
      const response = await timed((signal) =>
        fetch(`${TURISME_ENDPOINT}?$limit=1`, { signal })
      );

      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
      const rows = (await response.json()) as unknown[];
      return { ok: true, detail: `respondió con ${rows.length} fila(s)` };
    },
  },
];

export interface PreflightResult {
  reachable: number;
  total: number;
  results: { name: string; ok: boolean; detail: string }[];
}

export async function preflight(): Promise<PreflightResult> {
  const results = await Promise.all(
    PROBES.map(async (probe) => {
      try {
        const outcome = await probe.check();
        return { name: probe.name, ...outcome };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          name: probe.name,
          ok: false,
          detail: message.includes("aborted")
            ? `sin respuesta en ${TIMEOUT_MS / 1000}s`
            : message,
        };
      }
    })
  );

  return { reachable: results.filter((r) => r.ok).length, total: results.length, results };
}

export function printPreflight(result: PreflightResult): void {
  console.log("\nComprobación de fuentes abiertas");
  console.log("─".repeat(60));
  for (const probe of result.results) {
    console.log(`  ${probe.ok ? "✓" : "✗"}  ${probe.name}: ${probe.detail}`);
  }
  console.log("─".repeat(60));
  console.log(`  ${result.reachable} de ${result.total} fuentes accesibles.\n`);
}

// Run directly: `npm run cycle:check`
if (process.argv[1]?.endsWith("preflight.ts")) {
  preflight().then((result) => {
    printPreflight(result);
    if (result.reachable === 0) {
      console.log(
        "Ninguna fuente responde. Puede ser un cortafuegos, un proxy o una caída\n" +
          "temporal. Lanzar un ciclo ahora produciría cero leads por falta de red,\n" +
          "no por falta de negocios.\n"
      );
    }
    process.exit(result.reachable === 0 ? 1 : 0);
  });
}
