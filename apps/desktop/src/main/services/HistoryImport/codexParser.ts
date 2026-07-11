/**
 * @module HistoryImport/codexParser
 *
 * 解析 Codex rollout（~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl）。
 *
 * 行类型（type 字段）：
 *   - session_meta —— payload.{id,cwd,timestamp,originator}（首行）
 *   - turn_context —— payload.{turn_id,cwd}
 *   - response_item —— payload.type：message / reasoning / function_call / function_call_output /
 *                       custom_tool_call / custom_tool_call_output / local_shell_call ...
 *   - event_msg —— UI 噪声（task_started / token 统计 / delta），忽略
 *
 * 映射：user message→user_message，assistant message→assistant_message(complete)，
 *       *_call→tool_call，*_call_output→tool_result。reasoning 为加密内容，跳过。
 *       developer/system 角色与注入式上下文（AGENTS.md / <permissions> 等）跳过。
 */

import {
  EventSeqBuilder,
  completeImportedTurns,
  inferToolSource,
  stringifyContent,
  deriveTitle,
  type ParsedTranscript,
  type TranscriptMeta,
} from './types.js'

interface CodexContentBlock {
  type?: string
  text?: string
}

interface CodexPayload {
  type?: string
  id?: string
  cwd?: string
  timestamp?: string
  turn_id?: string
  role?: string
  content?: CodexContentBlock[]
  name?: string
  arguments?: string
  input?: string
  call_id?: string
  output?: unknown
  action?: Record<string, unknown>
}

interface CodexLine {
  type?: string
  timestamp?: string
  payload?: CodexPayload
}

/** 注入式上下文（环境说明 / 指令），不算真实用户输入 */
function isInjectedContext(text: string): boolean {
  const t = text.trimStart()
  const lower = t.toLowerCase()
  return (
    lower.startsWith('<permissions') ||
    lower.startsWith('<environment_context') ||
    lower.startsWith('<user_instructions') ||
    lower.startsWith('<instructions') ||
    lower.startsWith('<system') ||
    lower.startsWith('<files') ||
    t.startsWith('# AGENTS.md')
  )
}

function messageText(content: CodexContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

function parseLines(text: string): CodexLine[] {
  const out: CodexLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as CodexLine)
    } catch {
      // 跳过损坏行
    }
  }
  return out
}

function firstUserText(lines: CodexLine[]): string | null {
  for (const l of lines) {
    if (l.type !== 'response_item') continue
    const p = l.payload
    if (p?.type === 'message' && p.role === 'user') {
      const text = messageText(p.content)
      if (text.trim().length > 0 && !isInjectedContext(text)) return text
    }
  }
  return null
}

function parseToolInput(raw: string | undefined): Record<string, unknown> {
  if (raw == null || raw === '') return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { raw }
  }
}

function collectMeta(lines: CodexLine[], threadName: string | null, fallbackId: string): TranscriptMeta {
  let id: string | null = null
  let cwd: string | null = null
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0

  for (const l of lines) {
    const p = l.payload
    if (l.type === 'session_meta' && p != null) {
      if (p.id != null) id = p.id
      if (p.cwd != null) cwd = p.cwd
      if (p.timestamp != null && firstTs == null) firstTs = p.timestamp
    }
    if (l.type === 'turn_context' && p?.cwd != null && cwd == null) cwd = p.cwd
    if (l.timestamp != null) {
      if (firstTs == null) firstTs = l.timestamp
      lastTs = l.timestamp
    }
    if (l.type === 'response_item' && p?.type === 'message') {
      if (p.role === 'assistant') messageCount++
      else if (p.role === 'user') {
        const text = messageText(p.content)
        if (text.trim().length > 0 && !isInjectedContext(text)) messageCount++
      }
    }
  }

  return {
    sourceSessionId: id ?? fallbackId,
    title: deriveTitle(threadName ?? firstUserText(lines), '未命名 Codex 会话'),
    cwd,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    messageCount,
  }
}

/** 轻量提取元数据（scan 用） */
export function extractCodexMeta(text: string, threadName: string | null, fallbackId: string): TranscriptMeta {
  return collectMeta(parseLines(text), threadName, fallbackId)
}

/** 全量解析为 AgentEvent 序列 */
export function parseCodexRollout(
  text: string,
  params: { sessionId: string; sourceSessionId: string; threadName: string | null; fallbackTimestamp: string },
): ParsedTranscript {
  const lines = parseLines(text)
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)
  const toolNameById = new Map<string, string>()
  let sawFirstUserTurn = false
  // 同 turn 内多条 assistant message 的段索引，确保各自有独立 segmentId
  let segIndex = 0

  for (const l of lines) {
    if (l.type !== 'response_item') continue
    const p = l.payload
    if (p == null) continue
    const ts = l.timestamp ?? null

    if (p.type === 'message') {
      const text2 = messageText(p.content)
      if (text2.trim().length === 0) continue

      if (p.role === 'user') {
        if (isInjectedContext(text2)) continue
        builder.newTurn()
        segIndex = 0
        sawFirstUserTurn = true
        builder.push({ type: 'user_message', content: text2, timestamp: ts })
      } else if (p.role === 'assistant') {
        if (!sawFirstUserTurn) {
          builder.newTurn()
          segIndex = 0
        }
        builder.push({
          type: 'assistant_message',
          mode: 'complete',
          content: text2,
          provider: 'codex',
          // isFinal=false：导入的每条 assistant message 都是一段独立完整正文，不是"整轮拼接
          // 的最终 result"。运行时约定一个 turn 只有一个 isFinal=true（整轮汇总文本），
          // 若每条都标 true，conversation-summarizer 的 addSegment 会互相覆盖、只留最后一条。
          // 设 false 让历史重建走 segmentId 路径正确累加多段正文。
          isFinal: false,
          segmentId: `${builder.currentTurnId}:text:${segIndex++}`,
          timestamp: ts,
        })
      }
      // developer / system 角色跳过
      continue
    }

    if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      if (!sawFirstUserTurn) {
        builder.newTurn()
        segIndex = 0
      }
      const toolName = p.name ?? (p.type === 'local_shell_call' ? 'shell' : 'tool')
      const callId = p.call_id ?? ''
      if (callId !== '') toolNameById.set(callId, toolName)
      const toolInput =
        p.type === 'custom_tool_call'
          ? { input: p.input ?? '' }
          : p.action != null
            ? (p.action as Record<string, unknown>)
            : parseToolInput(p.arguments)
      builder.push({
        type: 'tool_call',
        toolCallId: callId,
        toolName,
        toolInput,
        ...inferToolSource(toolName),
        timestamp: ts,
      })
      continue
    }

    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const callId = p.call_id ?? ''
      builder.push({
        type: 'tool_result',
        toolCallId: callId,
        toolName: toolNameById.get(callId) ?? 'unknown',
        status: 'success',
        output: stringifyContent(p.output),
        timestamp: ts,
      })
      continue
    }
    // reasoning（加密）/ 其它类型忽略
  }

  const meta = collectMeta(lines, params.threadName, params.sourceSessionId)
  return { events: completeImportedTurns(builder.events), meta }
}
