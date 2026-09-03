import { describe, expect, it } from 'vitest'
import { resolveSidebarNavVisibility } from './sidebarNavVisibility'

const items = ['one', 'two', 'three', 'four', 'five', 'six'].map((id) => ({ id }))

describe('resolveSidebarNavVisibility', () => {
  it('shows three workbench items by default because new task occupies the first slot', () => {
    const result = resolveSidebarNavVisibility(items, [])

    expect(result.visibleItems.map((item) => item.id)).toEqual(['one', 'two', 'three'])
    expect(result.collapsedItems.map((item) => item.id)).toEqual(['four', 'five', 'six'])
  })

  it('keeps the original three workbench slots when fewer than four items are pinned', () => {
    const result = resolveSidebarNavVisibility(items, ['five', 'six'])

    expect(result.visibleItems.map((item) => item.id)).toEqual(['five', 'six', 'one'])
    expect(result.collapsedItems.map((item) => item.id)).toEqual(['two', 'three', 'four'])
  })

  it('keeps the original behavior of showing all four pinned items', () => {
    const result = resolveSidebarNavVisibility(items, ['two', 'three', 'five', 'six'])

    expect(result.visibleItems.map((item) => item.id)).toEqual(['two', 'three', 'five', 'six'])
    expect(result.collapsedItems.map((item) => item.id)).toEqual(['one', 'four'])
  })

  it('shows every pinned item when the pinned count exceeds four', () => {
    const result = resolveSidebarNavVisibility(items, ['one', 'two', 'three', 'four', 'five'])

    expect(result.visibleItems.map((item) => item.id)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ])
    expect(result.collapsedItems.map((item) => item.id)).toEqual(['six'])
  })
})
