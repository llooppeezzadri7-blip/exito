import type { AgencyRepository } from "@/lib/database";
import type { Business, Settings } from "@/lib/database/types";
import type { RawBusinessRecord, DiscoveryResult } from "@/lib/integrations/business-sources/types";
import { discoverBusinesses, usesTourismRegister } from "./discovery";
import { dedupeBatch, findDuplicate } from "@/lib/research/dedupe";
import { resolveOfficialWebsite, type WebsiteCandidate } from "@/lib/research/website-resolver";
import { needsSecondResearch } from "@/lib/research/pipeline";
import { computeCommercialScore } from "@/lib/scoring/commercial-score";
import { computeScores } from "@/lib/scoring/compute-scores";
import { scanWebsite, type ScanOptions } from "@/backend/scanner/scan-website";
import { auditMobile } from "@/backend/scanner/mobile-audit";
import { fact, observation, type Evidence } from "@/lib/research/evidence";
import { recordEvent, recordSourceQuery } from "@/lib/memory/research-memory";
import type {
  CompetitorSnapshot,
  ProgressStep,
  ResearchConfig,
  ResearchIssue,
  ResearchResultItem,
  ResearchRunRecord,
  SecondResearchOutcome,
  WebsiteResolutionSnapshot,
} from "./types";
import { DEPTH_PRESETS } from "./types";

/**
 * Orchestrates a full research run over the modules already built. Its job is
 * sequencing and error containment, not analysis: every rule (anti-invention,
 * confidence, minimum 3 competitors, second research thresholds, scoring
 * weights) lives in the modules it calls and is not restated here.
 *
 * §13 is the governing constraint: one unreachable website must never end the
 * run. Every per-business step is wrapped so its failure is recorded against
 * that business and the sweep continues.
 */

const STEP_DEFINITIONS: { key: string; label: string }[] = [
  { key: "discovery", label: "Descubriendo negocios" },
  { key: "dedupe", label: "Eliminando duplicados" },
  { key: "website", label: "Resolviendo webs" },
  { key: "scan", label: "Analizando webs" },
  { key: "mobile", label: "Analizando móvil" },
  { key: "competitors", label: "Analizando competencia" },
  { key: "scoring", label: "Puntuando oportunidades" },
  { key: "second", label: "Segunda investigación" },
  { key: "ranking", label: "Generando ranking" },
];

export interface DiscoveryPort {
  readonly isActive: boolean;
  search(options: { query: string; maxResults?: number; sector?: string }): Promise<DiscoveryResult>;
}

export interface RunResearchOptions {
  config: ResearchConfig;
  repository: AgencyRepository;
  /** Ties every memory event to the run that produced it. */
  runId?: string;
  /** Injectable so tests can drive the pipeline with controlled data. */
  discovery?: DiscoveryPort;
  onProgress?: (steps: ProgressStep[]) => void;
  now?: () => Date;
  scanOptions?: ScanOptions;
  mobileOptions?: { executablePath?: string; allowLoopbackForTesting?: boolean };
  /** Skips the mobile pass regardless of depth (no browser available). */
  disableMobile?: boolean;
}

class ProgressTracker {
  readonly steps: ProgressStep[];

  constructor(
    activeKeys: string[],
    private readonly onProgress?: (steps: ProgressStep[]) => void
  ) {
    this.steps = STEP_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      status: activeKeys.includes(definition.key) ? "PENDING" : "SKIPPED",
      current: 0,
      total: 0,
      detail: activeKeys.includes(definition.key) ? null : "No incluido en esta profundidad",
    }));
  }

  private emit() {
    this.onProgress?.(this.steps.map((step) => ({ ...step })));
  }

  start(key: string, total: number) {
    const step = this.steps.find((s) => s.key === key);
    if (!step || step.status === "SKIPPED") return;
    step.status = "RUNNING";
    step.total = total;
    step.current = 0;
    this.emit();
  }

  advance(key: string, detail?: string) {
    const step = this.steps.find((s) => s.key === key);
    if (!step || step.status === "SKIPPED") return;
    step.current += 1;
    if (detail) step.detail = detail;
    this.emit();
  }

  finish(key: string, detail: string) {
    const step = this.steps.find((s) => s.key === key);
    if (!step || step.status === "SKIPPED") return;
    step.status = "DONE";
    step.detail = detail;
    step.current = step.total;
    this.emit();
  }

  fail(key: string, detail: string) {
    const step = this.steps.find((s) => s.key === key);
    if (!step) return;
    step.status = "FAILED";
    step.detail = detail;
    this.emit();
  }
}

