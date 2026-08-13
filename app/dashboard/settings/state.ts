// Kept out of actions.ts on purpose: a "use server" module may only export
// async functions, so the initial-state constant lives here.
import type { ScoringWeights } from "@/lib/scoring/weights";

export interface SettingsState {
  error: string | null;
  message: string | null;
  /** Weights as actually stored (normalised), so the form can show them back. */
  weights?: ScoringWeights;
}

export const initialSettingsState: SettingsState = { error: null, message: null };
