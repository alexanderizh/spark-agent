/**
 * HistoryImport parser 单测 —— 使用合成 fixture（脱敏），覆盖：
 *   - Claude Code：thinking / text / tool_use / tool_result + turn 分组 + 标题/cwd
 *   - Codex：注入上下文过滤 + message / function_call / function_call_output
 *   - seq 单调递增、sessionId 绑定
 */

import { describe, it, expect } from 'vitest'
import { parseClaudeCodeTranscript, extractClaudeCodeMeta } from './claudeCodeParser.js'
import { parseCodexRollout, extractCodexMeta } from './codexParser.js'
import { parseZcodeV2Transcript, extractZcodeV2Meta } from './zcodeV2Parser.js'
import { parseZcodeCliTranscript } from './zcodeCliParser.js'

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

  it('剥离 SparkWork 注入的技能目录/运行时上下文/MCP 段，保留真实用户消息', () => {
    // 模拟 buildCodexPrompt 拼接出的 user message：注入段 + 真实用户输入
    const injectedText = [
      '# Spark Skills',
      '[Available Skills Catalog]',
      'Metadata only. Each entry contains only skill id, name, and description.',
      '',
      '- builtin:demo - Demo: a demo skill',
      '',
      '# Spark Runtime Context',
      '当前会话运行时上下文。',
      '',
      '# MCP Servers',
      'The following MCP servers have been configured for Codex CLI when supported:',
      '- server1',
      '',
      '请帮我重构这段代码',
    ].join('\n')
    const injectedJsonl = jsonl([
      {
        type: 'session_meta',
        timestamp: '2026-06-14T03:00:00.000Z',
        payload: { id: 'cx-inj', cwd: '/proj', timestamp: '2026-06-14T03:00:00.000Z' },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T03:00:01.000Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: injectedText }] },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-14T03:00:02.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好的' }] },
      },
    ])

    const { events, meta } = parseCodexRollout(injectedJsonl, {
      sessionId: 'new-inj',
      sourceSessionId: 'cx-inj',
      threadName: null,
      fallbackTimestamp: FALLBACK_TS,
    })

    // user_message 内容应为剥离注入段后的真实用户消息，而非 [Available Skills Catalog] 开头的整段
    const userMsg = events.find((e) => e.type === 'user_message')
    expect(userMsg).toMatchObject({ content: '请帮我重构这段代码' })

    // messageCount 只计真实用户消息 + assistant，注入段不计入
    expect(meta.messageCount).toBe(2)
    // 无 threadName 时标题取剥离后的真实用户消息
    expect(meta.title).toBe('请帮我重构这段代码')

    // extractCodexMeta（scan 路径）同样反映剥离后的计数与标题
    const metaOnly = extractCodexMeta(injectedJsonl, null, 'fallback')
    expect(metaOnly.messageCount).toBe(2)
    expect(metaOnly.title).toBe('请帮我重构这段代码')
  })
})

// ─── zcode 桌面 App（v2 JSON） ───────────────────────────────────────────────

