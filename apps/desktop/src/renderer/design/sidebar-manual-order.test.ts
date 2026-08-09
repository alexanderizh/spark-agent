import { describe, expect, it } from 'vitest'
import {
  moveItem,
  SerialTaskQueue,
  sortByManualOrder,
  sortByManualOrderWithinPinnedSections,
} from './sidebar-manual-order'

describe('sortByManualOrder', () => {
  it('uses persisted ranks and keeps newly created items first in fallback order', () => {
    const items = [{ id: 'new' }, { id: 'a' }, { id: 'b' }]
    expect(sortByManualOrder(items, ['b', 'a'], (item) => item.id).map((item) => item.id)).toEqual([
      'new',
      'b',
      'a',
    ])
  })

  it('does not mutate its input', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    sortByManualOrder(items, ['b', 'a'], (item) => item.id)
    expect(items.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('moveItem', () => {
  it('moves an item to the requested index', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
})

describe('sortByManualOrderWithinPinnedSections', () => {
  it('keeps pinned items first while preserving manual order within each section', () => {
    const items = [
      { id: 'pinned-a', pinned: true },
      { id: 'normal-a', pinned: false },
      { id: 'pinned-b', pinned: true },
      { id: 'normal-b', pinned: false },
    ]

    expect(
      sortByManualOrderWithinPinnedSections(
        items,
        ['normal-b', 'pinned-b', 'normal-a', 'pinned-a'],
        (item) => item.id,
        (item) => item.pinned,
      ).map((item) => item.id),
    ).toEqual(['pinned-b', 'pinned-a', 'normal-b', 'normal-a'])
  })
})

describe('SerialTaskQueue', () => {
  it('does not start a later write until the previous write settles', async () => {
    const queue = new SerialTaskQueue()
    let releaseFirst: (() => void) | undefined
    const calls: string[] = []
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          calls.push('first:start')
          releaseFirst = () => {
            calls.push('first:end')
            resolve()
          }
        }),
    )
    const second = queue.run(async () => {
      calls.push('second')
    })

    await Promise.resolve()
    expect(calls).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(calls).toEqual(['first:start', 'first:end', 'second'])
  })

  it('continues after a failed write', async () => {
    const queue = new SerialTaskQueue()
    const first = queue.run(async () => {
      throw new Error('save failed')
    })
    const second = queue.run(async () => undefined)

    await expect(first).rejects.toThrow('save failed')
    await expect(second).resolves.toBeUndefined()
  })
})
