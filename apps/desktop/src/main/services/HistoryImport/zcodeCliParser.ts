/**
 * @module HistoryImport/zcodeCliParser
 *
 * 解析 zcode CLI 会话（~/.zcode/cli/db/db.sqlite，经 zcodeCliStore 重组后的载荷）。
 *
 * 消息模型（本机 589 会话实测）：
 *   message.data = { role, time:{created,completed?}, semantics?, synthetic?,
 *                    visibility?, model:{providerID,modelID}?, ... }
 *   part.data.type：
 *     - text       {text}                    —— user/assistant 正文
 *     - reasoning  {text}                    —— 思考（对应 agent_thinking）
 *     - tool       {callID, tool, state:{status,input,output}} —— 工具调用+结果合存
 *     - file       {mime,url:zcode-artifact://...} —— 附件，artifact 不随库导出，跳过
 *     - step-start / step-finish / compaction —— 步骤边界/压缩标记，忽略
 *
 * 非真实用户输入的过滤（实测三类）：
 *   - semantics.uiVisibility === 'hidden'（todo_reminder 等内部提醒）
 *   - synthetic === true 或 visibility === 'model-only'（后台任务通知 <task-notification>）
 *   - 文本级兜底：以 <task-notification> 等 XML 式系统标记开头
 */

import {
  EventSeqBuilder,
  completeImportedTurns,
  inferToolSource,
  type ParsedTranscript,
  type TranscriptMeta,
} from './types.js'

interface ZcodeCliPayload {
  meta?: {
    sessionId?: string
    title?: string | null
    cwd?: string | null
    createdAt?: number | null
    updatedAt?: number | null
    modelId?: string | null
    providerId?: string | null
  }
  messages?: Array<{ data?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }>
}

function parsePayload(text: string): ZcodeCliPayload {
  try {
    return JSON.parse(text) as ZcodeCliPayload
  } catch {
    return {}
  }
}

function msToIso(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 消息时间：data.time.created（ms） */
function messageTimestamp(data: Record<string, unknown>): string | null {
  const time = data['time']
  if (time != null && typeof time === 'object') {
    return msToIso((time as Record<string, unknown>)['created'])
  }
  return null
}

/** 非真实用户输入判定（hidden / synthetic / model-only） */
function isSyntheticUserMessage(data: Record<string, unknown>): boolean {
  const semantics = data['semantics']
  if (
    semantics != null &&
    typeof semantics === 'object' &&
    (semantics as Record<string, unknown>)['uiVisibility'] === 'hidden'
  ) {
    return true
  }
  if (data['synthetic'] === true) return true
  if (data['visibility'] === 'model-only') return true
  return false
}

/** 文本级兜底：XML 式系统注入标记开头（task-notification / environment_context 等） */
function isInjectedUserText(text: string): boolean {
  const t = text.trimStart().toLowerCase()
  return (
    t.startsWith('<task-notification') ||
    t.startsWith('<environment_context') ||
    t.startsWith('<permissions') ||
    t.startsWith('<system') ||
    t.startsWith('# AGENTS.md')
  )
}

/** 拼接一条消息的全部 text part */
function collectTextParts(parts: Array<Record<string, unknown>>): string {
  const out: string[] = []
  for (const part of parts) {
    if (part['type'] === 'text' && typeof part['text'] === 'string') {
      out.push(part['text'])
    }
  }
  return out.join('\n')
}

/** 首条真实用户文本（标题兜底） */
function firstUserText(payload: ZcodeCliPayload): string | null {
  for (const msg of payload.messages ?? []) {
    const data = msg.data
    if (data == null || data['role'] !== 'user') continue
    if (isSyntheticUserMessage(data)) continue
    const text = collectTextParts(msg.parts ?? [])
    if (text.trim().length === 0) continue
    if (isInjectedUserText(text)) continue
    return text
  }
  return null
}

/** providerId/modelId → glm/claude/codex 引擎提示（模糊匹配，仅影响续聊 adapter 默认映射） */
function deriveProviderHint(payload: ZcodeCliPayload): string | undefined {
  const providerId = payload.meta?.providerId ?? ''
  const modelId = payload.meta?.modelId ?? ''
  const joined = `${providerId} ${modelId}`.toLowerCase()
  if (joined.includes('codex')) return 'codex'
  if (joined.includes('claude')) return 'claude'
  if (joined.includes('bigmodel') || joined.includes('glm') || joined.includes('zhipu')) return 'glm'
  return undefined
}

function collectMeta(payload: ZcodeCliPayload, fallbackId: string): TranscriptMeta {
  const meta = payload.meta ?? {}
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0
  for (const msg of payload.messages ?? []) {
    const data = msg.data
    if (data == null) continue
    const ts = messageTimestamp(data)
    if (ts != null) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }
    if (data['role'] === 'user') {
      if (isSyntheticUserMessage(data)) continue
      const text = collectTextParts(msg.parts ?? [])
      if (text.trim().length === 0 || isInjectedUserText(text)) continue
      messageCount++
    } else if (data['role'] === 'assistant') {
      const text = collectTextParts(msg.parts ?? [])
      const hasReasoning = (msg.parts ?? []).some((p) => p['type'] === 'reasoning')
      if (text.trim().length > 0 || hasReasoning) messageCount++
    }
  }
  const providerHint = deriveProviderHint(payload)
  return {
    sourceSessionId: meta.sessionId || fallbackId,
    title: meta.title ?? firstUserText(payload) ?? '',
    cwd: meta.cwd ?? null,
    firstTimestamp: firstTs ?? msToIso(meta.createdAt),
    lastTimestamp: lastTs ?? msToIso(meta.updatedAt),
    messageCount,
    ...(providerHint != null ? { providerHint } : {}),
  }
}

