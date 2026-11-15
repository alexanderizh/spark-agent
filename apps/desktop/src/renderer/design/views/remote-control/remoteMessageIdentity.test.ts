import { describe, expect, it } from 'vitest'
import type { RemoteTimelineItem } from './remoteEventMerge'
import { resolveAgentIdentityIndex, shouldShowAgentIdentity } from './remoteMessageIdentity'

function tool(id: string, seq: number): RemoteTimelineItem {
  return { kind: 'tool', id, seq, toolName: 'bash', status: 'success', result: null }
}

function assistant(id: string, seq: number): RemoteTimelineItem {
  return { kind: 'assistant', id, seq, turnId: 'turn-1', text: '正文', streaming: false }
}

function user(id: string, seq: number): RemoteTimelineItem {
  return { kind: 'user', id, seq, turnId: 't1', text: '问一句', attachments: [] }
}

describe('resolveAgentIdentityIndex', () => {
  it('取第一个助手条目，后续 segment 与活动段都不再重复', () => {
    const items = [user('u', 1), tool('a', 2), assistant('m1', 3), tool('b', 4), assistant('m2', 5)]
    expect(resolveAgentIdentityIndex(items)).toBe(2)
    expect(shouldShowAgentIdentity(items, 2)).toBe(true)
    expect(shouldShowAgentIdentity(items, 4)).toBe(false)
  })

  it('没有助手内容时返回 -1（空会话 / 只有活动段）', () => {
    expect(resolveAgentIdentityIndex([])).toBe(-1)
    expect(resolveAgentIdentityIndex([tool('a', 1), user('u', 2)])).toBe(-1)
    expect(shouldShowAgentIdentity([], 0)).toBe(false)
  })

  it('多轮对话里也只有首轮渲染一次：标签是「会话是谁在答」，不是「这一轮谁在答」', () => {
    const items = [
      user('u1', 1),
      assistant('m1', 2),
      user('u2', 3),
      assistant('m2', 4),
      user('u3', 5),
      assistant('m3', 6),
    ]
    expect(items.filter((_, index) => shouldShowAgentIdentity(items, index))).toHaveLength(1)
    expect(resolveAgentIdentityIndex(items)).toBe(1)
  })
})
