// Separate from actions.ts: a "use server" module may only export async
// functions, so the initial-state constant lives here.
export interface StartResearchState {
  error: string | null;
  runId: string | null;
}

export const initialStartResearchState: StartResearchState = { error: null, runId: null };
