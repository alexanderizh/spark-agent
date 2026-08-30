import { describe, expect, it } from 'vitest'
import { countExistingRefs, resolveExistingRefs } from './agent-config-counts'

describe('countExistingRefs', () => {
  it('只统计仍然存在的资源，忽略已删除资源留下的悬空 ID', () => {
    // agent 上挂了 3 个 MCP，但只剩 playwright 还存在（另两个已被删除）
    const ids = ['playwright', 'deleted-a', 'deleted-b']
    const items = [{ id: 'playwright' }, { id: 'other' }]
    expect(countExistingRefs(ids, items)).toBe(1)
  })

  it('空引用返回 0', () => {
    expect(countExistingRefs([], [{ id: 'a' }])).toBe(0)
  })

  it('全部存在时返回完整数量', () => {
    expect(countExistingRefs(['a', 'b'], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(2)
  })
})

describe('resolveExistingRefs', () => {
  it('按原顺序解析并丢弃悬空 ID', () => {
    const ids = ['b', 'gone', 'a']
    const items = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ]
    expect(resolveExistingRefs(ids, items)).toEqual([
      { id: 'b', name: 'Beta' },
      { id: 'a', name: 'Alpha' },
    ])
  })

  it('空引用返回空数组', () => {
    expect(resolveExistingRefs([], [{ id: 'a' }])).toEqual([])
  })
})
