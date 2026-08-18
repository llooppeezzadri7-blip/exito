import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryPersistence } from "./persistence";
import type { MemoryEvent, MemoryEventType } from "./research-memory";
import type { ErrorRecord, ErrorCategory, ErrorStatus } from "./error-memory";
import type { Experiment, ExperimentStatus } from "./experiments";
import { checkAutonomousChange } from "./hard-constraints";
import type { BusinessSource } from "@/lib/database/types";

/**
 * FASE 5.2 — the durable backend.
 *
 * Deliberately dumb: it maps rows to the shapes the memory modules already
 * use and nothing else. No filtering logic, no derived statistics, no
 * business rules — those all stay in `learning.ts` where they are tested.
 * A persistence layer that starts making judgements is a persistence layer
 * that can silently change what the system believes.
 */

interface MemoryEventRow {
  id: string;
  type: string;
  at: string;
  run_id: string | null;
  business_id: string | null;
  business_name: string | null;
  municipality: string | null;
  sector: string | null;
  source: string | null;
  summary: string;
  data: Record<string, unknown>;
}

interface KnownErrorRow {
  id: string;
  category: string;
  description: string;
  wrong_conclusion: string | null;
  correct_conclusion: string | null;
  lesson: string;
  business_name: string | null;
  detected_at: string;
  fixed_at: string | null;
  regression_test: string | null;
}

interface ExperimentRow {
  id: string;
  hypothesis: string;
  target_area: string;
  status: string;
  auto_applicable: boolean;
  constraint_reason: string;
  conclusion: Experiment["conclusion"];
  created_at: string;
  concluded_at: string | null;
}

interface ObservationRow {
  experiment_id: string;
  variant_id: string;
  variant_description: string;
  value: number;
}

export class SupabaseMemoryPersistence implements MemoryPersistence {
  readonly name = "supabase";

  constructor(
    private readonly client: SupabaseClient,
    private readonly ownerId: string
  ) {}

