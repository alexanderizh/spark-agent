import { describe, expect, it } from 'vitest'
import type { MobileBridgeEvent } from '@spark/protocol'
import { buildRemoteTimeline, mergeRemoteEvents } from './remoteEventMerge'

let seed = 0

function ev(
  partial: Omit<MobileBridgeEvent, 'turnId' | 'timestamp'> & {
    turnId?: string
    timestamp?: string
  },
): MobileBridgeEvent {
  seed += 1
  return {
    turnId: 'turn-1',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seed)).toISOString(),
    ...partial,
  }
}

describe('mergeRemoteEvents', () => {
  it('同一 id 只保留一份，取文本更长的版本', () => {
    const base = [
      ev({ id: 'a', seq: 1, type: 'assistant_message', content: '你好', mode: 'delta' }),
    ]
    const incoming = [
      ev({ id: 'a', seq: 1, type: 'assistant_message', content: '你好，世界', mode: 'delta' }),
      ev({ id: 'b', seq: 2, type: 'assistant_message', content: '！', mode: 'delta' }),
    ]

    const merged = mergeRemoteEvents(base, incoming)

    expect(merged.map((event) => event.id)).toEqual(['a', 'b'])
    expect(merged[0]?.content).toBe('你好，世界')
  })

  it('base 已有完整版时丢弃随后到达的同段 delta，避免重复渲染', () => {
    const base = [
      ev({
        id: 'complete-1',
        seq: 10,
        type: 'assistant_message',
        content: '最终输出',
        mode: 'complete',
        isFinal: true,
        segmentId: 'seg-1',
      }),
    ]
    const incoming = [
      ev({
        id: 'delta-1',
        seq: 5,
        type: 'assistant_message',
        content: '最终',
        mode: 'delta',
        segmentId: 'seg-1',
      }),
      ev({
        id: 'delta-2',
        seq: 6,
        type: 'assistant_message',
        content: '输出',
        mode: 'delta',
        segmentId: 'seg-1',
      }),
    ]

    const merged = mergeRemoteEvents(base, incoming)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('complete-1')
  })

  it('不同 segment 的 delta 互不影响', () => {
    const base = [
      ev({
        id: 'c1',
        seq: 3,
        type: 'assistant_message',
        content: '第一段',
        mode: 'complete',
        segmentId: 'seg-1',
      }),
    ]
    const incoming = [
      ev({
        id: 'd2',
        seq: 4,
        type: 'assistant_message',
        content: '第二段',
        mode: 'delta',
        segmentId: 'seg-2',
      }),
    ]

    const merged = mergeRemoteEvents(base, incoming)

    expect(merged.map((event) => event.id)).toEqual(['c1', 'd2'])
  })

  it('结果按 seq 升序（而非到达顺序）', () => {
    const merged = mergeRemoteEvents(
      [ev({ id: 'late', seq: 9, type: 'user_message', content: '后' })],
      [ev({ id: 'early', seq: 2, type: 'user_message', content: '前' })],
    )

    expect(merged.map((event) => event.id)).toEqual(['early', 'late'])
  })
})

describe('buildRemoteTimeline', () => {
  it('把同段 delta 拼成一条助手消息，并在 complete 时覆盖', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'user_message', content: '帮我看看' }),
      ev({
        id: '2',
        seq: 2,
        type: 'assistant_message',
        content: '好的',
        mode: 'delta',
        segmentId: 's',
        isFinal: false,
      }),
      ev({
        id: '3',
        seq: 3,
        type: 'assistant_message',
        content: '，我来',
        mode: 'delta',
        segmentId: 's',
        isFinal: false,
      }),
      ev({
        id: '4',
        seq: 4,
        type: 'assistant_message',
        content: '好的，我来处理',
        mode: 'complete',
        segmentId: 's',
        isFinal: true,
      }),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'user', text: '帮我看看' })
    expect(items[1]).toMatchObject({
      kind: 'assistant',
      text: '好的，我来处理',
      streaming: false,
    })
  })

  it('tool_call 与 tool_result 按 toolCallId 配对成一条', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'tool_call', toolName: 'bash', toolCallId: 'call-1' }),
      ev({
        id: '2',
        seq: 2,
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'call-1',
        toolStatus: 'success',
        content: 'done',
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      toolName: 'bash',
      status: 'success',
      result: 'done',
    })
  })

  it('agent_error 折叠成一条错误提示', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'agent_error', content: '模型调用失败' }),
    ])

    expect(items).toEqual([
      { kind: 'notice', id: '1', seq: 1, text: '模型调用失败', tone: 'error' },
    ])
  })

  it('忽略空内容与 agent_status（状态由 running 标识承载）', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'assistant_message', content: '', mode: 'delta' }),
      ev({ id: '2', seq: 2, type: 'agent_status', status: 'running' }),
    ])

    expect(items).toEqual([])
  })
})

describe('buildRemoteTimeline — presented_files', () => {
  it('产物文件折叠成一条 files 时间线', () => {
    const items = buildRemoteTimeline([
      ev({
        id: '1',
        seq: 1,
        type: 'presented_files',
        files: [{ path: 'C:/work/report.html', title: '报告' }],
      }),
    ])

    expect(items).toEqual([
      {
        kind: 'files',
        id: '1',
        seq: 1,
        files: [{ path: 'C:/work/report.html', title: '报告' }],
      },
    ])
  })

  it('连续呈现事件按路径去重合并成一张卡片', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'presented_files', files: [{ path: '/a.html' }] }),
      ev({
        id: '2',
        seq: 2,
        type: 'presented_files',
        files: [{ path: '/a.html' }, { path: '/b.png' }],
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('files')
    expect(items[0]?.kind === 'files' ? items[0].files.map((f) => f.path) : []).toEqual([
      '/a.html',
      '/b.png',
    ])
  })

  it('空 files 数组不产生空卡片', () => {
    const items = buildRemoteTimeline([ev({ id: '1', seq: 1, type: 'presented_files', files: [] })])
    expect(items).toEqual([])
  })
})
