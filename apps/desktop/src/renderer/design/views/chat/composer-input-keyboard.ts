export type ComposerSelectionLike = { start: number; end: number }

export type ComposerCommandContext = {
  start: number
  end: number
  query: string
}

/**
 * Returns the slash-command fragment immediately before the caret.
 * The slash may appear anywhere in the input, but whitespace starts a new fragment.
 */
export function getSlashCommandContext(
  value: string,
  caret: number,
): ComposerCommandContext | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const beforeCaret = value.slice(0, safeCaret)
  const match = beforeCaret.match(/\/([^\s/]*)$/)
  if (match == null) return null

  const fragment = match[0]
  return {
    start: safeCaret - fragment.length,
    end: safeCaret,
    query: match[1] ?? '',
  }
}

export function isComposerCommandSelectionKey(key: string, shiftKey: boolean): boolean {
  return key === 'Tab' || (key === 'Enter' && !shiftKey)
}

export function shouldMoveComposerCaretToEndOnArrowDown(
  selection: ComposerSelectionLike | undefined,
  valueLength: number,
): boolean {
  if (selection == null) return false
  return selection.start !== valueLength || selection.end !== valueLength
}
