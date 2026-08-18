// Separate from actions.ts: a "use server" module may only export async
// functions, so the initial-state constant lives here.
export interface RunCycleState {
  error: string | null;
  summary: string | null;
}

export const initialRunCycleState: RunCycleState = { error: null, summary: null };
