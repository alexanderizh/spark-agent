import { describe, expect, it } from 'vitest'
import { GROUP_LAYOUT_HEADER_HEIGHT, planGroupLayout } from './canvasGroupLayout'

describe('planGroupLayout', () => {
  it('reflows scattered nodes into a stable non-overlapping grid', () => {
    const plan = planGroupLayout([
      { id: 'c', width: 220, height: 180, absoluteX: 900, absoluteY: 500 },
      { id: 'a', width: 300, height: 160, absoluteX: 100, absoluteY: 100 },
      { id: 'b', width: 240, height: 210, absoluteX: 40, absoluteY: 420 },
    ])
    expect(plan).not.toBeNull()
    expect(plan?.members).toHaveLength(3)
    expect(plan?.members[0]?.y).toBe(GROUP_LAYOUT_HEADER_HEIGHT)
    expect(new Set(plan?.members.map((member) => `${member.x}:${member.y}`)).size).toBe(3)
  })
})
