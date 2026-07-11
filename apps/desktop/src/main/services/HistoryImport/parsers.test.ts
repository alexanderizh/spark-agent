/**
 * HistoryImport parser 单测 —— 使用合成 fixture（脱敏），覆盖：
 *   - Claude Code：thinking / text / tool_use / tool_result + turn 分组 + 标题/cwd
 *   - Codex：注入上下文过滤 + message / function_call / function_call_output
 *   - seq 单调递增、sessionId 绑定
 */

import { describe, it, expect } from 'vitest'
import { parseClaudeCodeTranscript, extractClaudeCodeMeta } from './claudeCodeParser.js'
import { parseCodexRollout, extractCodexMeta } from './codexParser.js'

const FALLBACK_TS = '2026-06-14T00:00:00.000Z'

function jsonl(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

describe('claudeCodeParser', () => {
  const text = jsonl([
    { type: 'agent-setting', agentSetting: 'claude', sessionId: 'sess-1' },
    { type: 'ai-title', aiTitle: '修复登录问题', sessionId: 'sess-1' },
    {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-06-14T01:00:00.000Z',
      cwd: '/home/me/proj',
      sessionId: 'sess-1',
      message: { role: 'user', content: '帮我修复登录' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-06-14T01:00:05.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先看代码', signature: 'x' },
          { type: 'text', text: '我来看一下' },
          { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a.ts' } },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-06-14T01:00:06.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file content' }],
      },
    },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: '2026-06-14T01:00:08.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: '已修复' }] },
    },
    // 子 Agent 行应被忽略
    {
      type: 'assistant',
      isSidechain: true,
      message: { role: 'assistant', content: [{ type: 'text', text: 'sidechain noise' }] },
    },
  ])

  it('解析出正确的事件序列与 turn 分组', () => {
    const { events, meta } = parseClaudeCodeTranscript(text, {
      sessionId: 'new-sess',
      sourceSessionId: 'sess-1',
      fallbackTimestamp: FALLBACK_TS,
    })

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'user_message',
      'agent_thinking',
      'assistant_message',
      'tool_call',
      'tool_result',
      'assistant_message',
      'agent_status',
    ])

    // seq 单调递增 + sessionId 绑定
    events.forEach((e, i) => {
      expect(e.seq).toBe(i)
      expect(e.sessionId).toBe('new-sess')
    })

    // 一个用户 turn（tool_result 不开新 turn）
    const userTurn = events[0]!.turnId
    expect(events.slice(0, 7).every((e) => e.turnId === userTurn)).toBe(true)

    // tool_result 关联到 tool_call 的工具名
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toMatchObject({ toolCallId: 'call_1', toolName: 'Read', status: 'success' })

    expect(events.at(-1)).toMatchObject({ type: 'agent_status', status: 'completed' })

    expect(meta.title).toBe('修复登录问题')
    expect(meta.cwd).toBe('/home/me/proj')
    expect(meta.messageCount).toBe(3) // 1 user + 2 assistant text
  })

  it('assistant_message 的 isFinal=false 且 segmentId 唯一（不覆盖同 turn 多段正文）', () => {
    const { events } = parseClaudeCodeTranscript(text, {
      sessionId: 'new-sess',
      sourceSessionId: 'sess-1',
      fallbackTimestamp: FALLBACK_TS,
    })
    const assistantMsgs = events.filter((e) => e.type === 'assistant_message')
    // 同一 turn 内两条 assistant text，各自独立 segmentId，isFinal=false
    expect(assistantMsgs.length).toBe(2)
    expect(assistantMsgs.every((e) => (e as { isFinal: boolean }).isFinal === false)).toBe(true)
    const segIds = assistantMsgs.map((e) => (e as { segmentId?: string }).segmentId)
    expect(segIds[0]).not.toBe(segIds[1])
    // 两条正文都被保留（addSegment 不应互相覆盖）
    const contents = assistantMsgs.map((e) => (e as { content: string }).content)
    expect(contents).toContain('我来看一下')
    expect(contents).toContain('已修复')
  })

  it('extractClaudeCodeMeta 与全量解析的 meta 一致', () => {
    const meta = extractClaudeCodeMeta(text, 'fallback-id')
    expect(meta.sourceSessionId).toBe('sess-1')
    expect(meta.title).toBe('修复登录问题')
    expect(meta.messageCount).toBe(3)
  })

  it('多轮对话：多个真实用户消息 → 多个不同 turnId，每轮 assistant 正文完整保留', () => {
    const multiTurnText = jsonl([
      { type: 'ai-title', aiTitle: '多轮测试', sessionId: 'sess-mt' },
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-14T01:00:00.000Z',
        cwd: '/home/me/proj',
        sessionId: 'sess-mt',
        message: { role: 'user', content: '第一轮问题' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-14T01:00:05.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: '第一轮回答段A' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1b',
        timestamp: '2026-06-14T01:00:06.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: '第一轮回答段B' }] },
      },
      {
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-06-14T01:01:00.000Z',
        message: { role: 'user', content: '第二轮问题' },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-06-14T01:01:05.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: '第二轮回答' }] },
      },
    ])

    const { events, meta } = parseClaudeCodeTranscript(multiTurnText, {
      sessionId: 'mt-sess',
      sourceSessionId: 'sess-mt',
      fallbackTimestamp: FALLBACK_TS,
    })

    const userMsgs = events.filter((e) => e.type === 'user_message')
    expect(userMsgs.length).toBe(2)
    expect(userMsgs[0]!.content).toBe('第一轮问题')
    expect(userMsgs[1]!.content).toBe('第二轮问题')

    // 两个 user_message 必须有不同 turnId
    expect(userMsgs[0]!.turnId).not.toBe(userMsgs[1]!.turnId)

    const asstMsgs = events.filter((e) => e.type === 'assistant_message')
    expect(asstMsgs.length).toBe(3)
    // 第一轮两条 assistant 正文都在（不被 isFinal 覆盖）
    const allContent = asstMsgs.map((e) => e.content)
    expect(allContent).toContain('第一轮回答段A')
    expect(allContent).toContain('第一轮回答段B')
    expect(allContent).toContain('第二轮回答')

    // 第一轮的两条 assistant 共享 turnId，第二轮的 turnId 不同
    const turn1 = userMsgs[0]!.turnId
    const turn2 = userMsgs[1]!.turnId
    const turn1Asst = asstMsgs.filter((e) => e.turnId === turn1)
    const turn2Asst = asstMsgs.filter((e) => e.turnId === turn2)
    expect(turn1Asst.length).toBe(2)
    expect(turn2Asst.length).toBe(1)

    expect(meta.messageCount).toBe(5) // 2 user + 3 assistant text
  })
})

