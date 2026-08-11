"use server";

import { redirect } from "next/navigation";
import { getRepository } from "@/lib/database";
import { CsvBusinessSourceProvider } from "@/lib/integrations/business-sources";
import { CSV_IMPORT_LIMITS } from "@/lib/security/limits";
import { checkRateLimit, RateLimitError } from "@/lib/security/rate-limit";

export interface ImportCsvState {
  error: string | null;
  summary: { inserted: number; duplicates: number; errorRows: number } | null;
}

export async function importCsv(_prevState: ImportCsvState, formData: FormData): Promise<ImportCsvState> {
  try {
    checkRateLimit("discovery:csv_import", 5, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, summary: null };
    throw err;
  }

  const file = formData.get("csv_file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo CSV.", summary: null };
  }

  if (file.size > CSV_IMPORT_LIMITS.maxFileSizeBytes) {
    return { error: `El archivo supera el límite de ${CSV_IMPORT_LIMITS.maxFileSizeBytes / 1024 / 1024}MB.`, summary: null };
  }

  const text = await file.text();
  const provider = new CsvBusinessSourceProvider();
  const { records, errors } = provider.importFromText(text);

  if (records.length > CSV_IMPORT_LIMITS.maxRows) {
    return {
      error: `El CSV tiene ${records.length} filas válidas, el máximo por importación es ${CSV_IMPORT_LIMITS.maxRows}.`,
      summary: null,
    };
  }

  const repo = await getRepository();
  const job = await repo.createJob({
    type: "discovery",
    params: { source: "csv_import", filename: file.name },
    progressTotal: records.length,
  });

  await repo.updateJob(job.id, { status: "RUNNING", started_at: new Date().toISOString() });

  let outcome: { inserted: number; duplicates: number } | null = null;

  try {
    const { inserted, duplicates } = await repo.importBusinesses(records, job.id);
    await repo.updateJob(job.id, {
      status: "COMPLETED",
      progress_current: records.length,
      finished_at: new Date().toISOString(),
      result: { inserted: inserted.length, duplicates, error_rows: errors.length },
    });
    outcome = { inserted: inserted.length, duplicates };
  } catch (err) {
    await repo.updateJob(job.id, {
      status: "FAILED",
      error: { message: err instanceof Error ? err.message : "Unknown error", service: "csv_import" },
      finished_at: new Date().toISOString(),
    });
    return { error: "No se pudo completar la importación. Revisa los logs del job.", summary: null };
  }

  // redirect() throws internally — must happen outside the try/catch above,
  // otherwise the catch block swallows the redirect signal.
  if (errors.length === 0 && outcome.inserted > 0) {
    redirect("/dashboard/prospects");
  }

  return {
    error: null,
    summary: { inserted: outcome.inserted, duplicates: outcome.duplicates, errorRows: errors.length },
  };
}
