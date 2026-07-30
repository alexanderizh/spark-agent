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

/**
 * WP6/Phase 2.2 — request incremental (diff) AX trees on decision steps. The
 * client-side reconciler (see NativeHostTreeReconciler) rebuilds the full tree
 * text from the always-complete `elements` array, so the model input is
 * equivalent to a full request while saving the `tree.text` wire bytes.
 */
export function isIncrementalTreeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE)
}

/**
 * WP6/Phase 3 — allow the decision model to return a short batch of actions
 * (2–8) per round-trip. The operator executes them sequentially, re-checking
 * the target before each step and stopping the batch the moment a target goes
 * stale. Off = the model is asked for exactly one action per decision.
 */
export function isActionBatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.SPARK_COMPUTER_USE_V2_ACTION_BATCH)
}
