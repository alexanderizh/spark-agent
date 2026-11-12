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

  it('同批次先到 delta、后到 complete 时只保留带身份的完整版', () => {
    const merged = mergeRemoteEvents(
      [],
      [
        ev({
          id: 'delta',
          seq: 1,
          type: 'assistant_message',
          content: '片段',
          mode: 'delta',
          segmentId: 'seg-1',
        }),
        ev({
          id: 'complete',
          seq: 2,
          type: 'assistant_message',
          content: '完整片段',
          mode: 'complete',
          segmentId: 'seg-1',
          isFinal: false,
        }),
      ],
    )

    expect(merged.map((event) => event.id)).toEqual(['complete'])
  })

  it('旧目标端不带 segmentId 的普通 complete 仍能抑制同段 delta', () => {
    const merged = mergeRemoteEvents(
      [],
      [
        ev({ id: 'delta', seq: 1, type: 'assistant_message', content: '片段', mode: 'delta' }),
        ev({
          id: 'complete',
          seq: 2,
          type: 'assistant_message',
          content: '完整片段',
          mode: 'complete',
          isFinal: false,
        }),
      ],
    )

    expect(merged.map((event) => event.id)).toEqual(['complete'])
  })

  it('完整事件之后的同段重试 delta 不应被抑制', () => {
    const merged = mergeRemoteEvents(
      [
        ev({
          id: 'complete-before-retry',
          seq: 2,
          type: 'assistant_message',
          content: '失败尝试正文',
          mode: 'complete',
          segmentId: 'seg-1',
        }),
      ],
      [
        ev({
          id: 'reset',
          seq: 5,
          type: 'assistant_message',
          content: '',
          mode: 'complete',
          segmentId: 'seg-1',
          isFinal: false,
        }),
        ev({
          id: 'retry-delta',
          seq: 6,
          type: 'assistant_message',
          content: '重试正文',
          mode: 'delta',
          segmentId: 'seg-1',
        }),
      ],
    )

    expect(merged.map((event) => event.id)).toEqual([
      'complete-before-retry',
      'reset',
      'retry-delta',
    ])
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

/**
 * 回合级收尾消息（isFinal 且无 segmentId）：
 * 执行器在 result 之后补发一条全文，桌面端曾把它当新分段 → 同一段回答画两遍。
 */
describe('buildRemoteTimeline — 回合级收尾消息', () => {
  const hello = 'Hi! I am your Spark assistant, ready to help.'
  const helloRest = ' What would you like to work on today?'
  const full = hello + helloRest

  it('分段 + 收尾全文只渲染一条，且文本等于全文', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'user_message', content: 'hi' }),
      ev({
        id: '2',
        seq: 2,
        type: 'assistant_message',
        content: hello,
        mode: 'delta',
        segmentId: 'seg-1',
      }),
      ev({
        id: '3',
        seq: 3,
        type: 'assistant_message',
        content: helloRest,
        mode: 'delta',
        segmentId: 'seg-1',
      }),
      // 收尾消息：isFinal、无 segmentId
      ev({
        id: '4',
        seq: 4,
        type: 'assistant_message',
        content: full,
        mode: 'complete',
        isFinal: true,
      }),
    ])

    const assistants = items.filter((item) => item.kind === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.kind === 'assistant' ? assistants[0].text : '').toBe(full)
    expect(assistants[0]?.kind === 'assistant' ? assistants[0].streaming : true).toBe(false)
  })

  it('收尾全文是分段拼接的扩展时只补差量', () => {
    const items = buildRemoteTimeline([
      ev({
        id: '1',
        seq: 1,
        type: 'assistant_message',
        content: hello,
        mode: 'delta',
        segmentId: 'seg-1',
      }),
      ev({
        id: '2',
        seq: 2,
        type: 'assistant_message',
        content: `${hello} 补充一句`,
        isFinal: true,
      }),
    ])

    const assistants = items.filter((item) => item.kind === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.kind === 'assistant' ? assistants[0].text : '').toBe(`${hello} 补充一句`)
  })

  it('多分段的收尾全文扩展只把新增差量追加到末段', () => {
    const items = buildRemoteTimeline([
      ev({
        id: '1',
        seq: 1,
        type: 'assistant_message',
        content: '第一段',
        mode: 'complete',
        segmentId: 'seg-1',
      }),
      ev({
        id: '2',
        seq: 2,
        type: 'assistant_message',
        content: '第二段',
        mode: 'complete',
        segmentId: 'seg-2',
      }),
      ev({
        id: '3',
        seq: 3,
        type: 'assistant_message',
        content: '第一段第二段补充',
        mode: 'complete',
        isFinal: true,
      }),
    ])

    expect(items.filter((item) => item.kind === 'assistant').map((item) => item.text)).toEqual([
      '第一段',
      '第二段补充',
    ])
  })

  it('收尾全文与分段对不上时收敛成一条（内容以全文为准）', () => {
    const items = buildRemoteTimeline([
      ev({
        id: '1',
        seq: 1,
        type: 'assistant_message',
        content: '草稿第一段',
        mode: 'delta',
        segmentId: 'seg-1',
      }),
      ev({
        id: '2',
        seq: 2,
        type: 'assistant_message',
        content: '另一段',
        mode: 'delta',
        segmentId: 'seg-2',
      }),
      ev({ id: '3', seq: 3, type: 'assistant_message', content: full, isFinal: true }),
    ])

    const assistants = items.filter((item) => item.kind === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.kind === 'assistant' ? assistants[0].text : '').toBe(full)
  })

  it('只有收尾消息（历史被截断）时正文照样渲染', () => {
    const items = buildRemoteTimeline([
      ev({ id: '1', seq: 1, type: 'assistant_message', content: full, isFinal: true }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'assistant', text: full })
  })

  it('不同回合的相同收尾正文都保留', () => {
    const items = buildRemoteTimeline([
      ev({
        turnId: 'turn-previous',
        id: 'previous-final',
        seq: 1,
        type: 'assistant_message',
        content: full,
        isFinal: true,
      }),
      ev({
        turnId: 'turn-current',
        id: 'current-final',
        seq: 3,
        type: 'assistant_message',
        content: full,
        isFinal: true,
      }),
    ])

    expect(items.filter((item) => item.kind === 'assistant')).toHaveLength(2)
    expect(items.map((item) => item.seq)).toEqual([1, 3])
  })

  it('缺少分段时把收尾消息按 seq 插入后续事件之前', () => {
    const items = buildRemoteTimeline([
      ev({
        turnId: 'turn-current',
        id: 'current-final',
        seq: 2,
        type: 'assistant_message',
        content: full,
        isFinal: true,
      }),
      ev({
        turnId: 'turn-next',
        id: 'next-user',
        seq: 3,
        type: 'user_message',
        content: '下一轮',
      }),
    ])

    expect(items.map((item) => `${item.kind}:${item.seq}`)).toEqual(['assistant:2', 'user:3'])
  })

  it('真实输出恰好由同一段文本重复组成时不截断', () => {
    const repeated = `${'这是一段真实重复的正文。'}${'这是一段真实重复的正文。'}`
    const items = buildRemoteTimeline([
      ev({
        id: 'repeated',
        seq: 1,
        type: 'assistant_message',
        content: repeated,
        mode: 'complete',
        segmentId: 'seg-1',
        isFinal: false,
      }),
    ])

    expect(items[0]).toMatchObject({ kind: 'assistant', text: repeated })
  })

  it('同回合不同分段身份的相同 assistant 正文都保留', () => {
    const items = buildRemoteTimeline([
      ev({
        id: '1',
        seq: 1,
        type: 'assistant_message',
        content: full,
        mode: 'complete',
        segmentId: 'seg-1',
      }),
      ev({
        id: '2',
        seq: 2,
        type: 'assistant_message',
        content: full,
        mode: 'complete',
        segmentId: 'seg-9',
      }),
    ])

    expect(items.filter((item) => item.kind === 'assistant').map((item) => item.id)).toEqual([
      '1',
      '2',
    ])
  })

  it('空 complete 复位失败尝试后，重试 delta 从空文本开始累积', () => {
    const items = buildRemoteTimeline([
      ev({
        id: 'failed-attempt',
        seq: 1,
        type: 'assistant_message',
        content: '失败尝试半截',
        mode: 'delta',
        segmentId: 'seg-1',
      }),
      ev({
        id: 'reset',
        seq: 2,
        type: 'assistant_message',
        content: '',
        mode: 'complete',
        isFinal: false,
        segmentId: 'seg-1',
      }),
      ev({
        id: 'retry',
        seq: 3,
        type: 'assistant_message',
        content: '重试后的正文',
        mode: 'delta',
        segmentId: 'seg-1',
      }),
    ])

    expect(items.filter((item) => item.kind === 'assistant')).toMatchObject([
      { text: '重试后的正文', streaming: true },
    ])
  })
})

