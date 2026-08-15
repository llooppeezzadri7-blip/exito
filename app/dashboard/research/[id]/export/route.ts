import { getRun } from "@/backend/research/run-store";
import { exportFilename, toCsv, toJson } from "@/backend/research/export";

/**
 * Result download (§11). Evidence and sources are part of both formats — an
 * export that dropped them would strip findings of the thing that makes them
 * defensible.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const run = getRun(id);

  if (!run) {
    return new Response("Investigación no encontrada", { status: 404 });
  }

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const body = format === "json" ? toJson(run) : toCsv(run);

  return new Response(body, {
    headers: {
      "Content-Type":
        format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(run, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}
