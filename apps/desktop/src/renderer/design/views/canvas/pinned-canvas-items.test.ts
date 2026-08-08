import { describe, expect, it } from 'vitest'
import { parsePinnedCanvasItemIds, togglePinnedCanvasItem } from './pinned-canvas-items'

describe('pinned canvas items', () => {
  it('parses, trims, and de-duplicates persisted ids', () => {
    expect(parsePinnedCanvasItemIds('[" agent-a ","agent-a",null,"",42]')).toEqual(['agent-a'])
    expect(parsePinnedCanvasItemIds('not-json')).toEqual([])
  })

  it('puts a newly pinned item first and removes it when toggled again', () => {
    expect(togglePinnedCanvasItem(['agent-b', 'agent-a'], 'agent-c')).toEqual([
      'agent-c',
      'agent-b',
      'agent-a',
    ])
    expect(togglePinnedCanvasItem(['agent-b', 'agent-a'], 'agent-b')).toEqual(['agent-a'])
  })
})
