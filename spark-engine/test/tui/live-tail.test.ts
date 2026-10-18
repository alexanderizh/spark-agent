import { describe, expect, it } from 'vitest'

import { displayColumns, liveTail } from '../../src/tui/live-tail.js'

describe('liveTail', () => {
  it('keeps short content untouched', () => {
    expect(liveTail('hello', 80, 10)).toEqual({ text: 'hello', omittedRows: 0 })
  })

  it('keeps only the trailing rows when the stream exceeds the budget', () => {
    const text = Array.from({ length: 10 }, (unused, index) => `line-${index}`).join('\n')
    const tail = liveTail(text, 80, 4)
    expect(tail.text).toBe('line-6\nline-7\nline-8\nline-9')
    expect(tail.omittedRows).toBe(6)
  })

  it('counts wrapped rows for wide CJK characters', () => {
    // 30 wide characters → 60 columns → 3 wrapped rows at width 20.
    const first = '汉'.repeat(30)
    const text = `${first}\ntail`
    const tail = liveTail(text, 20, 2)
    expect(tail.text).toBe('tail')
    expect(tail.omittedRows).toBe(3)
  })

  it('column-truncates a single over-tall line instead of dropping it', () => {
    const line = 'a'.repeat(100)
    const tail = liveTail(line, 10, 2)
    expect(tail.text).toBe('a'.repeat(20))
    expect(tail.omittedRows).toBe(0)
  })

  it('never returns fewer than one row', () => {
    const tail = liveTail('kept', 80, 0)
    expect(tail.text).toBe('kept')
    expect(tail.omittedRows).toBe(0)
  })

  it('counts display columns with East Asian wide cells', () => {
    expect(displayColumns('ab')).toBe(2)
    expect(displayColumns('汉汉')).toBe(4)
    expect(displayColumns('')).toBe(0)
  })
})
