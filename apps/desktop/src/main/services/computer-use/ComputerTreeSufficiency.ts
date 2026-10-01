import type { ComputerObservation } from '@spark/protocol'

/**
 * Tree-first perception policy (P0-A).
 *
 * The AX tree is the primary interface; the screenshot is a fallback channel for
 * custom-drawn UI and tree-less windows. Both consumers below must agree on
 * WHEN the tree alone is trustworthy, or the model gets contradictory signals
 * (an ax-first decision round-trip whose action result then answers with an
 * image and no usable ids):
 *
 * - `GenericComputerDecisionAdapter.decide` orders its model attempts by it
 *   (ax-only first, vision as the later candidate);
 * - `ComputerAtomicToolHandlers.result` omits the per-action screenshot by it
 *   (the single biggest per-step token saving).
 *
 * "Sufficient" is deliberately conservative in BOTH directions:
 * - a shell tree (Chromium still building, measured: 9-13 elements) or an OCR
 *   fallback (0 elements) is NOT sufficient — those states must stay
 *   vision-first so the model still has pixels to act on;
 * - the element threshold mirrors the native side's `shellElementBudget` (60):
 *   below it a small-but-real native dialog is indistinguishable from a
 *   half-built tree, so it keeps the screenshot too. Above it the outline
 *   carries enough semantic ids to act on alone.
 */

/**
 * Mirrors `NativeWebTreeReadiness.shellElementBudget` (SparkComputerHostCore).
 * MUST stay in sync: a TS-side threshold lower than the native shell budget
 * would classify a still-building window shell as a sufficient tree.
 */
export const TREE_SUFFICIENT_MIN_ELEMENTS = 60

/** Marker prefixes the native host prepends to NOT-sufficient trees. */
const TREE_INSUFFICIENT_PREFIXES = [
  // Chromium web-content tree still building (NativeWebTreeReadiness.pendingNotice).
  '[accessibility: this Chromium app is still building',
  // AX unavailable; the "tree" is OCR text with no element ids.
  '[accessibility tree unavailable',
] as const

export function isTreeSufficient(observation: ComputerObservation): boolean {
  if (observation.tree.elementCount < TREE_SUFFICIENT_MIN_ELEMENTS) return false
  return !TREE_INSUFFICIENT_PREFIXES.some((prefix) =>
    observation.tree.text.startsWith(prefix),
  )
}