function buildQuery(config: ResearchConfig): string {
  const what = config.subsector ?? config.sector ?? "negocios";
  return `${what} en ${config.municipality}`;
}

function toCandidate(url: string | null | undefined): WebsiteCandidate[] {
  return url ? [{ url, origin: "search_result" as const }] : [];
}

export async function runResearch(options: RunResearchOptions): Promise<ResearchRunRecord> {
  const { config, repository, onProgress, runId } = options;
  const now = options.now ?? (() => new Date());
  const preset = DEPTH_PRESETS[config.depth];
  const issues: ResearchIssue[] = [];

  const activeKeys = [
    "discovery",
    "dedupe",
    ...(preset.resolveWebsite ? ["website"] : []),
    ...(preset.scanWebsite ? ["scan"] : []),
    ...(preset.auditMobile && !options.disableMobile ? ["mobile"] : []),
    ...(preset.analyzeCompetitors ? ["competitors"] : []),
    "scoring",
    ...(preset.secondResearch ? ["second"] : []),
    "ranking",
  ];

  const progress = new ProgressTracker(activeKeys, onProgress);
  const startedAt = now().toISOString();

  const run: ResearchRunRecord = {
    id: "",
    config,
    status: "RUNNING",
    steps: progress.steps,
    results: [],
    issues,
    startedAt,
    finishedAt: null,
    error: null,
  };

  // ---- 1. Discovery -------------------------------------------------------
  progress.start("discovery", 1);
  let discovered: RawBusinessRecord[];
  try {
    if (options.discovery) {
      // Injected port (tests, or a future optional search module).
      const result = await options.discovery.search({
        query: buildQuery(config),
        maxResults: config.maxBusinesses,
        sector: config.sector,
      });
      discovered = result.records;

      // Coverage is recorded here too, not only on the built-in path. It is
      // what tells the autonomous cycle where it has already been, and a
      // sweep that leaves no trace would be silently repeated forever.
      const bySource = new Map<string, number>();
      for (const record of result.records) {
        bySource.set(record.source, (bySource.get(record.source) ?? 0) + 1);
      }
      for (const [source, count] of bySource) {
        recordSourceQuery(
          {
            source: source as never,
            municipality: config.municipality,
            sector: config.sector ?? null,
            category: config.subsector ?? null,
            returned: count,
            usable: count,
            ok: true,
            durationMs: 0,
            error: null,
          },
          { runId: runId ?? null }
        );
      }

      for (const error of result.errors) {
        issues.push({
          businessName: null,
          phase: "discovery",
          code: "DISCOVERY_ROW_SKIPPED",
          message: error.message,
        });
      }
    } else {
      const result = await discoverBusinesses({
        municipality: config.municipality,
        category: config.subsector,
        maxResults: config.maxBusinesses,
        includeTourismRegister: usesTourismRegister(config.sector),
      });

      // Corroboration decides identity confidence; discovery only reports it.
      discovered = result.businesses.map((entry) => entry.record);

      // Memory (FASE 1): what each source actually produced, so the learning
      // engine measures real yield instead of assumptions.
      for (const report of result.reports) {
        recordSourceQuery(
          {
            source: report.source as never,
            municipality: config.municipality,
            sector: config.sector ?? null,
            category: config.subsector ?? null,
            returned: report.records,
            usable: report.usable,
            ok: report.ok,
            durationMs: report.durationMs,
            error: report.error,
          },
          { runId: runId ?? null }
        );
      }

      for (const report of result.reports) {
        if (!report.ok) {
          issues.push({
            businessName: null,
            phase: "discovery",
            code: "SOURCE_UNAVAILABLE",
            message: `${report.source}: ${report.error}`,
          });
        }
      }
      for (const error of result.errors) {
        issues.push({
          businessName: null,
          phase: "discovery",
          code: "DISCOVERY_ROW_SKIPPED",
          message: error.message,
        });
      }
      issues.push({
        businessName: null,
        phase: "discovery",
        code: "CORROBORATION_SUMMARY",
        message: `Verificados: ${result.summary.VERIFICADO} · Probables: ${result.summary.PROBABLE} · Contradictorios: ${result.summary.NO_VERIFICADO}`,
      });
    }

    // Every source is free and keyless, so a run can no longer fail for lack
    // of a paid credential — only for lack of data.
    progress.finish("discovery", `${discovered.length} encontrados`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fallo en el descubrimiento";
    progress.fail("discovery", message);
    return {
      ...run,
      status: "FAILED",
      steps: progress.steps,
      finishedAt: now().toISOString(),
      error: message,
    };
  }

  // ---- 2. Dedupe ----------------------------------------------------------
  progress.start("dedupe", 1);
  const { unique, duplicates } = dedupeBatch(
    discovered.map((record) => ({
      ...record,
      phone: record.phone ?? null,
      website_url: record.website_url ?? null,
      address: record.address ?? null,
      city: record.city ?? null,
      gbp_place_id: record.gbp_place_id ?? null,
    }))
  );
  for (const duplicate of duplicates) {
    issues.push({
      businessName: duplicate.record.name,
      phase: "dedupe",
      code: "DUPLICATE_SKIPPED",
      message: `Duplicado descartado por ${duplicate.reason}`,
    });
  }

  // Also drop anything already stored, so re-running a sweep never creates a
  // second prospect for a business we already hold.
  const existing = await repository.listBusinesses();
  const fresh = unique.filter((record) => {
    const match = findDuplicate(record, existing);
    if (match) {
      issues.push({
        businessName: record.name,
        phase: "dedupe",
        code: "ALREADY_IN_DATABASE",
        message: `Ya estaba en la base de datos (${match.reason})`,
      });
    }
    return !match;
  });
  // Hard cap (§1). Discovery already limits its own results, but the ceiling
  // is restated here on the *unique* records that actually enter the
  // pipeline, so no future change upstream can quietly widen it.
  const capped = fresh.slice(0, config.maxBusinesses);
  if (capped.length < fresh.length) {
    issues.push({
      businessName: null,
      phase: "dedupe",
      code: "MAX_BUSINESSES_REACHED",
      message: `Límite de ${config.maxBusinesses} negocios alcanzado: ${fresh.length - capped.length} descartados sin analizar.`,
    });
  }
  progress.finish("dedupe", `${capped.length} negocios únicos`);

  const imported = await repository.importBusinesses(
    capped.map(({ phone, website_url, address, city, gbp_place_id, ...rest }) => ({
      ...rest,
      ...(phone ? { phone } : {}),
      ...(website_url ? { website_url } : {}),
      ...(address ? { address } : {}),
      ...(city ? { city } : {}),
      ...(gbp_place_id ? { gbp_place_id } : {}),
    })),
    null
  );

  const businesses = imported.inserted;
  const settings = await repository.getSettings();

  const resolutions = new Map<string, WebsiteResolutionSnapshot>();
  const evidenceByBusiness = new Map<string, Evidence[]>();
  const mobileByBusiness = new Map<string, Awaited<ReturnType<typeof auditMobile>>>();
  const failedPhases = new Map<string, string[]>();

  const recordFailure = (business: Business, phase: string, code: string, message: string) => {
    issues.push({ businessName: business.name, phase, code, message });
    failedPhases.set(business.id, [...(failedPhases.get(business.id) ?? []), code]);
  };

  const addEvidence = (businessId: string, items: Evidence[]) => {
    evidenceByBusiness.set(businessId, [...(evidenceByBusiness.get(businessId) ?? []), ...items]);
  };

  // ---- 3. Website resolution ---------------------------------------------
  if (preset.resolveWebsite) {
    progress.start("website", businesses.length);
    let verified = 0;
    for (const business of businesses) {
      try {
        const resolution = await resolveOfficialWebsite(
          {
            name: business.name,
            phone: business.phone,
            address: business.address,
            city: business.city,
          },
          toCandidate(business.website_url),
          { ...options.scanOptions, now: now() }
        );

        const snapshot: WebsiteResolutionSnapshot = {
          status: resolution.website.status,
          url: resolution.website.status === "NO_VERIFICADO" ? null : resolution.website.value,
          missing: resolution.website.status === "NO_VERIFICADO" ? resolution.website.missing : null,
          assessments: resolution.assessments,
        };
        resolutions.set(business.id, snapshot);
        addEvidence(business.id, resolution.evidence);
        if (snapshot.status !== "NO_VERIFICADO") verified++;
      } catch (err) {
        recordFailure(
          business,
          "website",
          "WEB_RESOLUTION_FAILED",
          err instanceof Error ? err.message : "Fallo resolviendo la web"
        );
      }
      progress.advance("website");
    }
    progress.finish("website", `${verified} webs verificadas`);
  }

  // ---- 4. Website scan ----------------------------------------------------
  if (preset.scanWebsite) {
    progress.start("scan", businesses.length);
    let completed = 0;
    for (const business of businesses) {
      const url = resolutions.get(business.id)?.url ?? business.website_url;
      if (!url) {
        progress.advance("scan");
        continue;
      }

      try {
        const scan = await scanWebsite(url, options.scanOptions);
        if (scan.status === "failed") {
          recordFailure(business, "scan", "WEB_SCAN_FAILED", scan.error ?? "La web no respondió");
        } else {
          await repository.saveWebsiteScan({
            website_id: null,
            business_id: business.id,
            status: scan.status,
            source: "internal-scanner",
            technical: scan.technical,
            seo: scan.seo,
            conversion: scan.conversion,
            design: scan.design,
            performance: scan.performance,
            unavailable_metrics: scan.unavailableMetrics,
          });
          completed++;

          addEvidence(business.id, [
            fact({
              statement: `HTTPS: ${scan.technical.https === true ? "sí" : "no"}. Título: ${
                scan.seo.title ? `"${scan.seo.title}"` : "ausente"
              }. Vías de contacto directas: ${
                scan.conversion.has_phone_link || scan.conversion.has_whatsapp_link || scan.conversion.has_contact_form
                  ? "sí"
                  : "ninguna"
              }.`,
              source: "official_website",
              method: "html_parse",
              sourceUrl: url,
              now: now(),
            }),
          ]);
        }
      } catch (err) {
        recordFailure(
          business,
          "scan",
          "WEB_SCAN_FAILED",
          err instanceof Error ? err.message : "Error analizando la web"
        );
      }
      progress.advance("scan");
    }
    progress.finish("scan", `${completed} completadas`);
  }

  // ---- 5. Mobile audit ----------------------------------------------------
  if (preset.auditMobile && !options.disableMobile) {
    progress.start("mobile", businesses.length);
    let completed = 0;
    for (const business of businesses) {
      const url = resolutions.get(business.id)?.url ?? business.website_url;
      if (!url) {
        progress.advance("mobile");
        continue;
      }

      try {
        const audit = await auditMobile(url, options.mobileOptions);
        mobileByBusiness.set(business.id, audit);
        if (audit.status === "completed") {
          completed++;
          for (const finding of audit.findings) {
            addEvidence(business.id, [
              fact({
                statement: finding.detail,
                source: "official_website",
                method: "headless_browser",
                sourceUrl: url,
                now: now(),
              }),
            ]);
          }
        } else {
          recordFailure(
            business,
            "mobile",
            "MOBILE_SCAN_UNAVAILABLE",
            audit.unavailableReason ?? "Auditoría móvil no disponible"
          );
        }
      } catch (err) {
        recordFailure(
          business,
          "mobile",
          "MOBILE_SCAN_FAILED",
          err instanceof Error ? err.message : "Error en la auditoría móvil"
        );
      }
      progress.advance("mobile");
    }
    progress.finish("mobile", `${completed} completadas`);
  }

  // ---- 6. Competitors -----------------------------------------------------
  const competitorsByBusiness = new Map<string, CompetitorSnapshot[]>();
  if (preset.analyzeCompetitors) {
    progress.start("competitors", businesses.length);
    let withEnough = 0;
    const allKnown = await repository.listBusinesses();

    for (const business of businesses) {
      const peers = allKnown.filter(
        (candidate) =>
          candidate.id !== business.id &&
          candidate.sector === business.sector &&
          candidate.city === business.city
      );
      competitorsByBusiness.set(
        business.id,
        peers.map((peer) => ({
          name: peer.name,
          city: peer.city,
          website_url: peer.website_url,
          rating: peer.rating,
          review_count: peer.review_count,
        }))
      );
      // The minimum-3 rule itself lives in the scoring module; this only
      // reports how many were available.
      if (peers.length >= 3) withEnough++;
      progress.advance("competitors");
    }
    progress.finish("competitors", `${withEnough} con 3+ competidores`);
  }

  // ---- 7. Scoring ---------------------------------------------------------
  progress.start("scoring", businesses.length);
  const results: ResearchResultItem[] = [];

  for (const business of businesses) {
    try {
      const scan = await repository.getLatestWebsiteScan(business.id);
      const competitors = competitorsByBusiness.get(business.id) ?? [];

      // Keep the legacy opportunity/lead scores in sync so the rest of the
      // app (dashboard KPIs, pipeline) keeps working off one source.
      await repository.saveScore(
        business.id,
        computeScores({ business, scan, weights: settings.scoring_weights })
      );

      const commercial = computeCommercialScore({
        business,
        scan,
        settings,
        peers: competitors.map((c) => ({ review_count: c.review_count, rating: c.rating })),
        now: now(),
      });

      const necesidad = commercial.factors.find((f) => f.key === "necesidad");
      const resolution = resolutions.get(business.id) ?? null;
      const mobile = mobileByBusiness.get(business.id) ?? null;

      if (resolution?.status === "NO_VERIFICADO" && resolution.missing) {
        addEvidence(business.id, [
          observation({
            statement: `Web sin confirmar: ${resolution.missing}`,
            source: "internal_database",
            method: "cross_reference",
            status: "NO_VERIFICADO",
            now: now(),
          }),
        ]);
      }

      recordEvent({
        type: "CONCLUSION_REACHED",
        runId: runId ?? null,
        businessId: business.id,
        businessName: business.name,
        municipality: business.city,
        sector: business.sector,
        source: business.source,
        summary: `Puntuado ${commercial.score}/100 con ${Math.round(commercial.confidence * 100)}% de evidencia (${commercial.tier}).`,
        data: {
          score: commercial.score,
          confidence: commercial.confidence,
          tier: commercial.tier,
          recommendedService: commercial.recommendedService,
          factors: commercial.factors.map((f) => ({ key: f.key, points: f.points, status: f.status })),
        },
      });

      results.push({
        businessId: business.id,
        name: business.name,
        city: business.city,
        sector: business.sector,
        score: commercial.score,
        confidence: commercial.confidence,
        tier: commercial.tier,
        factors: commercial.factors,
        recommendedService: commercial.recommendedService,
        recommendationReason: commercial.recommendationReason,
        primaryProblem: necesidad?.evidence[0] ?? null,
        evidence: evidenceByBusiness.get(business.id) ?? [],
        websiteResolution: resolution,
        mobileAudit: mobile,
        competitors,
        competitorsVerified: competitors.length >= 3,
        verificationStatus: business.verification_status,
        corroboratingSources: business.corroborating_sources ?? [],
        secondResearch: null,
        failedPhases: failedPhases.get(business.id) ?? [],
      });
    } catch (err) {
      recordFailure(
        business,
        "scoring",
        "SCORING_FAILED",
        err instanceof Error ? err.message : "Error puntuando"
      );
    }
    progress.advance("scoring");
  }
  progress.finish("scoring", `${results.length} puntuadas`);

  // ---- 8. Second research -------------------------------------------------
  if (preset.secondResearch) {
    const candidates = results.filter((r) => needsSecondResearch(r.score).required);
    progress.start("second", candidates.length);

    for (const result of candidates) {
      const { depth } = needsSecondResearch(result.score);
      try {
        const outcome = await runSecondResearch(result, {
          repository,
          scanOptions: options.scanOptions,
          settings,
          now,
          depth: depth as "standard" | "strict",
        });
        result.secondResearch = outcome;
      } catch (err) {
        issues.push({
          businessName: result.name,
          phase: "second",
          code: "SECOND_RESEARCH_FAILED",
          message: err instanceof Error ? err.message : "Error en la segunda investigación",
        });
      }
      progress.advance("second");
    }
    progress.finish("second", `${candidates.length} revisadas`);
  }

  // ---- 9. Ranking ---------------------------------------------------------
  progress.start("ranking", 1);
  results.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  progress.finish("ranking", `${results.length} oportunidades ordenadas`);

  return {
    ...run,
    status: "COMPLETED",
    steps: progress.steps,
    results,
    issues,
    finishedAt: now().toISOString(),
  };
}

/**
 * §16: re-checks a high-scoring lead, trying to contradict the first pass.
 * Re-runs the website scan and re-scores; if the conclusion changes, the
 * corrected value wins and the change is recorded rather than hidden.
 */
async function runSecondResearch(
  result: ResearchResultItem,
  context: {
    repository: AgencyRepository;
    settings: Settings;
    scanOptions?: ScanOptions;
    now: () => Date;
    depth: "standard" | "strict";
  }
): Promise<SecondResearchOutcome> {
  const { repository, settings, now, depth } = context;
  const confirmed: string[] = [];
  const corrected: string[] = [];
  const scoreBefore = result.score;

  const business = await repository.getBusiness(result.businessId);
  if (!business) {
    return { performed: false, depth, confirmed, corrected, scoreBefore, scoreAfter: scoreBefore };
  }

  const url = result.websiteResolution?.url ?? business.website_url;

  if (url) {
    const rescan = await scanWebsite(url, context.scanOptions);
    if (rescan.status === "failed") {
      corrected.push(`La web dejó de responder en la segunda comprobación: ${rescan.error}`);
    } else {
      const previous = await repository.getLatestWebsiteScan(business.id);
      const previousHttps = previous?.technical.https;
      if (previousHttps !== undefined && previousHttps !== rescan.technical.https) {
        corrected.push(
          `HTTPS pasó de ${String(previousHttps)} a ${String(rescan.technical.https)} entre comprobaciones.`
        );
      } else {
        confirmed.push(`HTTPS confirmado: ${rescan.technical.https === true ? "sí" : "no"}.`);
      }

      const previousTitle = previous?.seo.title ?? null;
      if (previousTitle !== (rescan.seo.title ?? null)) {
        corrected.push("El title cambió entre la primera y la segunda comprobación.");
      } else {
        confirmed.push("Title confirmado en la segunda comprobación.");
      }

      await repository.saveWebsiteScan({
        website_id: null,
        business_id: business.id,
        status: rescan.status,
        source: "internal-scanner-second-pass",
        technical: rescan.technical,
        seo: rescan.seo,
        conversion: rescan.conversion,
        design: rescan.design,
        performance: rescan.performance,
        unavailable_metrics: rescan.unavailableMetrics,
      });
    }
  } else {
    confirmed.push("Sin web que revisar: el estado se mantiene como no verificado.");
  }

  const scan = await repository.getLatestWebsiteScan(business.id);
  const rescored = computeCommercialScore({
    business,
    scan,
    settings,
    peers: result.competitors.map((c) => ({ review_count: c.review_count, rating: c.rating })),
    now: now(),
  });

  if (rescored.score !== scoreBefore) {
    corrected.push(`Puntuación corregida de ${scoreBefore} a ${rescored.score}.`);
    result.score = rescored.score;
    result.confidence = rescored.confidence;
    result.tier = rescored.tier;
    result.factors = rescored.factors;
  }

  return {
    performed: true,
    depth,
    confirmed,
    corrected,
    scoreBefore,
    scoreAfter: rescored.score,
  };
}
