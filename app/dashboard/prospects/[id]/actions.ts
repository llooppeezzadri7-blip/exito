"use server";

import { revalidatePath } from "next/cache";
import { getRepository, type AgencyRepository } from "@/lib/database";
import type { Business, LeadStage } from "@/lib/database/types";
import { scanWebsite } from "@/backend/scanner/scan-website";
import { computeScores } from "@/lib/scoring/compute-scores";
import { AnthropicAIProvider } from "@/lib/ai/provider";
import { ProviderNotConfiguredError } from "@/lib/integrations/business-sources/types";
import { generateDemo as buildDemo } from "@/backend/demo-generator/generate-demo";

export interface AnalyzeState {
  error: string | null;
  ok: boolean;
}

async function recompute(repo: AgencyRepository, business: Business) {
  const [scan, settings] = await Promise.all([repo.getLatestWebsiteScan(business.id), repo.getSettings()]);
  const scoreData = computeScores({ business, scan, weights: settings.scoring_weights });
  await repo.saveScore(business.id, scoreData);
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

  // The pipeline is scan -> score, always in sequence — see ARCHITECTURE.md §4.
  await recompute(repo, business);

  revalidatePath(`/dashboard/prospects/${businessId}`);
  return { error: null, ok: true };
}

export async function recalculateScore(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const repo = await getRepository();
  const business = await repo.getBusiness(businessId);
  if (!business) return { error: "Negocio no encontrado.", ok: false };

  await recompute(repo, business);

  revalidatePath(`/dashboard/prospects/${businessId}`);
  return { error: null, ok: true };
}

export async function addToPipeline(businessId: string): Promise<void> {
  const repo = await getRepository();
  const business = await repo.getBusiness(businessId);
  await repo.createLead(businessId, business?.score?.lead_score ?? null);
  revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/pipeline");
}

export async function changeLeadStage(leadId: string, stage: LeadStage, redirectPath: string): Promise<void> {
  const repo = await getRepository();
  await repo.updateLead(leadId, { stage });
  revalidatePath(redirectPath);
  revalidatePath("/dashboard/pipeline");
}

export async function updateLeadFollowUp(leadId: string, formData: FormData): Promise<void> {
  const repo = await getRepository();
  const nextAction = String(formData.get("next_action") ?? "").trim();
  const nextActionDate = String(formData.get("next_action_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await repo.updateLead(leadId, {
    next_action: nextAction || null,
    next_action_date: nextActionDate || null,
    notes: notes || null,
  });

  if (nextAction) {
    await repo.addLeadActivity(leadId, { type: "note", description: `Próxima acción: ${nextAction}${nextActionDate ? ` (${nextActionDate})` : ""}` });
  }

  const businessId = formData.get("business_id");
  if (typeof businessId === "string") revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/pipeline");
}

export async function generateProposal(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const repo = await getRepository();
  const [business, audit, settings] = await Promise.all([
    repo.getBusiness(businessId),
    repo.getLatestAiReport(businessId),
    repo.getSettings(),
  ]);
  if (!business) return { error: "Negocio no encontrado.", ok: false };

  const provider = new AnthropicAIProvider();

  try {
    const draft = await provider.generateProposal({ business, audit, settings });

    const priceTotal = draft.services.reduce((sum, service) => {
      const price = settings.pricing[service];
      return sum + (typeof price === "number" ? price : 0);
    }, 0);

    await repo.saveProposal({
      business_id: businessId,
      owner_id: business.owner_id,
      title: draft.title,
      services: draft.services,
      price_total: priceTotal || null,
      currency: "EUR",
      timeline: draft.timeline,
      maintenance_terms: draft.maintenance_terms,
      next_steps: draft.next_steps,
      content: draft.content,
      status: "draft",
    });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo generar la propuesta.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/proposals");
  return { error: null, ok: true };
}

export async function generateDemo(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const repo = await getRepository();
  const business = await repo.getBusiness(businessId);
  if (!business) return { error: "Negocio no encontrado.", ok: false };

  const provider = new AnthropicAIProvider();

  try {
    const content = await buildDemo(provider, business);
    await repo.saveDemo({
      business_id: businessId,
      owner_id: business.owner_id,
      status: "draft",
      content: content as unknown as Record<string, unknown>,
      webflow_site_id: null,
      published_url: null,
    });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo generar la demo.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/demos");
  return { error: null, ok: true };
}

export async function generateAiAudit(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const repo = await getRepository();
  const business = await repo.getBusiness(businessId);
  if (!business) return { error: "Negocio no encontrado.", ok: false };

  const provider = new AnthropicAIProvider();
  const scan = await repo.getLatestWebsiteScan(businessId);

  try {
    const audit = await provider.generateAudit({ business, scan, score: business.score });
    await repo.saveAiReport(businessId, { ...audit, kind: "audit", model: "claude-sonnet-5" });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo generar la auditoría.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  return { error: null, ok: true };
}
