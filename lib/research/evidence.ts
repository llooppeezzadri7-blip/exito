/**
 * Provenance and evidence primitives (brief §3, §4, §17, §18).
 *
 * Every fact this system reports about a business must carry where it came
 * from, how it was obtained, and when it was checked. The types here make
 * that non-optional: there is no way to construct a DataPoint without a
 * source, and `unverified()` is the only way to represent "we don't know",
 * which deliberately carries no value at all.
 */

export type VerificationStatus = "VERIFICADO" | "PROBABLE" | "NO_VERIFICADO";

/** How a piece of data reached us. Narrower than "source" — the mechanism. */
export type ObtentionMethod =
  | "google_places_api"
  | "http_fetch"
  | "headless_browser"
  | "html_parse"
  | "cross_reference"
  | "csv_import"
  | "manual_entry"
  | "computed";

/** Where the data came from, as a citable origin. */
export type DataSource =
  | "google_places"
  | "official_website"
  | "robots_txt"
  | "sitemap_xml"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "csv_import"
  | "manual"
  | "internal_database";

export interface DataPoint<T> {
  value: T;
  source: DataSource;
  /** The exact URL the value was read from, when there is one. */
  sourceUrl: string | null;
  method: ObtentionMethod;
  checkedAt: string;
  status: Exclude<VerificationStatus, "NO_VERIFICADO">;
}

/** An explicitly unknown data point. Carries no value — by construction. */
export interface UnknownDataPoint {
  value: null;
  status: "NO_VERIFICADO";
  /** What would have to be done to resolve it. */
  missing: string;
  checkedAt: string;
}

export type MaybeDataPoint<T> = DataPoint<T> | UnknownDataPoint;

export function isVerified<T>(point: MaybeDataPoint<T>): point is DataPoint<T> {
  return point.status !== "NO_VERIFICADO";
}

/**
 * Reads a data point's value, or a fallback when it is unknown. This is the
 * only sanctioned way to unwrap one — it forces the caller to say what
 * happens when the datum was never verified, instead of letting `undefined`
 * flow silently into a scoring rule.
 */
export function valueOr<T, F>(point: MaybeDataPoint<T>, fallback: F): T | F {
  return isVerified(point) ? point.value : fallback;
}

export interface DataPointInit<T> {
  value: T;
  source: DataSource;
  method: ObtentionMethod;
  sourceUrl?: string | null;
  status?: Exclude<VerificationStatus, "NO_VERIFICADO">;
  now?: Date;
}

export function verified<T>(init: DataPointInit<T>): DataPoint<T> {
  return {
    value: init.value,
    source: init.source,
    sourceUrl: init.sourceUrl ?? null,
    method: init.method,
    checkedAt: (init.now ?? new Date()).toISOString(),
    status: init.status ?? "VERIFICADO",
  };
}

export function probable<T>(init: Omit<DataPointInit<T>, "status">): DataPoint<T> {
  return verified({ ...init, status: "PROBABLE" });
}

export function unverified(missing: string, now?: Date): UnknownDataPoint {
  return { value: null, status: "NO_VERIFICADO", missing, checkedAt: (now ?? new Date()).toISOString() };
}

/**
 * The three levels of §18. A FACT is something observed directly. An
 * OBSERVATION is what we read into it. An OPPORTUNITY is what we might sell
 * because of it — and it is never allowed to masquerade as a fact.
 */
export type EvidenceKind = "FACT" | "OBSERVATION" | "OPPORTUNITY";

export interface Evidence {
  kind: EvidenceKind;
  /** One concrete, checkable sentence. Never "el SEO podría mejorar". */
  statement: string;
  sourceUrl: string | null;
  source: DataSource;
  method: ObtentionMethod;
  checkedAt: string;
  status: VerificationStatus;
}

export interface EvidenceInit {
  statement: string;
  source: DataSource;
  method: ObtentionMethod;
  sourceUrl?: string | null;
  status?: VerificationStatus;
  now?: Date;
}

function evidence(kind: EvidenceKind, init: EvidenceInit): Evidence {
  return {
    kind,
    statement: init.statement,
    sourceUrl: init.sourceUrl ?? null,
    source: init.source,
    method: init.method,
    checkedAt: (init.now ?? new Date()).toISOString(),
    // An opportunity is an inference by definition: it can never be reported
    // as VERIFICADO however solid the fact underneath it is (§18).
    status: kind === "OPPORTUNITY" ? "PROBABLE" : init.status ?? "VERIFICADO",
  };
}

export const fact = (init: EvidenceInit) => evidence("FACT", init);
export const observation = (init: EvidenceInit) => evidence("OBSERVATION", init);
export const opportunity = (init: EvidenceInit) => evidence("OPPORTUNITY", init);

/** A detected problem, always anchored to the evidence that proves it (§17). */
export interface DetectedProblem {
  /** Stable key so the same problem can be tracked across research rounds. */
  key: string;
  title: string;
  severity: "critical" | "serious" | "moderate";
  evidence: Evidence[];
}

export function problemIsProven(problem: DetectedProblem): boolean {
  return problem.evidence.some((e) => e.kind === "FACT" && e.status === "VERIFICADO");
}