describe('zcodeV2Parser', () => {
  const v2File = {
    meta: {
      taskId: 'task-v2-1',
      title: '',
      workspacePath: '/Users/me/zproj',
      createdAt: 1778000000000,
      updatedAt: 1778000600000,
      model: 'glm-5.1',
      provider: 'glm',
    },
    messages: [
      { role: 'user', content: '帮我优化构建速度', timestamp: 1778000001000, turnIndex: 0 },
      {
        role: 'assistant',
        content: '我先分析构建配置',
        thought: '需要先查看 vite 配置',
        timestamp: 1778000010000,
        model: 'glm-5.1',
        durationMs: 9000,
        tools: [
          {
            title: 'Read',
            kind: 'read',
            status: 'completed',
            input: { file_path: '/Users/me/zproj/vite.config.ts' },
            output: { success: true, content: "1: import { defineConfig } from 'vite'" },
          },
          {
            title: 'Bash',
            kind: 'execute',
            status: 'failed',
            input: { command: 'pnpm build' },
            output: 'error: out of memory',
          },
        ],
        parts: [
          { type: 'thought', content: '需要先查看 vite 配置' },
          { type: 'tool-call', toolIndex: 0 },
          { type: 'content', content: '我先分析构建配置' },
          { type: 'tool-call', toolIndex: 1 },
        ],
        turnIndex: 0,
      },
      { role: 'user', content: '好的，继续', timestamp: 1778000300000, turnIndex: 1 },
      // 无 parts 的旧版消息：回落顶层 content
      { role: 'assistant', content: '已完成优化', timestamp: 1778000400000, turnIndex: 1 },
    ],
  }
  const text = JSON.stringify(v2File)

  it('映射事件序列：user → thinking → tool → text → tool → user → text', () => {
    const { events } = parseZcodeV2Transcript(text, {
      sessionId: 's1',
      sourceSessionId: 'task-v2-1',
      fallbackTimestamp: FALLBACK_TS,
    })
    const types = events.filter((e) => e.type !== 'agent_status').map((e) => e.type)
    expect(types).toEqual([
      'user_message',
      'agent_thinking',
      'tool_call',
      'tool_result',
      'assistant_message',
      'tool_call',
      'tool_result',
      'user_message',
      'assistant_message',
    ])
  })

  it('tool_call/tool_result 成对且 failed 工具映射为 error', () => {
    const { events } = parseZcodeV2Transcript(text, {
      sessionId: 's1',
      sourceSessionId: 'task-v2-1',
      fallbackTimestamp: FALLBACK_TS,
    })
    const results = events.filter((e) => e.type === 'tool_result')
    expect(results[0]).toMatchObject({ toolName: 'Read', status: 'success', output: "1: import { defineConfig } from 'vite'" })
    expect(results[1]).toMatchObject({ toolName: 'Bash', status: 'error', output: 'error: out of memory' })
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls[0]).toMatchObject({ toolName: 'Read', toolInput: { file_path: '/Users/me/zproj/vite.config.ts' } })
    // call 与 result 的 toolCallId 一致
    expect(results[0]?.toolCallId).toBe(calls[0]?.toolCallId)
  })

  it('turn 分组、seq 单调、isFinal=false + segmentId 唯一', () => {
    const { events } = parseZcodeV2Transcript(text, {
      sessionId: 's1',
      sourceSessionId: 'task-v2-1',
      fallbackTimestamp: FALLBACK_TS,
    })
    const userTurnIds = new Set(
      events.filter((e) => e.type === 'user_message').map((e) => e.turnId),
    )
    expect(userTurnIds.size).toBe(2)
    const seqs = events.map((e) => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    const texts = events.filter((e) => e.type === 'assistant_message')
    expect(texts.every((e) => (e as { isFinal?: boolean }).isFinal === false)).toBe(true)
    const segIds = new Set(texts.map((e) => (e as { segmentId?: string }).segmentId))
    expect(segIds.size).toBe(texts.length)
  })

  it('meta：taskId/cwd/providerHint/标题兜底/时间', () => {
    const { meta } = parseZcodeV2Transcript(text, {
      sessionId: 's1',
      sourceSessionId: 'task-v2-1',
      fallbackTimestamp: FALLBACK_TS,
    })
    expect(meta.sourceSessionId).toBe('task-v2-1')
    expect(meta.cwd).toBe('/Users/me/zproj')
    expect(meta.providerHint).toBe('glm')
    // title 为空 → 首条用户消息兜底
    expect(meta.title).toBe('帮我优化构建速度')
    expect(meta.firstTimestamp).toBe('2026-05-05T16:53:21.000Z')
    expect(meta.messageCount).toBe(4)

    const metaOnly = extractZcodeV2Meta(text, 'fallback')
    expect(metaOnly?.messageCount).toBe(4)
    // 损坏 JSON → null
    expect(extractZcodeV2Meta('{broken', 'fallback')).toBeNull()
  })
})

// ─── zcode CLI（store 重组后的 payload） ─────────────────────────────────────

