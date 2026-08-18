import {
  concludeExperiment,
  createExperiment,
  listExperiments,
  recordObservation,
  MIN_OBSERVATIONS_PER_VARIANT,
  type Experiment,
} from "@/lib/memory/experiments";
import { sourcePerformance } from "@/lib/memory/learning";
import { AUTONOMOUS_AREAS } from "@/lib/memory/hard-constraints";

/**
 * FASE 5.7 — experiments that actually run.
 *
 * Until now the engine could hold an experiment but nothing ever fed it. This
 * connects it to the cycle: each unattended cycle is assigned a variant, its
 * result becomes an observation, and once every variant has enough
 * observations the experiment concludes itself.
 *
 * Assignment is balanced, not random. With five observations per variant,
 * randomness can easily hand one variant twice the runs of another and the
 * comparison stops meaning anything; picking the least-observed variant keeps
 * the arms even, and makes two identical situations behave identically, which
 * is what makes the result explainable afterwards.
 *
 * Every experiment proposed here targets an autonomous area. Hypotheses about
 * scoring or verification can still be registered by hand and measured, but
 * the system will not start one on its own — an experiment it runs itself is
 * an experiment it might apply itself.
 */

export interface ExperimentProposal {
  hypothesis: string;
  targetArea: string;
  variants: { id: string; description: string }[];
  /** Why now, and on what basis. */
  rationale: string;
}

/**
 * Looks for genuine uncertainty worth resolving. "Genuine" means there is
 * something to compare: two sources that have both actually been used, and no
 * running experiment already asking the same question.
 */
export function proposeExperiments(): ExperimentProposal[] {
  const proposals: ExperimentProposal[] = [];
  const running = listExperiments("RUNNING");
  const asking = new Set(running.map((experiment) => experiment.targetArea));

  const sources = sourcePerformance();
  const used = sources.filter((source) => source.queries > 0);

  if (used.length >= 2 && !asking.has("source_priority")) {
    const [first, second] = used;
    // Only worth testing when the two are close. A source that already
    // outperforms the other by a wide margin does not need an experiment; it
    // needs to be used.
    const gap = Math.abs(first.yieldPerQuery - second.yieldPerQuery);
    const closeEnough = gap <= Math.max(first.yieldPerQuery, second.yieldPerQuery) * 0.3;

    if (closeEnough) {
      proposals.push({
        hypothesis: `Consultar ${second.source} antes que ${first.source} produce más negocios aprovechables por ciclo.`,
        targetArea: "source_priority",
        variants: [
          { id: `${first.source}_primero`, description: `${first.source} primero` },
          { id: `${second.source}_primero`, description: `${second.source} primero` },
        ],
        rationale: `${first.source} rinde ${first.yieldPerQuery.toFixed(1)} y ${second.source} ${second.yieldPerQuery.toFixed(1)} por consulta: demasiado parecidos para decidir sin medirlo.`,
      });
    }
  }

  return proposals.filter((proposal) => AUTONOMOUS_AREAS.includes(proposal.targetArea as never));
}

/** Creates any proposed experiment that does not exist yet. */
export function ensureExperiments(now?: Date): Experiment[] {
  return proposeExperiments().map((proposal) =>
    createExperiment({
      hypothesis: proposal.hypothesis,
      targetArea: proposal.targetArea,
      variants: proposal.variants,
      at: now?.toISOString(),
    })
  );
}

export interface VariantAssignment {
  experimentId: string;
  variantId: string;
  variantDescription: string;
  hypothesis: string;
  /** Observations this variant already has. */
  observations: number;
}

/**
 * Assigns this cycle to the least-observed variant of each running
 * experiment. Ties break on the declared variant order, so the assignment is
 * deterministic and reproducible.
 */
export function assignVariants(): VariantAssignment[] {
  return listExperiments("RUNNING").flatMap((experiment) => {
    const leastObserved = [...experiment.variants].sort(
      (a, b) => a.observations.length - b.observations.length
    )[0];

    if (!leastObserved) return [];

    return [
      {
        experimentId: experiment.id,
        variantId: leastObserved.id,
        variantDescription: leastObserved.description,
        hypothesis: experiment.hypothesis,
        observations: leastObserved.observations.length,
      },
    ];
  });
}

/** Feeds this cycle's result back into whatever variants it was assigned. */
export function observeCycle(
  assignments: VariantAssignment[],
  usableBusinesses: number
): void {
  for (const assignment of assignments) {
    recordObservation(assignment.experimentId, assignment.variantId, usableBusinesses);
  }
}

export interface ConcludedExperiment {
  experiment: Experiment;
  /** Whether the winning variant may be adopted without a human. */
  autoApplicable: boolean;
}

/**
 * Concludes every running experiment whose variants all have enough
 * observations. Anything short of the threshold is left running rather than
 * concluded with a hedge — a verdict from too few runs is worse than no
 * verdict, because it looks like an answer.
 */
export function concludeReady(now?: Date): ConcludedExperiment[] {
  const ready = listExperiments("RUNNING").filter((experiment) =>
    experiment.variants.every(
      (variant) => variant.observations.length >= MIN_OBSERVATIONS_PER_VARIANT
    )
  );

  return ready.map((experiment) => {
    const concluded = concludeExperiment(experiment.id, now?.toISOString());
    return {
      experiment: concluded,
      autoApplicable: concluded.conclusion?.autoApplicable ?? false,
    };
  });
}
