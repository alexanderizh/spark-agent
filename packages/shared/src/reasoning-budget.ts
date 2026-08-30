/** Claude explicit extended-thinking budget accepted by Spark Agent configuration. */
export const MIN_REASONING_BUDGET_TOKENS = 1_024
export const MAX_REASONING_BUDGET_TOKENS = 128_000

/**
 * Normalize an optional Agent metadata value into a safe integer token budget.
 * Invalid/out-of-range values deliberately fall back to SDK/provider defaults.
 */
export function normalizeReasoningBudgetTokens(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_REASONING_BUDGET_TOKENS ||
    parsed > MAX_REASONING_BUDGET_TOKENS
  ) {
    return undefined
  }
  return parsed
}
