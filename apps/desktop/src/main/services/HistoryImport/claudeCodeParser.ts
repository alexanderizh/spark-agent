/**
 * @module HistoryImport/claudeCodeParser
 *
 * 解析 Claude Code transcript（~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl）。
 *
 * 行类型（type 字段）：
 *   - user      —— message.content 为 string（真实用户输入）或 tool_result 数组（工具结果回填）
 *   - assistant —— message.content 为 block 数组：thinking / text / tool_use
 *   - ai-title  —— aiTitle 字段（用作标题）
 *   - system / attachment / summary / mode / agent-setting / ... —— 忽略
 *
 * 映射：user→user_message，assistant text→assistant_message(complete)，
 *       thinking→agent_thinking，tool_use→tool_call，user 的 tool_result→tool_result。
 * isSidechain=true（子 Agent）行跳过，只保留主线程。
 */

import {
  EventSeqBuilder,
  inferToolSource,
  stringifyContent,
  deriveTitle,
  type ParsedTranscript,
  type TranscriptMeta,
} from './types.js'

interface CcContentBlock {
  type?: string
  text?: string
  thinking?: string
  // tool_use
  id?: string
  name?: string
  input?: Record<string, unknown>
  // tool_result
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface CcLine {
  type?: string
  isSidechain?: boolean
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  cwd?: string
  sessionId?: string
  aiTitle?: string
  message?: {
    role?: string
    content?: string | CcContentBlock[]
    model?: string
  }
}

function parseLines(text: string): CcLine[] {
  const out: CcLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as CcLine)
    } catch {
      // 跳过损坏行
    }
  }
  return out
}

function firstUserText(lines: CcLine[]): string | null {
  for (const l of lines) {
    if (l.type !== 'user' || l.isSidechain === true) continue
    const content = l.message?.content
    if (typeof content === 'string' && content.trim().length > 0) return content
    if (Array.isArray(content)) {
      const text = content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join(' ')
      if (text.trim().length > 0) return text
    }
  }
  return null
}

/** 轻量提取元数据（scan 用），不构造事件 */
export function extractClaudeCodeMeta(text: string, fallbackId: string): TranscriptMeta {
  const lines = parseLines(text)
  let cwd: string | null = null
  let sessionId: string | null = null
  let aiTitle: string | null = null
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0

  for (const l of lines) {
    if (l.cwd != null && cwd == null) cwd = l.cwd
    if (l.sessionId != null && sessionId == null) sessionId = l.sessionId
    if (l.type === 'ai-title' && typeof l.aiTitle === 'string') aiTitle = l.aiTitle
    if (l.timestamp != null) {
      if (firstTs == null) firstTs = l.timestamp
      lastTs = l.timestamp
    }
    if ((l.type === 'user' || l.type === 'assistant') && l.isSidechain !== true) {
      const content = l.message?.content
      // 跳过纯 tool_result 的 user 行（不算一条消息）
      if (
        l.type === 'user' &&
        Array.isArray(content) &&
        content.length > 0 &&
        content.every((b) => b.type === 'tool_result')
      ) {
        continue
      }
      messageCount++
    }
  }

  return {
    sourceSessionId: sessionId ?? fallbackId,
    title: deriveTitle(aiTitle ?? firstUserText(lines), '未命名 Claude 会话'),
    cwd,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    messageCount,
  }
}

/** 全量解析为 AgentEvent 序列 */
export function parseClaudeCodeTranscript(
  text: string,
  params: { sessionId: string; sourceSessionId: string; fallbackTimestamp: string },
): ParsedTranscript {
  const lines = parseLines(text)
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)
  /** toolCallId → toolName，用于 tool_result 回填工具名 */
  const toolNameById = new Map<string, string>()

  let cwd: string | null = null
  let sessionId: string | null = null
  let aiTitle: string | null = null
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0
  let sawFirstUserTurn = false

  for (const l of lines) {
    if (l.cwd != null && cwd == null) cwd = l.cwd
    if (l.sessionId != null && sessionId == null) sessionId = l.sessionId
    if (l.type === 'ai-title' && typeof l.aiTitle === 'string') aiTitle = l.aiTitle
    if (l.timestamp != null) {
      if (firstTs == null) firstTs = l.timestamp
      lastTs = l.timestamp
    }
    if (l.isSidechain === true) continue

    if (l.type === 'user') {
      const content = l.message?.content
      const ts = l.timestamp ?? null

      // 纯 tool_result 行：回填到当前 turn，不开新 turn
      if (Array.isArray(content) && content.length > 0 && content.every((b) => b.type === 'tool_result')) {
        for (const block of content) {
          const toolCallId = block.tool_use_id ?? ''
          builder.push({
            type: 'tool_result',
            toolCallId,
            toolName: toolNameById.get(toolCallId) ?? 'unknown',
            status: block.is_error === true ? 'error' : 'success',
            output: stringifyContent(block.content),
            timestamp: ts,
          })
        }
        continue
      }

      // 真实用户消息
      const userText =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((b) => b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
                .join('\n')
            : ''
      if (userText.trim().length === 0) continue

      builder.newTurn()
      sawFirstUserTurn = true
      builder.push({ type: 'user_message', content: userText, timestamp: ts })
      messageCount++
      continue
    }

    if (l.type === 'assistant') {
      if (!sawFirstUserTurn) builder.newTurn()
      const content = l.message?.content
      const provider = 'claude'
      const blocks = Array.isArray(content) ? content : []
      const ts = l.timestamp ?? null
      let segIndex = 0
      let emittedText = false

      for (const block of blocks) {
        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim().length > 0) {
          builder.push({
            type: 'agent_thinking',
            mode: 'complete',
            content: block.thinking,
            segmentId: `${builder.currentTurnId}:think:${segIndex++}`,
            timestamp: ts,
          })
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
          builder.push({
            type: 'assistant_message',
            mode: 'complete',
            content: block.text,
            provider,
            isFinal: true,
            segmentId: `${builder.currentTurnId}:text:${segIndex++}`,
            timestamp: ts,
          })
          emittedText = true
        } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          toolNameById.set(block.id, block.name)
          builder.push({
            type: 'tool_call',
            toolCallId: block.id,
            toolName: block.name,
            toolInput: block.input ?? {},
            ...inferToolSource(block.name),
            timestamp: ts,
          })
        }
      }
      if (emittedText) messageCount++
      continue
    }
    // 其它行类型（system / attachment / summary / mode / ...）忽略
  }

  const meta: TranscriptMeta = {
    sourceSessionId: sessionId ?? params.sourceSessionId,
    title: deriveTitle(aiTitle ?? firstUserText(lines), '未命名 Claude 会话'),
    cwd,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    messageCount,
  }

  return { events: builder.events, meta }
}
