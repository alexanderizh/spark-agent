import { describe, expect, it } from 'vitest'
import type { RemoteTimelineItem } from './remoteEventMerge'
import {
  countActivityErrors,
  groupRemoteActivity,
  isActivityRunning,
  isShellTool,
  summarizeActivity,
} from './remoteActivity'

function tool(id: string, seq: number, toolName = 'bash'): RemoteTimelineItem {
  return { kind: 'tool', id, seq, toolName, status: 'success', result: null }
}

function thinking(id: string, seq: number): RemoteTimelineItem {
  return { kind: 'thinking', id, seq, text: '想一下', streaming: false }
}

function assistant(id: string, seq: number): RemoteTimelineItem {
  return { kind: 'assistant', id, seq, text: '正文', streaming: false }
}

describe('isShellTool', () => {
  it('命令行类工具名大小写无关', () => {
    expect(isShellTool('bash')).toBe(true)
    expect(isShellTool('BashCommand')).toBe(true)
    expect(isShellTool('run_command')).toBe(true)
    expect(isShellTool('read_file')).toBe(false)
    expect(isShellTool('web_search')).toBe(false)
  })
})

describe('groupRemoteActivity', () => {
  it('连续的思考与工具调用收成一段，正文把序列切开', () => {
    const items = [thinking('t1', 1), tool('a', 2), tool('b', 3), assistant('m1', 4), tool('c', 5)]
    const grouped = groupRemoteActivity(items)
    expect(grouped.map((item) => item.kind)).toEqual(['activity', 'assistant', 'activity'])
    expect(grouped[0]).toMatchObject({ kind: 'activity', id: 'activity:t1', seq: 1 })
    expect(grouped[2]).toMatchObject({ kind: 'activity', id: 'activity:c', seq: 5 })
  })

  it('单条工具也成段（渲染层据此只画一行，不再套摘要）', () => {
    const grouped = groupRemoteActivity([tool('only', 7)])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({ kind: 'activity', seq: 7 })
    if (grouped[0]?.kind !== 'activity') throw new Error('expected activity')
    expect(grouped[0].steps).toHaveLength(1)
  })

  it('已是 activity 的条目原样保留（函数可重复调用）', () => {
    const once = groupRemoteActivity([tool('a', 1), tool('b', 2)])
    const twice = groupRemoteActivity(once)
    expect(twice).toHaveLength(1)
    expect(twice[0]).toMatchObject({ kind: 'activity' })
  })

  it('用户消息与产物卡片不参与折叠', () => {
    const items: RemoteTimelineItem[] = [
      { kind: 'user', id: 'u', seq: 1, text: '你好', attachments: [] },
      { kind: 'files', id: 'f', seq: 2, files: [{ path: '/a.html' }] },
    ]
    expect(groupRemoteActivity(items).map((item) => item.kind)).toEqual(['user', 'files'])
  })
})

describe('summarizeActivity', () => {
  it('命令与普通工具分开计数', () => {
    const steps = [
      { kind: 'thinking' as const, id: 't', seq: 1, text: 'x', streaming: false },
      {
        kind: 'tool' as const,
        id: 'a',
        seq: 2,
        toolName: 'bash',
        status: 'success' as const,
        result: null,
      },
      {
        kind: 'tool' as const,
        id: 'b',
        seq: 3,
        toolName: 'bash',
        status: 'success' as const,
        result: null,
      },
      {
        kind: 'tool' as const,
        id: 'c',
        seq: 4,
        toolName: 'read_file',
        status: 'success' as const,
        result: null,
      },
    ]
    expect(summarizeActivity(steps)).toBe('进行了思考 · 运行了 2 条命令 · 调用了 1 个工具')
  })

  it('只有思考时只说思考', () => {
    expect(
      summarizeActivity([{ kind: 'thinking', id: 't', seq: 1, text: 'x', streaming: false }]),
    ).toBe('进行了思考')
  })

  it('空集合兜底文案', () => {
    expect(summarizeActivity([])).toBe('活动记录')
  })
})

describe('isActivityRunning / countActivityErrors', () => {
  it('任一工具运行中或思考流式中都算进行中', () => {
    expect(
      isActivityRunning([
        { kind: 'tool', id: 'a', seq: 1, toolName: 'bash', status: 'running', result: null },
      ]),
    ).toBe(true)
    expect(
      isActivityRunning([{ kind: 'thinking', id: 't', seq: 1, text: 'x', streaming: true }]),
    ).toBe(true)
    expect(
      isActivityRunning([
        { kind: 'tool', id: 'a', seq: 1, toolName: 'bash', status: 'success', result: null },
      ]),
    ).toBe(false)
  })

  it('只数失败的工具步', () => {
    expect(
      countActivityErrors([
        { kind: 'tool', id: 'a', seq: 1, toolName: 'bash', status: 'error', result: null },
        { kind: 'tool', id: 'b', seq: 2, toolName: 'bash', status: 'success', result: null },
        { kind: 'thinking', id: 't', seq: 3, text: 'x', streaming: false },
      ]),
    ).toBe(1)
  })
})
