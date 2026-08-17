/**
 * The rules learning is never allowed to touch.
 *
 * The system is meant to get better at *finding* opportunities, not at
 * convincing itself that weak evidence is strong. So the anti-invention and
 * verification rules are declared here as hard constraints, and every module
 * that produces an automatic change must be checked against them before it
 * can be applied. A proposal that touches one of these can still be made —
 * it just cannot be applied without a human approving it.
 */

export type ConstraintArea =
  | "verification_rules"
  | "scoring_weights"
  | "confidence_threshold"
  | "corroboration_rule"
  | "competitor_minimum"
  | "anti_invention";

export interface HardConstraint {
  area: ConstraintArea;
  statement: string;
  /** Why an automatic change here would be dangerous. */
  rationale: string;
}

export const HARD_CONSTRAINTS: HardConstraint[] = [
  {
    area: "anti_invention",
    statement: "Un dato que no se puede comprobar se reporta como NO_VERIFICADO, nunca se rellena.",
    rationale:
      "Es la regla que separa una lista defendible de una lista inventada. Ningún resultado de aprendizaje la justifica.",
  },
  {
    area: "corroboration_rule",
    statement:
      "Una fuente independiente = PROBABLE. Dos que coinciden = VERIFICADO. Contradicción = NO_VERIFICADO.",
    rationale:
      "Si el sistema pudiera relajar esto al ver que 'casi siempre acierta', volvería a afirmar cosas que no ha comprobado.",
  },
  {
    area: "confidence_threshold",
    statement: "Por debajo de dos tercios de evidencia, ningún lead puede ser prioridad máxima.",
    rationale: "Impide que un lead atractivo pero sin comprobar se cuele arriba del ranking.",
  },
  {
    area: "scoring_weights",
    statement: "Los pesos de los 7 factores y sus umbrales solo cambian con aprobación humana.",
    rationale:
      "El aprendizaje puede sugerir que un factor predice mejor, pero cambiar pesos solo es una decisión comercial.",
  },
  {
    area: "competitor_minimum",
    statement: "Sin 3 competidores comparables, la brecha competitiva es NO_VERIFICADO.",
    rationale: "Con menos, la mediana no significa nada y la comparación sería ruido presentado como dato.",
  },
  {
    area: "verification_rules",
    statement:
      "La ausencia de un campo solo es una afirmación si la fuente publica ese campo y lo devuelve vacío.",
    rationale:
      "Es la regla que evita repetir el error de dar por hecho que un negocio no tiene web porque no la encontramos.",
  },
];

/** Areas a learning or experiment proposal may modify on its own. */
export const AUTONOMOUS_AREAS = [
  "query_strategy",
  "source_priority",
  "municipality_order",
  "sector_order",
  "research_depth_hint",
] as const;

export type AutonomousArea = (typeof AUTONOMOUS_AREAS)[number];

export interface ConstraintCheck {
  allowed: boolean;
  violated: HardConstraint | null;
  reason: string;
}

/**
 * Decides whether a proposed change can be applied automatically. Anything
 * outside the explicitly autonomous areas is refused by default — the safe
 * direction when a new kind of proposal appears that nobody has classified.
 */
export function checkAutonomousChange(area: string): ConstraintCheck {
  const violated = HARD_CONSTRAINTS.find((constraint) => constraint.area === area);
  if (violated) {
    return {
      allowed: false,
      violated,
      reason: `"${area}" es una restricción dura: ${violated.statement} Requiere aprobación humana.`,
    };
  }

  if ((AUTONOMOUS_AREAS as readonly string[]).includes(area)) {
    return { allowed: true, violated: null, reason: `"${area}" es un área de ajuste autónomo.` };
  }

  return {
    allowed: false,
    violated: null,
    reason: `"${area}" no está clasificada como área autónoma. Por defecto se requiere aprobación.`,
  };
}
