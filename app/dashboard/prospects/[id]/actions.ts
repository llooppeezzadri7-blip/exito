"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/database";
import { scanWebsite } from "@/backend/scanner/scan-website";

export interface AnalyzeState {
  error: string | null;
  ok: boolean;
}

export async function analyzeWebsite(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const repo = await getRepository();
  const business = await repo.getBusiness(businessId);

  if (!business) return { error: "Negocio no encontrado.", ok: false };
  if (!business.website_url) return { error: "Este negocio no tiene web detectada.", ok: false };

  const job = await repo.createJob({
    type: "website_scan",
    params: { business_id: businessId, url: business.website_url },
    progressTotal: 1,
  });
  await repo.updateJob(job.id, { status: "RUNNING", started_at: new Date().toISOString() });

  const result = await scanWebsite(business.website_url);

  if (result.status === "failed") {
    await repo.updateJob(job.id, {
      status: "FAILED",
      error: { message: result.error ?? "Scan failed", url: business.website_url, service: "scanner" },
      finished_at: new Date().toISOString(),
    });
    return { error: result.error ?? "No se pudo analizar la web.", ok: false };
  }

  await repo.saveWebsiteScan({
    website_id: null,
    business_id: businessId,
    status: result.status,
    source: "internal-scanner",
    technical: result.technical,
    seo: result.seo,
    conversion: result.conversion,
    design: result.design,
    performance: result.performance,
    unavailable_metrics: result.unavailableMetrics,
  });

  await repo.updateJob(job.id, {
    status: "COMPLETED",
    progress_current: 1,
    finished_at: new Date().toISOString(),
    result: { status: result.status },
  });

  revalidatePath(`/dashboard/prospects/${businessId}`);
  return { error: null, ok: true };
}
