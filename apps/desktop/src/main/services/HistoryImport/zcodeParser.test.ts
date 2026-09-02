/**
 * ZCode parser 单测 —— 合成 fixture 覆盖：
 *   - splitZcodeRoutes：无 revert / 旧格式（createdMessageID）/ 新格式（branchCut）/
 *     kept 空数组（rewind 到开头）/ target 失效降级
 *   - parseZcodeTranscript：user_prompt → user_message、合成消息（todo/system reminder、
 *     rewind 标记、compact_summary）过滤、assistant parts（text/reasoning/tool 状态机）映射、
 *     tool_call+tool_result 成对、segmentId 唯一、turn 终态补全、title/cwd/时间元数据
 */

import { describe, it, expect } from 'vitest'
import {
  parseZcodeTranscript,
  splitZcodeRoutes,
  type ZcodeMessageRow,
  type ZcodeMessageData,
  type ZcodePart,
} from './zcodeParser.js'

const T0 = Date.UTC(2026, 5, 14, 1, 0, 0)

function msg(
  id: string,
  sequence: number,
  offsetMs: number,
  data: Partial<ZcodeMessageData>,
  parts: ZcodePart[] = [],
): ZcodeMessageRow {
  const created = T0 + offsetMs
  return {
    id,
    sequence,
    timeCreated: created,
    data: { time: { created }, ...data },
    parts,
  }
}

function userPrompt(id: string, sequence: number, offsetMs: number, text: string): ZcodeMessageRow {
  return msg(id, sequence, offsetMs, { role: 'user', semantics: { kind: 'user_prompt' } }, [
    { type: 'text', text },
  ])
}

function assistantReply(
  id: string,
  sequence: number,
  offsetMs: number,
  parts: ZcodePart[],
): ZcodeMessageRow {
  return msg(
    id,
    sequence,
    offsetMs,
    { role: 'assistant', semantics: { kind: 'assistant_response' } },
    parts,
  )
}

// ─── splitZcodeRoutes ────────────────────────────────────────────────────────

