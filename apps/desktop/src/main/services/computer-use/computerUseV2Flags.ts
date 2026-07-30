/**
 * Phase 2.1+ — minimal Computer Use V2 feature-flag gate.
 *
 * The full feature-flag system is Phase 7's deliverable. Until that lands,
 * each V2 work-package is gated behind an opt-in environment variable so the
 * existing single-connection path remains the default and V2 capabilities ship
 * strictly off-by-default. Phase 7 will replace these readers with a unified
 * flag store without changing call sites.
 *
 * All flags default to OFF (the current shipped behaviour). Set the variable to
 * `1` (or any non-empty value other than `0`/`false`) to enable.
 */

function isEnabled(variable: string | undefined): boolean {
  const value = variable?.trim().toLowerCase()
  if (value == null || value === '') return false
  return value !== '0' && value !== 'false' && value !== 'no' && value !== 'off'
}

/** WP3 — persistent Native Host connection with heartbeat + bounded restart. */
export function isHostSupervisorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR)
}
