"use server";

import { revalidatePath } from "next/cache";
import { getRepository, type AgencyRepository } from "@/lib/database";
import type { Business, LeadStage } from "@/lib/database/types";
import { scanWebsite } from "@/backend/scanner/scan-website";
import { computeScores } from "@/lib/scoring/compute-scores";
import { AnthropicAIProvider } from "@/lib/ai/provider";
import { ProviderNotConfiguredError } from "@/lib/integrations/business-sources/types";
import { generateDemo as buildDemo } from "@/backend/demo-generator/generate-demo";
import { estimateAnthropicCostUsd } from "@/lib/costs/pricing";
import { checkRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { WebflowService } from "@/lib/integrations/webflow/service";

async function logAiUsage(
  repo: AgencyRepository,
  provider: AnthropicAIProvider,
  businessId: string,
  operation: "audit" | "proposal" | "demo_copy"
) {
  const usage = provider.getLastUsage();
  if (!usage) return;
  await repo.addApiUsage({
    service: "anthropic",
    operation,
    business_id: businessId,
    job_id: null,
    units: usage.inputTokens + usage.outputTokens,
    estimated_cost_usd: estimateAnthropicCostUsd(usage.model, usage.inputTokens, usage.outputTokens),
  });
}

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
  try {
    checkRateLimit(`scan:${businessId}`, 5, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, ok: false };
    throw err;
  }

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

function rateLimitOrNull(key: string, limit: number, windowMs: number): AnalyzeState | null {
  try {
    checkRateLimit(key, limit, windowMs);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return { error: err.message, ok: false };
    throw err;
  }
}

export async function generateProposal(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const limited = rateLimitOrNull(`ai:proposal:${businessId}`, 3, 60_000);
  if (limited) return limited;

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
    await logAiUsage(repo, provider, businessId, "proposal");
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo generar la propuesta.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/proposals");
  return { error: null, ok: true };
}

export async function generateDemo(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const limited = rateLimitOrNull(`ai:demo:${businessId}`, 3, 60_000);
  if (limited) return limited;

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
    await logAiUsage(repo, provider, businessId, "demo_copy");
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo generar la demo.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/demos");
  return { error: null, ok: true };
}

/**
 * Publishes the Webflow site configured in `WEBFLOW_SITE_ID` and records the
 * resulting live URL on the business's latest demo.
 *
 * Scope note: this pushes the *configured Webflow site* live — it does not
 * upload `demo.content` into Webflow, because no verified Data API endpoint
 * for building a page from that content exists in `WebflowService` (see its
 * docstring: page/CMS authoring is done interactively via the Webflow MCP
 * tools). So the demo must already be built in that site before this is used.
 * The UI states this explicitly rather than implying the in-app preview is
 * what goes live.
 */
export async function publishDemoToWebflow(
  businessId: string,
  _prevState: AnalyzeState,
  formData: FormData
): Promise<AnalyzeState> {
  // Publishing makes content publicly live, so it must never fire from a
  // stray click or a replayed request. The client renders a two-step confirm;
  // this check is what actually enforces it, since a server action is a
  // callable endpoint in its own right — see brief §17 and SECURITY.md.
  if (formData.get("confirm") !== "yes") {
    return { error: "Publicación no confirmada.", ok: false };
  }

  const limited = rateLimitOrNull(`webflow:publish:${businessId}`, 2, 60_000);
  if (limited) return limited;

  const repo = await getRepository();
  const demo = await repo.getLatestDemoForBusiness(businessId);
  if (!demo) return { error: "No hay ninguna demo generada para este negocio.", ok: false };

  const webflow = new WebflowService();
  if (!webflow.isActive) {
    return {
      error: "Webflow no está configurado. Añade WEBFLOW_API_TOKEN y WEBFLOW_SITE_ID (ver SETUP.md).",
      ok: false,
    };
  }

  try {
    await webflow.publish({ publishToWebflowSubdomain: true });

    // A publish that succeeded but whose URL can't be resolved is still a
    // publish — record it with a null URL rather than failing the action.
    const publishedUrl = await webflow.getSiteSubdomainUrl().catch(() => null);

    await repo.updateDemo(demo.id, {
      status: "published",
      webflow_site_id: webflow.siteId,
      published_url: publishedUrl,
    });

    await repo.addApiUsage({
      service: "webflow",
      operation: "publish_site",
      business_id: businessId,
      job_id: null,
      units: 1,
      estimated_cost_usd: 0, // Webflow's Data API isn't billed per request — tracked for the call count.
    });
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo publicar la demo.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  revalidatePath("/dashboard/demos");
  return { error: null, ok: true };
}

export async function generateAiAudit(businessId: string, _prevState: AnalyzeState): Promise<AnalyzeState> {
  const limited = rateLimitOrNull(`ai:audit:${businessId}`, 3, 60_000);
  if (limited) return limited;

  const repo = await getRepository();
  const business = await repo.getBusiness(businessId);
  if (!business) return { error: "Negocio no encontrado.", ok: false };

  const provider = new AnthropicAIProvider();
  const scan = await repo.getLatestWebsiteScan(businessId);

  try {
    const audit = await provider.generateAudit({ business, scan, score: business.score });
    await repo.saveAiReport(businessId, { ...audit, kind: "audit", model: "claude-sonnet-5" });
    await logAiUsage(repo, provider, businessId, "audit");
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message, ok: false };
    return { error: err instanceof Error ? err.message : "No se pudo generar la auditoría.", ok: false };
  }

  revalidatePath(`/dashboard/prospects/${businessId}`);
  return { error: null, ok: true };
}
