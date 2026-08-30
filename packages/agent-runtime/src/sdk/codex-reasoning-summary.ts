/**
 * Codex may split one turn's visible reasoning summary across several items.
 * Keep them in one UI segment while preserving a paragraph boundary between items.
 */
export type CodexReasoningSummaryState = {
  hasContent: boolean
  sourceIds: Set<string>
  trailingLineBreaks: number
}

export function createCodexReasoningSummaryState(): CodexReasoningSummaryState {
  return { hasContent: false, sourceIds: new Set(), trailingLineBreaks: 0 }
}

export function appendCodexReasoningSummaryDelta(
  state: CodexReasoningSummaryState,
  sourceId: string,
  delta: string,
): string {
  if (delta.length === 0) return ''

  const isNewSource = !state.sourceIds.has(sourceId)
  state.sourceIds.add(sourceId)

  const leadingLineBreaks = countLeadingLineBreaks(delta)
  const missingBoundaryLineBreaks = Math.max(0, 2 - state.trailingLineBreaks - leadingLineBreaks)
  const content =
    state.hasContent && isNewSource ? `${'\n'.repeat(missingBoundaryLineBreaks)}${delta}` : delta
  state.hasContent = true
  state.trailingLineBreaks = countTrailingLineBreaks(content)
  return content
}

export function readCodexReasoningSummaryItemId(record: Record<string, unknown>): string | null {
  return readNonEmptyString(record.itemId) ?? readNonEmptyString(record.item_id)
}

export function readCodexReasoningSummarySourceId(
  record: Record<string, unknown>,
  fallback: string,
): string {
  const itemId = readCodexReasoningSummaryItemId(record) ?? fallback
  const summaryIndex = record.summaryIndex ?? record.summary_index
  return typeof summaryIndex === 'number' || typeof summaryIndex === 'string'
    ? `${itemId}:summary-${summaryIndex}`
    : itemId
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function countLeadingLineBreaks(value: string): number {
  return countLineBreaks(value.match(/^(?:\r?\n)*/)?.[0] ?? '')
}

function countTrailingLineBreaks(value: string): number {
  return countLineBreaks(value.match(/(?:\r?\n)*$/)?.[0] ?? '')
}

function countLineBreaks(value: string): number {
  return Math.min(2, value.match(/\n/g)?.length ?? 0)
}
