import { describe, expect, it } from 'vitest'
import {
  getSlashCommandContext,
  isComposerCommandSelectionKey,
  shouldMoveComposerCaretToEndOnArrowDown,
} from './composer-input-keyboard'

describe('composer input keyboard helpers', () => {
  it('finds a slash command fragment at any position before the caret', () => {
    expect(getSlashCommandContext('before /rev', 11)).toEqual({
      start: 7,
      end: 11,
      query: 'rev',
    })
    expect(getSlashCommandContext('/goal 继续处理', 6)).toBeNull()
  })

  it('uses Enter without Shift and Tab to select a command', () => {
    expect(isComposerCommandSelectionKey('Enter', false)).toBe(true)
    expect(isComposerCommandSelectionKey('Enter', true)).toBe(false)
    expect(isComposerCommandSelectionKey('Tab', false)).toBe(true)
    expect(isComposerCommandSelectionKey('Tab', true)).toBe(true)
  })

  it('moves a non-terminal selection to the end on ArrowDown', () => {
    expect(shouldMoveComposerCaretToEndOnArrowDown({ start: 2, end: 2 }, 8)).toBe(true)
    expect(shouldMoveComposerCaretToEndOnArrowDown({ start: 2, end: 5 }, 8)).toBe(true)
    expect(shouldMoveComposerCaretToEndOnArrowDown({ start: 8, end: 8 }, 8)).toBe(false)
  })
})