describe('splitZcodeRoutes', () => {
  it('无 revert 时全部归主线路', () => {
    const rows = [
      userPrompt('m0', 0, 0, 'hi'),
      assistantReply('m1', 1, 100, [{ type: 'text', text: 'ok' }]),
    ]
    const routes = splitZcodeRoutes(rows, null)
    expect(routes.main.map((m) => m.id)).toEqual(['m0', 'm1'])
    expect(routes.branches).toHaveLength(0)
  })

  it('旧格式 revert：kept 前缀 + rewind 后消息为主线路，中间段为分支', () => {
    const rows = [
      userPrompt('m0', 0, 0, 'q1'),
      assistantReply('m1', 1, 100, [{ type: 'text', text: 'a1' }]),
      // 被回退的旧分支：1 条 user + 2 条 assistant
      userPrompt('m2', 2, 200, 'bad question'),
      assistantReply('m3', 3, 300, [{ type: 'text', text: 'bad a1' }]),
      assistantReply('m4', 4, 400, [{ type: 'text', text: 'bad a2' }]),
      // rewind 合成消息 + 新线路
      msg('m5', 5, 500, { role: 'user', synthetic: true, metadata: { source: 'rewind' } }, [
        { type: 'text', text: 'Conversation rewind applied.' },
      ]),
      userPrompt('m6', 6, 600, 'good question'),
      assistantReply('m7', 7, 700, [{ type: 'text', text: 'good a1' }]),
    ]
    const routes = splitZcodeRoutes(rows, {
      kind: 'conversation_rewind',
      targetMessageID: 'm2',
      createdMessageID: 'm5',
      messageID: 'm1',
      keptMessageIDs: ['m0', 'm1'],
    })
    expect(routes.main.map((m) => m.id)).toEqual(['m0', 'm1', 'm5', 'm6', 'm7'])
    expect(routes.branches).toHaveLength(1)
    expect(routes.branches[0]!.index).toBe(1)
    expect(routes.branches[0]!.rows.map((m) => m.id)).toEqual(['m2', 'm3', 'm4'])
  })

  it('新格式 revert：branchCutAfterMessageID 为被回退段最后一条', () => {
    const rows = [
      userPrompt('m0', 0, 0, 'q1'),
      userPrompt('m1', 1, 100, 'bad question'),
      assistantReply('m2', 2, 200, [{ type: 'text', text: 'bad a1' }]),
      userPrompt('m3', 3, 300, 'good question'),
      assistantReply('m4', 4, 400, [{ type: 'text', text: 'good a1' }]),
    ]
    const routes = splitZcodeRoutes(rows, {
      kind: 'conversation_rewind',
      targetMessageID: 'm1',
      branchCutAfterMessageID: 'm2',
      branchGeneration: 1,
      keptMessageIDs: ['m0'],
    })
    expect(routes.main.map((m) => m.id)).toEqual(['m0', 'm3', 'm4'])
    expect(routes.branches[0]!.rows.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('kept 为空数组（rewind 到开头）：主线路 = rewind 后全部', () => {
    const rows = [
      userPrompt('m0', 0, 0, 'bad question'),
      assistantReply('m1', 1, 100, [{ type: 'text', text: 'bad a1' }]),
      userPrompt('m2', 2, 200, 'good question'),
      assistantReply('m3', 3, 300, [{ type: 'text', text: 'good a1' }]),
    ]
    const routes = splitZcodeRoutes(rows, {
      kind: 'conversation_rewind',
      targetMessageID: 'm0',
      createdMessageID: 'm2',
      messageID: 'm0',
      keptMessageIDs: [],
    })
    expect(routes.main.map((m) => m.id)).toEqual(['m2', 'm3'])
    expect(routes.branches[0]!.rows.map((m) => m.id)).toEqual(['m0', 'm1'])
  })

  it('revert 引用失效时降级为单线路', () => {
    const rows = [userPrompt('m0', 0, 0, 'q1')]
    const routes = splitZcodeRoutes(rows, {
      targetMessageID: 'missing-id',
      createdMessageID: 'also-missing',
      keptMessageIDs: [],
    })
    expect(routes.main.map((m) => m.id)).toEqual(['m0'])
    expect(routes.branches).toHaveLength(0)
  })
})

// ─── parseZcodeTranscript ────────────────────────────────────────────────────

describe('parseZcodeTranscript', () => {
  const baseParams = {
    sessionId: 'new-sess',
    sourceSessionId: 'sess_z',
    fallbackTimestamp: '2026-06-14T00:00:00.000Z',
  }

  it('映射 user/assistant/tool 事件并按 turn 分组', () => {
    const rows = [
      userPrompt('u0', 0, 0, '帮我查一下目录'),
      assistantReply('a0', 1, 5000, [
        { type: 'reasoning', text: '先列目录' },
        {
          type: 'tool',
          callID: 'call_abc',
          tool: 'Bash',
          state: { status: 'completed', input: { command: 'ls' }, output: 'file-a\nfile-b' },
        },
        { type: 'text', text: '目录里有 file-a 和 file-b' },
      ]),
      userPrompt('u1', 2, 10_000, '谢谢'),
      assistantReply('a1', 3, 12_000, [{ type: 'text', text: '不客气' }]),
    ]

    const { events, meta } = parseZcodeTranscript(rows, {
      ...baseParams,
      title: '测试会话',
      cwd: 'D:\\proj',
    })

    const kinds = events.map((e) => e.type)
    expect(kinds).toEqual([
      'user_message',
      'agent_thinking',
      'tool_call',
      'tool_result',
      'assistant_message',
      'agent_status',
      'user_message',
      'assistant_message',
      'agent_status',
    ])

    const toolCall = events.find((e) => e.type === 'tool_call')
    expect(toolCall).toMatchObject({
      toolCallId: 'call_abc',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      source: 'builtin',
    })
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toMatchObject({
      toolCallId: 'call_abc',
      status: 'success',
      output: 'file-a\nfile-b',
    })

    // turn 划分：第一 turn 覆盖 user_message..assistant_message，第二 turn 从第二条 user 开始
    const turnIds = [...new Set(events.map((e) => e.turnId))]
    expect(turnIds).toHaveLength(2)

    expect(meta.title).toBe('测试会话')
    expect(meta.cwd).toBe('D:\\proj')
    expect(meta.messageCount).toBe(4)
    expect(meta.firstTimestamp).toBe(new Date(T0).toISOString())
    expect(meta.lastTimestamp).toBe(new Date(T0 + 12_000).toISOString())
  })

  it('过滤合成消息：todo/system reminder、rewind 标记、压缩摘要', () => {
    const rows = [
      msg('r0', 0, 0, { role: 'user', semantics: { kind: 'todo_reminder' }, synthetic: true }, [
        { type: 'text', text: 'TODO 提醒' },
      ]),
      msg('r1', 1, 100, { role: 'user', semantics: { kind: 'system_reminder' }, synthetic: true }, [
        { type: 'text', text: '系统提醒' },
      ]),
      msg('r2', 2, 200, { role: 'user', metadata: { source: 'rewind' }, synthetic: true }, [
        { type: 'text', text: 'Conversation rewind applied.' },
      ]),
      msg('r3', 3, 300, { role: 'user', semantics: { kind: 'compact_summary' }, synthetic: true }, [
        { type: 'text', text: '压缩摘要正文' },
      ]),
      userPrompt('u0', 4, 400, '真实问题'),
      assistantReply('a0', 5, 500, [{ type: 'text', text: '真实回答' }]),
    ]

    const { events } = parseZcodeTranscript(rows, baseParams)
    const userTexts = events.filter((e) => e.type === 'user_message').map((e) => e.content)
    expect(userTexts).toEqual(['真实问题'])
  })

  it('早期数据（无 semantics）的 user 消息视为真实输入', () => {
    const rows = [
      msg('u0', 0, 0, { role: 'user' }, [{ type: 'text', text: '旧版本提问' }]),
      assistantReply('a0', 1, 100, [{ type: 'text', text: '回答' }]),
    ]
    const { events } = parseZcodeTranscript(rows, baseParams)
    expect(events.filter((e) => e.type === 'user_message').map((e) => e.content)).toEqual([
      '旧版本提问',
    ])
  })

  it('同一 turn 多段 text 的 segmentId 互不相同且 isFinal=false', () => {
    const rows = [
      userPrompt('u0', 0, 0, 'q'),
      assistantReply('a0', 1, 100, [{ type: 'text', text: '第一段' }]),
      assistantReply('a1', 2, 200, [{ type: 'text', text: '第二段' }]),
    ]
    const { events } = parseZcodeTranscript(rows, baseParams)
    const texts = events.filter((e) => e.type === 'assistant_message')
    expect(texts).toHaveLength(2)
    expect(new Set(texts.map((e) => e.segmentId)).size).toBe(2)
    expect(texts.every((e) => e.isFinal === false)).toBe(true)
  })

  it('tool part 状态为 error 时 tool_result.status=error 且携带 error 文本', () => {
    const rows = [
      userPrompt('u0', 0, 0, 'q'),
      assistantReply('a0', 1, 100, [
        {
          type: 'tool',
          callID: 'call_err',
          tool: 'mcp__svc__tool',
          state: { status: 'error', input: {}, output: null, error: 'boom' },
        },
      ]),
    ]
    const { events } = parseZcodeTranscript(rows, baseParams)
    const toolCall = events.find((e) => e.type === 'tool_call')
    expect(toolCall).toMatchObject({ source: 'mcp', mcpServerId: 'svc' })
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('title 缺省时回落首条可见用户消息推导', () => {
    const rows = [
      userPrompt('u0', 0, 0, '如何配置多渠道路由'),
      assistantReply('a0', 1, 100, [{ type: 'text', text: '回答' }]),
    ]
    const { meta } = parseZcodeTranscript(rows, { ...baseParams, title: null, cwd: null })
    expect(meta.title).toBe('如何配置多渠道路由')
    expect(meta.cwd).toBeNull()
  })

  it('空行数组解析为空事件且不抛错', () => {
    const { events, meta } = parseZcodeTranscript([], baseParams)
    expect(events).toHaveLength(0)
    expect(meta.messageCount).toBe(0)
    expect(meta.title).toBe('未命名 ZCode 会话')
  })
})
