import { describe, expect, it } from 'vitest'
import { joinDistinctPromptSections } from './prompt-deduplication.js'

describe('prompt deduplication', () => {
  it('dedupes by normalized key without rewriting retained prompt bytes or order', () => {
    const first = ' first  \r\nline \r\nthird '
    const duplicate = 'first\nline\nthird'

    expect(joinDistinctPromptSections(first, 'second', duplicate, undefined, 'second')).toBe(
      `${first.trim()}\n\nsecond`,
    )
    expect(joinDistinctPromptSections(first, 'second', duplicate)).toBe(
      joinDistinctPromptSections(first, 'second', duplicate),
    )
  })

  it('keeps empty sections out without changing distinct section order', () => {
    expect(joinDistinctPromptSections(undefined, 'first', '  ', 'second')).toBe('first\n\nsecond')
  })
})
