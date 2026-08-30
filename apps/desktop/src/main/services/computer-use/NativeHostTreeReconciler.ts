import type { ComputerElementRef, ComputerObservation } from '@spark/protocol'

/**
 * Phase 2.2 — client-side AX-tree diff reconciliation.
 *
 * The Native Host (macOS Swift / Windows Rust) emits two tree modes over the
 * wire (see `MacControlPolicy.publish`):
 *
 *  - `full`: `tree.text` is the JSON array of every element.
 *  - `diff`: `tree.text` is `{"changed": [...], "removed": [...]}` — only the
 *    delta against the previous tree version. Bandwidth win on the text field.
 *
 * Crucially, in BOTH modes the structured `elements` array is the complete
 * current element list (the Host always publishes the full element set; only
 * the rendered `text` is diffed). That means a diff response carries enough
 * structured data to reconstruct the exact full-tree text the Host would have
 * produced for a full request.
 *
 * This reconciler does exactly that: when an observation arrives in `diff`
 * mode, it rebuilds `tree.text` from the always-full `elements` array — in the
 * Host's own JSON-element shape (sorted keys, optional `value`) — and exposes
 * the observation as `full`. Downstream consumers (the decision adapter) always
 * see a complete tree, so a diff response can never leak a `{changed,removed}`
 * blob into the model prompt.
 *
 * Why this is safe (model-input equivalent): the reconstructed text is derived
 * from the same `elements` array the Host would serialize for a full request,
 * using the same per-element JSON shape. Whether the Host sent `full` or the
 * client reconstructed from `diff`, the adapter receives the same element set
 * rendered the same way. The only difference is how many text bytes crossed the
 * wire.
 *
 * The reconciler is stateless: it needs no cached prior tree, because the
 * structured `elements` array already carries the complete current state. If
 * reconstruction fails for any reason, the original observation is returned
 * unchanged (fail-open to the raw Host payload; callers that strictly require a
 * full tree still request one via `fullTree=true`).
 */
export function reconcileObservationTree(observation: ComputerObservation): ComputerObservation {
  if (observation.tree.mode !== 'diff') return observation
  const reconstructed = reconstructFullTreeText(observation.elements)
  if (reconstructed == null) return observation
  return {
    ...observation,
    tree: {
      ...observation.tree,
      mode: 'full',
      text: reconstructed,
    },
  }
}

/**
 * Rebuild the Host's full-mode `tree.text` from the structured element list.
 * Returns null if the elements are malformed (caller falls back to the raw
 * diff payload).
 */
export function reconstructFullTreeText(elements: ComputerElementRef[]): string | null {
  try {
    const payload = elements.map(elementToHostJsonObject)
    return JSON.stringify(sortKeys(payload))
  } catch {
    return null
  }
}

/**
 * Match the Host's `MacControlPolicy.jsonObject` shape: id, treeVersion, role,
 * name, bounds{x,y,width,height}, enabled, focused, actions, and `value` only
 * when present.
 */
function elementToHostJsonObject(element: ComputerElementRef): Record<string, unknown> {
  const object: Record<string, unknown> = {
    id: element.id,
    treeVersion: element.treeVersion,
    role: element.role,
    name: element.name,
    bounds: {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    },
    enabled: element.enabled,
    focused: element.focused,
    actions: element.actions,
  }
  if (element.value != null) object.value = element.value
  return object
}

/** Deep, stable key ordering to match the Host's `.sortedKeys` serialization. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortKeys(record[key])
        return accumulator
      }, {})
  }
  return value
}
