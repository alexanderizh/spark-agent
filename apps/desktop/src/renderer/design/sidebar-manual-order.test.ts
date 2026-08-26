import { describe, expect, it } from 'vitest'
import {
  mergeManualOrderWithHidden,
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

describe('mergeManualOrderWithHidden', () => {
  it('equals the visible order when nothing is hidden', () => {
    expect(mergeManualOrderWithHidden(['a', 'b', 'c'], ['b', 'c', 'a'], new Set())).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('keeps hidden ranked items placed between their previous neighbors', () => {
    // 画布筛选隐藏 b 后把 c 拖到 a 之前：b 保留有秩位置，而不是丢秩浮到段首。
    expect(mergeManualOrderWithHidden(['a', 'b', 'c'], ['c', 'a'], new Set(['b']))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('keeps a hidden item that led the previous order at the front', () => {
    expect(mergeManualOrderWithHidden(['h', 'a', 'b'], ['b', 'a'], new Set(['h']))).toEqual([
      'h',
      'b',
      'a',
    ])
  })

  it('drops stale hidden ids that are no longer valid', () => {
    expect(mergeManualOrderWithHidden(['a', 'x', 'b'], ['b', 'a'], new Set())).toEqual(['b', 'a'])
  })

  it('keeps newly created unranked visible items first', () => {
    expect(mergeManualOrderWithHidden(['b', 'a'], ['n', 'a', 'b'], new Set())).toEqual([
      'n',
      'a',
      'b',
    ])
  })

  it('falls back to the visible order when no manual order exists yet', () => {
    expect(mergeManualOrderWithHidden(undefined, ['a', 'b'], new Set(['c']))).toEqual(['a', 'b'])
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
