/**
 * Tail-window clamp for the live streaming strip.
 *
 * The settled transcript streams into the terminal scrollback (ink `Static`),
 * but the *live* strip (streaming text/thinking) is redrawn in place every
 * frame. When that strip grows taller than the terminal, Ink outputs more rows
 * than fit on screen: the terminal scrolls, Ink's erase accounting desyncs, and
 * the repaint shreds the frame — history pushed off the top and the bottom
 * chrome (input box, status bar) wiped to blank. Clamping the live strip to a
 * tail window keeps every frame within one screen; the full content lands in
 * the scrollback once the turn settles.
 */

/** Approximate display columns of `text`, counting East Asian wide cells as 2. */
export function displayColumns(text: string): number {
  let columns = 0
  for (const character of text) {
    columns += isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1
  }
  return columns
}

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals → Yi syllables
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth symbol variants
    (code >= 0x1f300 && code <= 0x1faff) || // Emoji (pictographs, most wide)
    (code >= 0x20000 && code <= 0x3fffd) // CJK extensions B and beyond
  )
}

export interface LiveTail {
  /** Trailing slice of the input, at most `maxRows` terminal rows tall. */
  readonly text: string
  /** Display rows above the slice that the window omitted. */
  readonly omittedRows: number
}

const MIN_TAIL_WIDTH = 4

/** Display rows `line` occupies once Ink wraps it at `width` columns. */
function wrappedRowCount(line: string, width: number): number {
  return Math.max(1, Math.ceil(displayColumns(line) / width))
}

/**
 * Keep the last `maxRows` terminal rows of `text` (counting the wrapping Ink
 * applies at `width` columns), plus how many rows were dropped above. A single
 * over-tall logical line is column-truncated from the tail so the window never
 * exceeds the budget.
 */
export function liveTail(text: string, width: number, maxRows: number): LiveTail {
  const columns = Math.max(MIN_TAIL_WIDTH, width)
  const budget = Math.max(1, Math.floor(maxRows))
  const lines = text.split('\n')

  // Walk backwards accumulating whole logical lines while they fit.
  let rows = 0
  let startIndex = lines.length
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lineRows = wrappedRowCount(lines[index] ?? '', columns)
    if (rows + lineRows > budget) break
    rows += lineRows
    startIndex = index
  }

  const omitted =
    lines.slice(0, startIndex).reduce((total, line) => total + wrappedRowCount(line, columns), 0)
  if (startIndex === lines.length) {
    // Even the last logical line alone exceeds the budget: keep its tail.
    return { text: tailColumns(lines[lines.length - 1] ?? '', columns, budget), omittedRows: 0 }
  }
  return {
    text: lines.slice(startIndex).join('\n'),
    omittedRows: omitted,
  }
}

/** Last `maxRows` display columns of `line`, cut on a character boundary. */
function tailColumns(line: string, width: number, maxRows: number): string {
  const characters = Array.from(line)
  const budget = width * maxRows
  let columns = 0
  let start = characters.length
  while (start > 0) {
    const character = characters[start - 1] ?? ''
    const next = columns + (isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1)
    if (next > budget) break
    columns = next
    start -= 1
  }
  return characters.slice(start).join('')
}