/** 轻量提取元数据（scan 场景直接用 store 的 summary，此导出主要供测试/预览） */
export function extractZcodeCliMeta(text: string, fallbackId: string): TranscriptMeta {
  return collectMeta(parsePayload(text), fallbackId)
}

/** 全量解析为 AgentEvent 序列 */
export function parseZcodeCliTranscript(
  text: string,
  params: { sessionId: string; sourceSessionId: string; fallbackTimestamp: string },
): ParsedTranscript {
  const payload = parsePayload(text)
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)
  let sawFirstUserTurn = false
  // 同 turn 内被工具分隔的多段正文各自需要独立 segmentId（见 claudeCodeParser 同款注释）
  let textSegIndex = 0
  let thinkSegIndex = 0

  const openTurn = () => {
    builder.newTurn()
    textSegIndex = 0
    thinkSegIndex = 0
  }

  for (const msg of payload.messages ?? []) {
    const data = msg.data
    if (data == null) continue
    const ts = messageTimestamp(data)
    const parts = msg.parts ?? []

    if (data['role'] === 'user') {
      if (isSyntheticUserMessage(data)) continue
      const text = collectTextParts(parts).trim()
      if (text.length === 0 || isInjectedUserText(text)) continue
      openTurn()
      sawFirstUserTurn = true
      builder.push({ type: 'user_message', content: text, timestamp: ts })
      continue
    }

    if (data['role'] !== 'assistant') continue
    if (!sawFirstUserTurn) {
      // 开场即 assistant（罕见）：归入独立 turn，避免事件无 turn 归属
      openTurn()
    }

    let toolIndexInTurn = 0
    for (const part of parts) {
      const type = part['type']
      if (type === 'reasoning' && typeof part['text'] === 'string' && part['text'].trim().length > 0) {
        builder.push({
          type: 'agent_thinking',
          mode: 'complete',
          content: part['text'],
          segmentId: `${builder.currentTurnId}:think:${thinkSegIndex++}`,
          timestamp: ts,
        })
      } else if (type === 'text' && typeof part['text'] === 'string' && part['text'].trim().length > 0) {
        builder.push({
          type: 'assistant_message',
          mode: 'complete',
          content: part['text'],
          provider: 'zcode',
          // isFinal=false：导入的每段正文都是独立完整文本，运行时一个 turn 只允许
          // 一个 isFinal=true，多段标 true 会互相覆盖（见 claudeCodeParser 注释）。
          isFinal: false,
          segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
          timestamp: ts,
        })
      } else if (type === 'tool') {
        const toolName = typeof part['tool'] === 'string' && part['tool'].length > 0 ? part['tool'] : 'zcode-tool'
        const state = (part['state'] ?? {}) as Record<string, unknown>
        const callId = typeof part['callID'] === 'string' && part['callID'].length > 0 ? part['callID'] : `zc-cli-${builder.currentTurnId}:${toolIndexInTurn}`
        toolIndexInTurn++
        const status = state['status']
        const failed = status === 'failed' || status === 'error'
        const input = state['input']
        builder.push({
          type: 'tool_call',
          toolCallId: callId,
          toolName,
          toolInput:
            input != null && typeof input === 'object' && !Array.isArray(input)
              ? (input as Record<string, unknown>)
              : input != null
                ? { raw: String(input) }
                : {},
          ...inferToolSource(toolName),
          timestamp: ts,
        })
        builder.push({
          type: 'tool_result',
          toolCallId: callId,
          toolName,
          status: failed ? 'error' : 'success',
          output: toolResultText(state),
          timestamp: ts,
        })
      }
      // step-start / step-finish / file / compaction / 未知类型忽略
    }
  }

  const meta = collectMeta(payload, params.sourceSessionId)
  return { events: completeImportedTurns(builder.events), meta }
}

/** tool part 的 state.output 可能是 string / {content} / {error} 结构，统一压成字符串 */
function toolResultText(state: Record<string, unknown>): string {
  const output = state['output']
  if (output == null) {
    const error = state['error']
    if (error != null) return typeof error === 'string' ? error : JSON.stringify(error)
    return ''
  }
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>
    if (typeof obj['content'] === 'string') return obj['content']
    if (typeof obj['text'] === 'string') return obj['text']
    try {
      return JSON.stringify(output)
    } catch {
      return String(output)
    }
  }
  return String(output)
}
