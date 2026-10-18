import { describe, expect, it } from 'vitest'

import { selectPaneTail, textRowCount } from '../../src/tui/pane-tail.js'
import type { TranscriptRow } from '../../src/tui/projection.js'

function row(partial: Omit<TranscriptRow, 'key' | 'tone'> & { key?: string }): TranscriptRow {
  return { key: partial.key ?? `row-${Math.random().toString(36).slice(2)}`, tone: 'normal', ...partial }
}

describe('textRowCount', () => {
  it('counts one row for lines that fit the width', () => {
    expect(textRowCount('short line', 80)).toBe(1)
    expect(textRowCount('a\nb\nc', 80)).toBe(3)
  })

  it('counts wide characters as two columns', () => {
    // 4 CJK glyphs = 8 display columns → 2 rows at width 4.
    expect(textRowCount('中中中中', 4)).toBe(2)
    expect(textRowCount('中文', 80)).toBe(1)
  })

  it('counts wrapped overflow per line', () => {
    expect(textRowCount('x'.repeat(200), 80)).toBe(3)
  })
})

describe('selectPaneTail', () => {
  it('keeps everything when the estimate fits the budget', () => {
    const rows = [row({ text: 'one' }), row({ text: 'two' })]
    const tail = selectPaneTail(rows, 80, 10)
    expect(tail.rows).toEqual(rows)
    expect(tail.estimatedRows).toBe(2)
    expect(tail.omittedRows).toBe(0)
  })

  it('keeps whole rows only, newest first', () => {
    const rows = [
      row({ text: 'a' }),
      row({ text: 'b' }),
      row({ text: 'c' }),
    ]
    const tail = selectPaneTail(rows, 80, 2)
    expect(tail.rows.map((entry) => entry.text)).toEqual(['b', 'c'])
    expect(tail.omittedRows).toBe(1)
  })

  it('charges margin rows for user and assistant rows', () => {
    const rows = [row({ text: 'hi', kind: 'user' })]
    // marginY(2) + 1 content row = 3.
    expect(selectPaneTail(rows, 80, 3).rows).toHaveLength(1)
    expect(selectPaneTail(rows, 80, 2).rows).toHaveLength(0)
  })

  it('charges wrapped overflow for assistant rows', () => {
    const rows = [row({ text: 'x'.repeat(200), kind: 'assistant' })]
    // marginY(2) + 3 wrapped rows = 5.
    expect(selectPaneTail(rows, 80, 5).rows).toHaveLength(1)
    expect(selectPaneTail(rows, 80, 4).rows).toHaveLength(0)
  })

  it('charges diff and detail rows for tool lines', () => {
    const rows = [
      row({
        text: 'tool header',
        toolLine: {
          tool: 'edit',
          title: 'edit',
          ok: true,
          durationMs: '12ms',
          resultLines: ['r1', 'r2', 'r3'],
          isTask: false,
          diff: {
            summary: '+1 -1',
            added: 1,
            removed: 1,
            truncated: false,
            lines: [
              { kind: 'remove', text: '-old' },
              { kind: 'add', text: '+new' },
            ],
          },
        },
      }),
    ]
    // 1 margin + 1 header + 1 slack + 2 diff rows = 5 (plain success keeps no detail).
    expect(selectPaneTail(rows, 80, 5).rows).toHaveLength(1)
    expect(selectPaneTail(rows, 80, 4).rows).toHaveLength(0)
  })

  it('returns nothing for an empty transcript or zero budget', () => {
    expect(selectPaneTail([], 80, 10)).toEqual({ rows: [], estimatedRows: 0, omittedRows: 0 })
    const rows = [row({ text: 'a' })]
    expect(selectPaneTail(rows, 80, 0)).toEqual({ rows: [], estimatedRows: 0, omittedRows: 0 })
  })
})