describe('mergeRemoteEvents — 收尾消息不吞流式分片', () => {
  it('base 里只有收尾消息时，无 segmentId 的 delta 仍被保留', () => {
    const base = [
      ev({
        id: 'final',
        seq: 9,
        type: 'assistant_message',
        content: '全文',
        mode: 'complete',
        isFinal: true,
      }),
    ]
    const incoming = [
      // 老版本目标端的 delta 不带 segmentId
      ev({ id: 'd1', seq: 5, type: 'assistant_message', content: '流式', mode: 'delta' }),
    ]

    const merged = mergeRemoteEvents(base, incoming)

    expect(merged.map((event) => event.id)).toEqual(['d1', 'final'])
  })
})

describe('buildRemoteTimeline — 历史会话不该停在「进行中」', () => {
  it('已结束的会话：思考分段全部收敛，只有最后一条正文可能还在流式', () => {
    // 目标端历史里思考没有 isFinal、工具结果可能缺失，只靠 isFinal 判定会整屏「进行中」
    const events = [
      ev({ id: 'u1', seq: 1, type: 'user_message', content: 'hi' }),
      ev({
        id: 'th1',
        seq: 2,
        type: 'agent_thinking',
        content: '想一想',
        mode: 'complete',
        segmentId: 'think-1',
      }),
      ev({ id: 'tc1', seq: 3, type: 'tool_call', toolName: 'bash', toolCallId: 'c1' }),
      ev({
        id: 'tr1',
        seq: 4,
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'c1',
        toolStatus: 'success',
      }),
      ev({
        id: 'a1',
        seq: 5,
        type: 'assistant_message',
        content: '第一段',
        mode: 'complete',
        segmentId: 'seg-1',
      }),
      ev({
        id: 'th2',
        seq: 6,
        type: 'agent_thinking',
        content: '再想想',
        mode: 'complete',
        segmentId: 'think-2',
      }),
      ev({
        id: 'a2',
        seq: 7,
        type: 'assistant_message',
        content: '第二段',
        mode: 'complete',
        segmentId: 'seg-2',
      }),
      ev({ id: 's1', seq: 8, type: 'agent_status', status: 'completed' }),
    ]

    const items = buildRemoteTimeline(events)

    // 收到终态后连最后一条正文也不再流式
    expect(items.every((item) => !('streaming' in item) || item.streaming === false)).toBe(true)
    expect(items.filter((item) => item.kind === 'thinking')).toHaveLength(2)
  })
})
