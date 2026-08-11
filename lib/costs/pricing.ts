/**
 * First-party Anthropic API pricing, USD per million tokens. Verified
 * against the current model catalog (not guessed) — see the `claude-api`
 * skill's model table, cached 2026-06-24. Intro pricing on Sonnet 5 runs
 * through 2026-08-31; update this constant when it lapses.
 */
export const ANTHROPIC_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 }, // intro pricing through 2026-08-31 (standard: 3.00 / 15.00)
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export function estimateAnthropicCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = ANTHROPIC_PRICING_PER_MTOK[model];
  if (!rates) return 0;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}
