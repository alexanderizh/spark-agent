/**
 * @module HistoryImport/qoderParser
 *
 * 解析 qoderStore 从 Qoder main.sqlite 重组出的会话载荷（JSON 文本）。
 *
 * 载荷结构：{ meta:{sessionId,title,cwd,createdAt,updatedAt}, messages:[{messageId,sequence,payload}] }
 *   payload（user）      ：{ role:'user', text, timestamp, attachments[] }
 *   payload（assistant） ：{ role:'assistant', text, timestamp, parts[], tools[] }
 *     parts[].type ∈ text / thinking / tool / hook（hook 为生命周期噪声，忽略）
 *     parts[].tool  ：{ id, name, input, status:'completed'|'failed', response }
 *
 * 映射：user→user_message，text part→assistant_message(isFinal=false, segmentId)，
 * thinking part→agent_thinking，tool part→tool_call + tool_result。
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

interface QoderToolPayload {
  id?: string
  name?: string
  input?: Record<string, unknown>
  status?: string
  response?: unknown
  startedAt?: string
}

interface QoderPart {
  type?: string
  text?: string
  tool?: QoderToolPayload
}

interface QoderMessagePayload {
  id?: string
  role?: string
  turnId?: string
  text?: string
  timestamp?: string
  turnStartedAt?: string
  completedAt?: string
  parts?: QoderPart[]
  tools?: QoderToolPayload[]
}

interface QoderTranscript {
  meta?: {
    sessionId?: string
    title?: string
    cwd?: string
    createdAt?: number | null
    updatedAt?: number | null
  }
  messages?: Array<{ messageId?: string; sequence?: number; payload?: QoderMessagePayload }>
}

function msToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseTranscript(text: string): QoderTranscript | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as QoderTranscript
  } catch {
    return null
  }
}

/** 单条消息的可用时间（timestamp 优先，其次 turn 起止时间） */
function messageTimestamp(payload: QoderMessagePayload): string | null {
  for (const candidate of [payload.timestamp, payload.turnStartedAt, payload.completedAt]) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue
    const d = new Date(candidate)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

function firstUserText(transcript: QoderTranscript): string | null {
  for (const message of transcript.messages ?? []) {
    const payload = message?.payload
    if (payload?.role !== 'user') continue
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (text.length > 0) return text
  }
  return null
}

/** 轻量提取元数据（scan / preview 用），不构造事件 */
export function extractQoderMeta(text: string, fallbackId: string): TranscriptMeta {
  const transcript = parseTranscript(text)
  const meta = transcript?.meta ?? {}
  const messages = transcript?.messages ?? []

  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0
  for (const message of messages) {
    const payload = message?.payload
    if (payload == null) continue
    const ts = messageTimestamp(payload)
    if (ts != null) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }
    if (payload.role === 'user') {
      if (typeof payload.text === 'string' && payload.text.trim().length > 0) messageCount++
    } else if (payload.role === 'assistant') {
      const hasText =
        (payload.parts ?? []).some((p) => p?.type === 'text' && (p.text ?? '').trim().length > 0) ||
        (typeof payload.text === 'string' && payload.text.trim().length > 0)
      if (hasText) messageCount++
    }
  }

  return {
    sourceSessionId:
      typeof meta.sessionId === 'string' && meta.sessionId.length > 0 ? meta.sessionId : fallbackId,
    title: deriveTitle(
      typeof meta.title === 'string' && meta.title.trim().length > 0
        ? meta.title
        : firstUserText(transcript ?? {}),
      '未命名 Qoder 会话',
    ),
    cwd: typeof meta.cwd === 'string' && meta.cwd.trim().length > 0 ? meta.cwd : null,
    firstTimestamp: firstTs ?? msToIso(meta.createdAt),
    lastTimestamp: lastTs ?? msToIso(meta.updatedAt),
    messageCount,
  }
}