describe('zcodeCliParser', () => {
  const payload = {
    meta: {
      sessionId: 'sess_cli_1',
      title: '修复筛选报错',
      cwd: '/Users/me/cli-proj',
      createdAt: 1778100000000,
      updatedAt: 1778100060000,
      modelId: 'GLM-5.3',
      providerId: 'builtin:bigmodel-coding-plan',
    },
    messages: [
      {
        data: { role: 'user', time: { created: 1778100001000 } },
        parts: [{ type: 'text', text: '查询任务列表为什么为空' }],
      },
      // hidden 内部提醒：过滤
      {
        data: { role: 'user', time: { created: 1778100002000 }, semantics: { uiVisibility: 'hidden' } },
        parts: [{ type: 'text', text: 'todo reminder' }],
      },
      // 合成的后台任务通知：过滤
      {
        data: { role: 'user', time: { created: 1778100003000 }, synthetic: true, visibility: 'model-only' },
        parts: [{ type: 'text', text: '<task-notification>exec done</task-notification>' }],
      },
      {
        data: { role: 'assistant', time: { created: 1778100010000, completed: 1778100020000 } },
        parts: [
          { type: 'step-start' },
          { type: 'reasoning', text: '先查数据库查询条件' },
          {
            type: 'tool',
            callID: 'call_a1',
            tool: 'Bash',
            state: { status: 'completed', input: { command: 'ls tasks' }, output: 'task1\ntask2' },
          },
          { type: 'step-finish', reason: 'stop' },
          { type: 'text', text: '查询条件缺少默认状态，补上即可' },
        ],
      },
      // 文本级兜底：未打 synthetic 标记的注入式消息也过滤
      {
        data: { role: 'user', time: { created: 1778100030000 } },
        parts: [{ type: 'text', text: '<task-notification>exec_9 done</task-notification>' }],
      },
      // 仅 file part 的 assistant：忽略后无事件
      {
        data: { role: 'assistant', time: { created: 1778100040000 } },
        parts: [{ type: 'file', mime: 'image/png', url: 'zcode-artifact://sess_cli_1/tool-result-x' }],
      },
    ],
  }
  const text = JSON.stringify(payload)

  it('过滤 hidden / synthetic / 注入式 user 消息，仅保留真实输入', () => {
    const { events } = parseZcodeCliTranscript(text, {
      sessionId: 's2',
      sourceSessionId: 'sess_cli_1',
      fallbackTimestamp: FALLBACK_TS,
    })
    const userMsgs = events.filter((e) => e.type === 'user_message')
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]).toMatchObject({ content: '查询任务列表为什么为空' })
  })

  it('assistant parts：reasoning→thinking、tool→call+result、text→assistant_message', () => {
    const { events } = parseZcodeCliTranscript(text, {
      sessionId: 's2',
      sourceSessionId: 'sess_cli_1',
      fallbackTimestamp: FALLBACK_TS,
    })
    const types = events.filter((e) => e.type !== 'agent_status').map((e) => e.type)
    expect(types).toEqual([
      'user_message',
      'agent_thinking',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
    const call = events.find((e) => e.type === 'tool_call')
    expect(call).toMatchObject({ toolName: 'Bash', toolInput: { command: 'ls tasks' } })
    const result = events.find((e) => e.type === 'tool_result')
    expect(result).toMatchObject({ toolCallId: 'call_a1', status: 'success', output: 'task1\ntask2' })
    const msg = events.find((e) => e.type === 'assistant_message')
    expect(msg).toMatchObject({ content: '查询条件缺少默认状态，补上即可', isFinal: false })
  })

  it('meta：sessionId/cwd/providerHint（GLM→glm）/标题来自 session.title', () => {
    const { meta } = parseZcodeCliTranscript(text, {
      sessionId: 's2',
      sourceSessionId: 'sess_cli_1',
      fallbackTimestamp: FALLBACK_TS,
    })
    expect(meta.sourceSessionId).toBe('sess_cli_1')
    expect(meta.cwd).toBe('/Users/me/cli-proj')
    expect(meta.providerHint).toBe('glm')
    expect(meta.title).toBe('修复筛选报错')
    expect(meta.messageCount).toBe(2)
  })

  it('codex 后端 hint 推导', () => {
    const codexPayload = JSON.stringify({
      meta: { sessionId: 's3', title: null, cwd: null, createdAt: null, updatedAt: null, modelId: 'gpt-5', providerId: 'openai-codex' },
      messages: [],
    })
    const { meta } = parseZcodeCliTranscript(codexPayload, {
      sessionId: 's3',
      sourceSessionId: 's3',
      fallbackTimestamp: FALLBACK_TS,
    })
    expect(meta.providerHint).toBe('codex')
  })
})
