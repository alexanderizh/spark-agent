/**
 * Unified-diff detection and rendering geometry for the TUI. Everything here
 * is pure text work: it classifies lines and builds a bounded preview, but it
 * never rewrites the source lines it is given.
 */
export type DiffLineKind = 'add' | 'remove' | 'hunk' | 'meta' | 'context'

export interface DiffLine {
  readonly kind: DiffLineKind
  readonly text: string
}

export interface EditDiff {
  /** Whole-edit counters, e.g. `+6 -2`, independent of the truncated preview. */
  readonly summary: string
  readonly lines: readonly DiffLine[]
  readonly added: number
  readonly removed: number
  readonly truncated: boolean
}

/** Diff preview budget; long edits stay one screen tall. */
const EDIT_DIFF_MAX_LINES = 14
/** Context kept around the changed region so the patch reads in place. */
const EDIT_DIFF_CONTEXT = 3
/** Refuse to diff pathological inputs; the header line still shows the edit. */
const EDIT_DIFF_MAX_INPUT_LINES = 400
/** LCS table ceiling (~1M cells) above which we fall back to a block replace. */
const LCS_MAX_CELLS = 1_000_000

const META_LINE =
  /^(?:diff --(?:git|combined)|index [0-9a-f]{6,}|new file mode|deleted file mode|old mode |new mode |similarity index|dissimilarity index|rename from |rename to |copy from |copy to |---(?: |$)|\+\+\+(?: |$))/u

/** File headers, hunk headers and side markers, in diff priority order. */
export function diffLineKind(line: string): DiffLineKind {
  if (META_LINE.test(line)) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return 'context'
}

/**
 * Strict detector for diff text mixed into tool output. A hunk header or an
 * explicit `+++ `/`diff --git` file header is required, so ordinary prose,
 * bullet lists and `---` rules are never recolored by mistake.
 */
export function looksLikeUnifiedDiff(lines: readonly string[]): boolean {
  let headers = 0
  let changed = 0
  for (const line of lines) {
    if (line.startsWith('@@') || line.startsWith('+++ ') || line.startsWith('diff --git')) {
      headers += 1
    } else if (line.startsWith('+') || line.startsWith('-')) {
      changed += 1
    }
  }
  return headers > 0 && changed > 0
}

/** ```diff / ```patch fences are rendered as diffs without further detection. */
export function isDiffFence(info: string): boolean {
  const name =
    info
      .trim()
      .split(/[\s:{]/u)[0]
      ?.toLowerCase() ?? ''
  return name === 'diff' || name === 'patch'
}

/** Builds the display diff for an `edit` call from its `old` / `new` arguments. */
export function editDiffFromArgs(
  args: unknown,
  maximum = EDIT_DIFF_MAX_LINES,
): EditDiff | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  const before = typeof record.old === 'string' ? record.old : undefined
  const after = typeof record.new === 'string' ? record.new : undefined
  if (before === undefined || after === undefined) return undefined
  return buildEditDiff(before, after, maximum)
}

export function buildEditDiff(
  before: string,
  after: string,
  maximum = EDIT_DIFF_MAX_LINES,
): EditDiff | undefined {
  const beforeLines = toLines(before)
  const afterLines = toLines(after)
  if (beforeLines.length + afterLines.length > EDIT_DIFF_MAX_INPUT_LINES * 2) return undefined
  const all =
    beforeLines.length * afterLines.length > LCS_MAX_CELLS
      ? blockReplace(beforeLines, afterLines)
      : lineOps(beforeLines, afterLines)
  const added = all.filter((line) => line.kind === 'add').length
  const removed = all.filter((line) => line.kind === 'remove').length
  if (added === 0 && removed === 0) return undefined
  const lines = window(all, maximum)
  return {
    summary: `+${added} -${removed}`,
    lines,
    added,
    removed,
    truncated: lines.length < all.length,
  }
}

/** Longest common subsequence line diff; every input line appears once. */
function lineOps(before: readonly string[], after: readonly string[]): readonly DiffLine[] {
  const columns = after.length + 1
  const table = new Uint32Array((before.length + 1) * columns)
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row * columns + column] =
        before[row] === after[column]
          ? (table[(row + 1) * columns + column + 1] ?? 0) + 1
          : Math.max(
              table[(row + 1) * columns + column] ?? 0,
              table[row * columns + column + 1] ?? 0,
            )
    }
  }
  const lines: DiffLine[] = []
  let row = 0
  let column = 0
  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      lines.push({ kind: 'context', text: ` ${before[row] ?? ''}` })
      row += 1
      column += 1
    } else if (
      (table[(row + 1) * columns + column] ?? 0) >= (table[row * columns + column + 1] ?? 0)
    ) {
      lines.push({ kind: 'remove', text: `-${before[row] ?? ''}` })
      row += 1
    } else {
      lines.push({ kind: 'add', text: `+${after[column] ?? ''}` })
      column += 1
    }
  }
  for (; row < before.length; row += 1) {
    lines.push({ kind: 'remove', text: `-${before[row] ?? ''}` })
  }
  for (; column < after.length; column += 1) {
    lines.push({ kind: 'add', text: `+${after[column] ?? ''}` })
  }
  return lines
}

/** Cheap fallback for oversized inputs: whole old block out, whole new block in. */
function blockReplace(before: readonly string[], after: readonly string[]): readonly DiffLine[] {
  return [
    ...before.map((line): DiffLine => ({ kind: 'remove', text: `-${line}` })),
    ...after.map((line): DiffLine => ({ kind: 'add', text: `+${line}` })),
  ]
}

/**
 * Trims the diff to the changed region plus context, then to the line budget.
 * The budget is spent from the top of the change so the first hunks — the ones
 * that explain the edit — always survive.
 */
function window(lines: readonly DiffLine[], maximum: number): readonly DiffLine[] {
  const first = lines.findIndex((line) => line.kind !== 'context')
  let last = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.kind !== 'context') {
      last = index
      break
    }
  }
  const from = Math.max(0, first - EDIT_DIFF_CONTEXT)
  const to = last === -1 ? lines.length : Math.min(lines.length, last + 1 + EDIT_DIFF_CONTEXT)
  const focused = lines.slice(from, to)
  if (focused.length <= maximum) return focused
  const kept = focused.slice(0, Math.max(1, maximum - 1))
  return [...kept, { kind: 'hunk', text: `… 其余 ${focused.length - kept.length} 行未展开` }]
}

/** Splits into lines the way editors count them; `''` has no lines at all. */
function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}