/** 全量解析为 AgentEvent 序列 */
export function parseQoderTranscript(
  text: string,
  params: { sessionId: string; sourceSessionId: string; fallbackTimestamp: string },
): ParsedTranscript {
  const transcript = parseTranscript(text)
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)
  const fileMeta = transcript?.meta ?? {}
  /** callId → toolName，用于工具结果回填 */
  const toolNameById = new Map<string, string>()

  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0
  let sawTurn = false
  let currentSourceTurnId: string | null = null
  let textSegIndex = 0
  let thinkSegIndex = 0

  const noteTs = (ts: string | null): void => {
    if (ts == null) return
    if (firstTs == null) firstTs = ts
    lastTs = ts
  }

  const beginTurnIfNeeded = (sourceTurnId: string | null): void => {
    if (!sawTurn || (sourceTurnId != null && sourceTurnId !== currentSourceTurnId)) {
      builder.newTurn()
      sawTurn = true
      currentSourceTurnId = sourceTurnId
      textSegIndex = 0
      thinkSegIndex = 0
    }
  }

  const pushTool = (tool: QoderToolPayload | undefined, ts: string | null): void => {
    if (tool == null) return
    const toolCallId = typeof tool.id === 'string' && tool.id.length > 0 ? tool.id : ''
    const toolName = typeof tool.name === 'string' && tool.name.length > 0 ? tool.name : 'unknown'
    if (toolCallId.length > 0) toolNameById.set(toolCallId, toolName)
    builder.push({
      type: 'tool_call',
      toolCallId,
      toolName,
      toolInput: tool.input != null && typeof tool.input === 'object' ? tool.input : {},
      ...inferToolSource(toolName),
      timestamp: ts,
    })
    builder.push({
      type: 'tool_result',
      toolCallId,
      toolName: toolNameById.get(toolCallId) ?? toolName,
      status: tool.status === 'failed' || tool.status === 'error' ? 'error' : 'success',
      output: stringifyContent(tool.response),
      timestamp: ts,
    })
  }

  for (const message of transcript?.messages ?? []) {
    const payload = message?.payload
    if (payload == null) continue
    const ts = messageTimestamp(payload)
    noteTs(ts)
    const sourceTurnId = typeof payload.turnId === 'string' ? payload.turnId : null

    if (payload.role === 'user') {
      const userText = typeof payload.text === 'string' ? payload.text.trim() : ''
      if (userText.length === 0) continue
      builder.newTurn()
      sawTurn = true
      currentSourceTurnId = sourceTurnId
      textSegIndex = 0
      thinkSegIndex = 0
      builder.push({ type: 'user_message', content: userText, timestamp: ts })
      messageCount++
      continue
    }

    if (payload.role !== 'assistant') continue
    beginTurnIfNeeded(sourceTurnId)

    const parts = Array.isArray(payload.parts) ? payload.parts : []
    let emittedText = false
    for (const part of parts) {
      const type = part?.type
      if (type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
        builder.push({
          type: 'assistant_message',
          mode: 'complete',
          content: part.text,
          provider: 'qoder',
          isFinal: false,
          segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
          timestamp: ts,
        })
        emittedText = true
      } else if (
        type === 'thinking' &&
        typeof part.text === 'string' &&
        part.text.trim().length > 0
      ) {
        builder.push({
          type: 'agent_thinking',
          mode: 'complete',
          content: part.text,
          segmentId: `${builder.currentTurnId}:think:${thinkSegIndex++}`,
          timestamp: ts,
        })
      } else if (type === 'tool') {
        pushTool(part.tool, ts)
      }
      // hook 及未知 part 类型忽略
    }

    // parts 缺失（旧数据 / 未落盘分段）时回落：整轮正文与 tools 列表
    if (!emittedText && typeof payload.text === 'string' && payload.text.trim().length > 0) {
      builder.push({
        type: 'assistant_message',
        mode: 'complete',
        content: payload.text,
        provider: 'qoder',
        isFinal: false,
        segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
        timestamp: ts,
      })
      emittedText = true
    }
    if (parts.length === 0 && Array.isArray(payload.tools)) {
      for (const tool of payload.tools) pushTool(tool, ts)
    }
    if (emittedText) messageCount++
  }

  const meta: TranscriptMeta = {
    sourceSessionId:
      typeof fileMeta.sessionId === 'string' && fileMeta.sessionId.length > 0
        ? fileMeta.sessionId
        : params.sourceSessionId,
    title: deriveTitle(
      typeof fileMeta.title === 'string' && fileMeta.title.trim().length > 0
        ? fileMeta.title
        : firstUserText(transcript ?? {}),
      '未命名 Qoder 会话',
    ),
    cwd: typeof fileMeta.cwd === 'string' && fileMeta.cwd.trim().length > 0 ? fileMeta.cwd : null,
    firstTimestamp: firstTs ?? msToIso(fileMeta.createdAt),
    lastTimestamp: lastTs ?? msToIso(fileMeta.updatedAt),
    messageCount,
  }

  return { events: completeImportedTurns(builder.events), meta }
}