  async loadEvents(limit: number): Promise<MemoryEvent[]> {
    const { data, error } = await this.client
      .from("memory_events")
      .select("*")
      .eq("owner_id", this.ownerId)
      .order("at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`No se pudo leer memory_events: ${error.message}`);

    // Fetched newest-first so the limit keeps the most recent, returned
    // oldest-first because that is the order the log is reasoned about in.
    return ((data ?? []) as MemoryEventRow[])
      .map(
        (row): MemoryEvent => ({
          id: row.id,
          type: row.type as MemoryEventType,
          at: row.at,
          runId: row.run_id,
          businessId: row.business_id,
          businessName: row.business_name,
          municipality: row.municipality,
          sector: row.sector,
          source: (row.source as BusinessSource | null) ?? null,
          summary: row.summary,
          data: row.data ?? {},
        })
      )
      .reverse();
  }

  async appendEvent(event: MemoryEvent): Promise<void> {
    const { error } = await this.client.from("memory_events").insert({
      id: event.id,
      owner_id: this.ownerId,
      type: event.type,
      at: event.at,
      run_id: event.runId,
      // Only a real database id is written to the FK column; the synthetic
      // ids the mock repository produces would fail the constraint and take
      // the whole write with them.
      business_id: isUuid(event.businessId) ? event.businessId : null,
      business_name: event.businessName,
      municipality: event.municipality,
      sector: event.sector,
      source: event.source,
      summary: event.summary,
      data: event.data,
    });

    if (error) throw new Error(`No se pudo guardar el evento: ${error.message}`);
  }

  async loadErrors(): Promise<ErrorRecord[]> {
    const { data, error } = await this.client
      .from("known_errors")
      .select("*")
      .eq("owner_id", this.ownerId)
      .order("detected_at", { ascending: true });

    if (error) throw new Error(`No se pudo leer known_errors: ${error.message}`);

    return ((data ?? []) as KnownErrorRow[]).map((row): ErrorRecord => {
      const status: ErrorStatus = row.fixed_at
        ? "FIXED"
        : row.regression_test
          ? "TEST_WRITTEN"
          : "OPEN";

      return {
        id: row.id,
        category: row.category as ErrorCategory,
        claim: row.wrong_conclusion ?? row.description,
        reality: row.correct_conclusion ?? "",
        cause: row.description,
        detectedAt: row.detected_at,
        detectedBy: "user",
        businessName: row.business_name,
        status,
        regressionTest: row.regression_test,
        fix: row.lesson,
      };
    });
  }

  async saveError(record: ErrorRecord): Promise<void> {
    const { error } = await this.client.from("known_errors").upsert({
      id: record.id,
      owner_id: this.ownerId,
      category: record.category,
      description: record.cause,
      wrong_conclusion: record.claim,
      correct_conclusion: record.reality,
      lesson: record.fix ?? record.cause,
      business_name: record.businessName,
      detected_at: record.detectedAt,
      // The database enforces the same rule the code does: no fix without a
      // regression test. Sending one without the other is rejected there too.
      fixed_at: record.status === "FIXED" ? new Date().toISOString() : null,
      regression_test: record.regressionTest,
    });

    if (error) throw new Error(`No se pudo guardar el error conocido: ${error.message}`);
  }

  async loadExperiments(): Promise<Experiment[]> {
    const { data, error } = await this.client
      .from("experiments")
      .select("*")
      .eq("owner_id", this.ownerId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`No se pudo leer experiments: ${error.message}`);

    const rows = (data ?? []) as ExperimentRow[];
    if (rows.length === 0) return [];

    const { data: observationData, error: observationError } = await this.client
      .from("experiment_observations")
      .select("experiment_id, variant_id, variant_description, value")
      .in(
        "experiment_id",
        rows.map((row) => row.id)
      );

    if (observationError) {
      throw new Error(`No se pudieron leer las observaciones: ${observationError.message}`);
    }

    const byExperiment = new Map<string, ObservationRow[]>();
    for (const observation of (observationData ?? []) as ObservationRow[]) {
      byExperiment.set(observation.experiment_id, [
        ...(byExperiment.get(observation.experiment_id) ?? []),
        observation,
      ]);
    }

    return rows.map((row): Experiment => {
      const observations = byExperiment.get(row.id) ?? [];
      const variants = new Map<string, { id: string; description: string; observations: number[] }>();

      for (const observation of observations) {
        const variant = variants.get(observation.variant_id) ?? {
          id: observation.variant_id,
          description: observation.variant_description,
          observations: [],
        };
        variant.observations.push(Number(observation.value));
        variants.set(observation.variant_id, variant);
      }

      return {
        id: row.id,
        hypothesis: row.hypothesis,
        targetArea: row.target_area,
        status: row.status as ExperimentStatus,
        variants: [...variants.values()],
        createdAt: row.created_at,
        concludedAt: row.concluded_at,
        // Re-evaluated against today's rules, not restored from the row. The
        // stored columns are an audit trail of what was permitted when the
        // experiment was created; if a rule has since been tightened, an
        // experiment started under the looser one must not keep the old
        // permission. Rules only ever get to bind harder on reload.
        constraint: checkAutonomousChange(row.target_area),
        conclusion: row.conclusion,
      };
    });
  }

  async saveExperiment(experiment: Experiment): Promise<void> {
    const { error } = await this.client.from("experiments").upsert({
      id: experiment.id,
      owner_id: this.ownerId,
      hypothesis: experiment.hypothesis,
      target_area: experiment.targetArea,
      status: experiment.status,
      auto_applicable: experiment.constraint.allowed,
      constraint_reason: experiment.constraint.reason,
      conclusion: experiment.conclusion,
      created_at: experiment.createdAt,
      concluded_at: experiment.concludedAt,
    });

    if (error) throw new Error(`No se pudo guardar el experimento: ${error.message}`);

    // Observations are replaced wholesale rather than diffed. They are an
    // append-only list in memory, so rewriting them cannot lose one, and the
    // alternative — tracking which have already been written — is state this
    // layer has no business keeping.
    const { error: deleteError } = await this.client
      .from("experiment_observations")
      .delete()
      .eq("experiment_id", experiment.id);

    if (deleteError) {
      throw new Error(`No se pudieron limpiar las observaciones: ${deleteError.message}`);
    }

    const rows = experiment.variants.flatMap((variant) =>
      variant.observations.map((value) => ({
        experiment_id: experiment.id,
        owner_id: this.ownerId,
        variant_id: variant.id,
        variant_description: variant.description,
        value,
      }))
    );

    if (rows.length === 0) return;

    const { error: insertError } = await this.client.from("experiment_observations").insert(rows);
    if (insertError) {
      throw new Error(`No se pudieron guardar las observaciones: ${insertError.message}`);
    }
  }
}

function isUuid(value: string | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