describe('codexParser', () => {
  const text = jsonl([
    {
      type: 'session_meta',
      timestamp: '2026-06-14T02:00:00.000Z',
      payload: { id: 'cx-1', cwd: 'G:\\proj', timestamp: '2026-06-14T02:00:00.000Z' },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:01.000Z',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions> ...' }] },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:02.000Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions ...' }] },
    },
    { type: 'turn_context', timestamp: '2026-06-14T02:00:03.000Z', payload: { turn_id: 't1', cwd: 'G:\\proj' } },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:04.000Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '请帮我加个功能' }] },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:05.000Z',
      payload: { type: 'reasoning', summary: [], encrypted_content: 'gAAA...' },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:06.000Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好的，我来加' }] },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:07.000Z',
      payload: { type: 'function_call', name: 'shell_command', arguments: '{"cmd":"ls"}', call_id: 'c1' },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-14T02:00:08.000Z',
      payload: { type: 'function_call_output', call_id: 'c1', output: 'a.ts\nb.ts' },
    },
    // event_msg 噪声应被忽略
    { type: 'event_msg', timestamp: '2026-06-14T02:00:09.000Z', payload: { type: 'task_started' } },
  ])

  it('过滤注入上下文，解析真实对话 + 工具调用', () => {
    const { events, meta } = parseCodexRollout(text, {
      sessionId: 'new-cx',
      sourceSessionId: 'cx-1',
      threadName: '加功能',
      fallbackTimestamp: FALLBACK_TS,
    })

    const types = events.map((e) => e.type)
    // developer + AGENTS.md user + reasoning + event_msg 全部跳过
    expect(types).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
      'agent_status',
    ])

    const userMsg = events[0]
    expect(userMsg).toMatchObject({ type: 'user_message', content: '请帮我加个功能', sessionId: 'new-cx' })

    const toolCall = events.find((e) => e.type === 'tool_call')
    expect(toolCall).toMatchObject({ toolName: 'shell_command', toolCallId: 'c1', toolInput: { cmd: 'ls' } })

    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toMatchObject({ toolCallId: 'c1', toolName: 'shell_command' })

    expect(events.at(-1)).toMatchObject({ type: 'agent_status', status: 'completed' })

    events.forEach((e, i) => expect(e.seq).toBe(i))

    // assistant_message 的 isFinal=false（不是整轮汇总，是单段完整正文）
    const asstMsg = events.find((e) => e.type === 'assistant_message') as { isFinal: boolean }
    expect(asstMsg.isFinal).toBe(false)

    expect(meta.title).toBe('加功能')
    expect(meta.cwd).toBe('G:\\proj')
    expect(meta.messageCount).toBe(2) // 1 user(real) + 1 assistant
  })

  it('多轮对话：多个真实用户消息 → 多个不同 turnId，assistant segmentId 唯一', () => {
    const multiTurnText = jsonl([
      {
        type: 'session_meta',
        timestamp: '2026-06-14T02:00:00.000Z',
        payload: { id: 'cx-mt', cwd: '/proj', timestamp: '2026-06-14T02:00:00.000Z' },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T02:00:02.000Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第一轮请求' }] },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T02:00:04.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '第一轮回答A' }] },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T02:00:05.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '第一轮回答B' }] },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T02:01:02.000Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第二轮请求' }] },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T02:01:04.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '第二轮回答' }] },
      },
    ])

    const { events, meta } = parseCodexRollout(multiTurnText, {
      sessionId: 'mt-cx',
      sourceSessionId: 'cx-mt',
      threadName: null,
      fallbackTimestamp: FALLBACK_TS,
    })

    const userMsgs = events.filter((e) => e.type === 'user_message')
    expect(userMsgs.length).toBe(2)
    expect(userMsgs[0]!.turnId).not.toBe(userMsgs[1]!.turnId)

    const asstMsgs = events.filter((e) => e.type === 'assistant_message')
    expect(asstMsgs.length).toBe(3)
    // 同 turn 内多条 assistant 的 segmentId 必须不同（避免 addSegment 覆盖）
    const turn1Asst = asstMsgs.filter((e) => e.turnId === userMsgs[0]!.turnId)
    expect(turn1Asst.length).toBe(2)
    const segIds = turn1Asst.map((e) => (e as { segmentId?: string }).segmentId)
    expect(segIds[0]).not.toBe(segIds[1])

    const allContent = asstMsgs.map((e) => e.content)
    expect(allContent).toContain('第一轮回答A')
    expect(allContent).toContain('第一轮回答B')
    expect(allContent).toContain('第二轮回答')

    expect(meta.messageCount).toBe(5) // 2 user + 3 assistant
  })

  it('extractCodexMeta 优先用 threadName 作为标题', () => {
    const meta = extractCodexMeta(text, '加功能', 'fallback')
    expect(meta.title).toBe('加功能')
    expect(meta.sourceSessionId).toBe('cx-1')
    expect(meta.messageCount).toBe(2)
  })
})
