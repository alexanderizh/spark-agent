/**
 * Tail-window selector for the settled transcript inside the pinned-bottom
 * live frame.
 *
 * The full history keeps streaming into the terminal scrollback through ink's
 * `<Static>` (native scroll-up stays available). But when the terminal height
 * is known the live frame is height-pinned (chrome docked at the bottom edge),
 * so the viewport only ever shows the frame itself — history written to the
 * scrollback above disappears from view the moment a turn settles. The pane
 * therefore re-renders a bounded tail of the settled rows inline so the latest
 * exchange stays visible above the input band (Codex CLI behavior). Scrolling
 * up reveals the same tail rows again in the scrollback — a harmless seam,
 * chosen over the alternative (no tail) that would hide every answer.
 *
 * Row counts are over-estimates by construction: markdown rendering maps
 * source lines to at most one terminal row each (fence markers are dropped,
 * inline markers removed), so counting raw source lines plus wrap overflow can
 * only round up. Over-estimating shrinks the tail; under-estimating would grow
 * the frame past the terminal and desync Ink's erase accounting.
 */

import { displayColumns, wrappedRowCount } from './live-tail.js'
import type { TranscriptRow } from './projection.js'

/** Display rows `text` occupies once Ink wraps it at `width` columns. */
export function textRowCount(text: string, width: number): number {
  const columns = Math.max(1, width)
  return text
    .split('\n')
    .reduce((total, line) => total + wrappedRowCount(line, columns), 0)
}

/** Keep in sync with FAILED_DETAIL_MAX_LINES / TASK_DETAIL_MAX_LINES in rows.tsx. */
const DETAIL_MAX_LINES = 3
const TASK_DETAIL_MAX_LINES = 2

/** Upper bound of the terminal rows one settled transcript row renders. */
function estimateRowRows(row: TranscriptRow, width: number): number {
  const wrapped = textRowCount(row.text, width)
  if (row.toolLine !== undefined) {
    const toolLine = row.toolLine
    const failed = !toolLine.ok
    const detailCount = failed || toolLine.processStatus === 'still running'
      ? Math.min(DETAIL_MAX_LINES, toolLine.resultLines.length)
      : toolLine.isTask
        ? Math.min(TASK_DETAIL_MAX_LINES, toolLine.resultLines.length)
        : 0
    // marginTop + header (≈ row.text) + diff preview + detail excerpt, plus
    // one slack row for the header's status suffixes (rendered header text is
    // longer than the projection's one-line form).
    return 1 + wrapped + (toolLine.diff?.lines.length ?? 0) + detailCount + 1
  }
  // user/assistant rows carry marginY(1) → two blank rows around the content;
  // markdown never renders more rows than source lines (module doc).
  if (row.kind === 'user' || row.kind === 'assistant') return wrapped + 2
  return wrapped
}

export interface PaneTail {
  /** Trailing slice of `rows` whose estimated height fits `maxRows`. */
  readonly rows: readonly TranscriptRow[]
  /** Estimated terminal rows of the slice. */
  readonly estimatedRows: number
  /** How many rows the dropped head rows are estimated to occupy. */
  readonly omittedRows: number
}

/**
 * Keep the last transcript rows whose estimated rendered height fits
 * `maxRows` terminal rows, plus how many rows were dropped above. Rows are
 * kept whole (never sliced mid-row) so transcript blocks stay readable.
 */
export function selectPaneTail(
  rows: readonly TranscriptRow[],
  width: number,
  maxRows: number,
): PaneTail {
  const budget = Math.max(0, Math.floor(maxRows))
  if (rows.length === 0 || budget === 0) {
    return { rows: [], estimatedRows: 0, omittedRows: 0 }
  }

  let used = 0
  let startIndex = rows.length
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const candidate = rows.at(index)
    if (candidate === undefined) break
    const rowRows = estimateRowRows(candidate, width)
    if (used + rowRows > budget) break
    used += rowRows
    startIndex = index
  }

  const omitted = rows
    .slice(0, startIndex)
    .reduce((total, row) => total + estimateRowRows(row, width), 0)
  return {
    rows: rows.slice(startIndex),
    estimatedRows: used,
    omittedRows: omitted,
  }
}

/** Display columns of `text` — re-exported for callers sizing pane windows. */
export { displayColumns }
