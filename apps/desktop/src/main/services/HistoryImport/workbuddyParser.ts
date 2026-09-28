/**
 * @module HistoryImport/workbuddyParser
 *
 * 解析 WorkBuddy transcript（~/.workbuddy/projects/<encoded-cwd>/<sessionId>.jsonl）。
 *
 * 行类型（type 字段，均为 Jsonl）：
 *   - message              —— role=user|assistant，content[] 为 {type:'input_text'|'output_text', text}
 *   - reasoning            —— rawContent[] 为 {type:'reasoning_text', text}（content 常为空数组）
 *   - function_call        —— {callId, name, arguments(JSON 字符串), status}
 *   - function_call_result —— {callId, name, output:{type:'text',text}|string, status}
 *   - custom-title / ai-title / summary —— 标题类信息
 *   - session-meta / file-history-snapshot —— 运行时噪声，忽略
 *
 * user 消息常把运行时上下文与真实输入拼在同一条 input_text 中：
 *   `<system-reminder data-role="user-context">…</system-reminder><user_query>真实输入</user_query>`
 * 因此只取 <user_query> 内容；无该标签时剥离 <system-reminder> 与图片路径块。
 * 时间戳为毫秒数字（旧行可能是 ISO 字符串）。
 *
 * 映射：user→user_message，assistant output_text→assistant_message(isFinal=false, segmentId)，
 * reasoning→agent_thinking，function_call→tool_call，function_call_result→tool_result。
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

interface WbContentBlock {
  type?: string
  text?: string
}

interface WbLine {
  type?: string
  timestamp?: number | string
  sessionId?: string
  cwd?: string
  role?: string
  content?: WbContentBlock[]
  rawContent?: WbContentBlock[]
  // function_call
  callId?: string
  name?: string
  arguments?: string
  status?: string
  // function_call_result
  output?: { type?: string; text?: string } | string
  // 标题类
  customTitle?: string
  aiTitle?: string
  summary?: string
}

/** workbuddy.db 提供的兜底元数据（旧版 jsonl 缺 cwd / 标题时使用） */
export interface WorkbuddyFallbackMeta {
  title?: string | null
  cwd?: string | null
}

const USER_QUERY_RE = /<user_query>([\s\S]*?)<\/user_query>/
const SYSTEM_REMINDER_RE = /<system-reminder[\s\S]*?<\/system-reminder>/g
const IMAGE_BLOCK_RE =
  /<(?:image_local_path|image_blob_ref)>[\s\S]*?<\/(?:image_local_path|image_blob_ref)>/g
/** 附件引用（@image#1:Clipboard_Screenshot.png）：指向 WorkBuddy 本地图片，Spark 侧无法解析，剥离 */
const IMAGE_REF_RE = /@image#\d+:[^\s@]*/g
const IMAGE_REF_PROBE_RE = /@image#\d+:/
/** 未闭合的注入块起点（异常截断时从该处截断） */
const INJECT_CUT_RE = /<system-reminder|<image_local_path|<image_blob_ref/

function parseLines(text: string): WbLine[] {
  const out: WbLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as WbLine)
    } catch {
      // 跳过损坏 / 被截断的行
    }
  }
  return out
}

/** 毫秒时间戳 / ISO 字符串 → ISO 8601；非法返回 null */
export function workbuddyTimestampToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) > 1e11 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    if (/^-?\d+$/.test(trimmed)) return workbuddyTimestampToIso(Number(trimmed))
    const d = new Date(trimmed)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/**
 * 从 WorkBuddy 的 user 正文中提取真实用户输入：
 * 优先取 <user_query>，否则剥离注入的运行时上下文与图片块。
 */
export function extractWorkbuddyUserText(raw: string): string {
  const matched = raw.match(USER_QUERY_RE)
  let text = matched != null ? (matched[1] ?? '') : raw
  text = text.replace(SYSTEM_REMINDER_RE, '').replace(IMAGE_BLOCK_RE, '')
  const cut = text.search(INJECT_CUT_RE)
  if (cut >= 0) text = text.slice(0, cut)
  text = text
    .replace(IMAGE_REF_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  // 纯图片消息：引用剥离后为空，用占位符保留该轮对话
  if (text.length === 0 && IMAGE_REF_PROBE_RE.test(raw)) return '[图片]'
  return text
}

/** message 行的文本块拼接（user 的 input_text / assistant 的 output_text） */
function messageText(line: WbLine): string {
  const blocks = Array.isArray(line.content) ? line.content : []
  return blocks
    .filter((b) => typeof b.text === 'string' && b.text.length > 0)
    .map((b) => b.text as string)
    .join('\n')
}

/** reasoning 行的思考文本（rawContent 优先，兼容 content） */
function reasoningText(line: WbLine): string {
  for (const blocks of [line.rawContent, line.content]) {
    if (!Array.isArray(blocks)) continue
    const text = blocks
      .filter((b) => typeof b.text === 'string' && b.text.length > 0)
      .map((b) => b.text as string)
      .join('\n')
    if (text.trim().length > 0) return text
  }
  return ''
}

function toolInputOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return parsed === undefined ? {} : { value: parsed }
    } catch {
      return { raw }
    }
  }
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function pickTitle(lines: WbLine[], fallback?: WorkbuddyFallbackMeta): string | null {
  let customTitle: string | null = null
  let aiTitle: string | null = null
  let summary: string | null = null
  for (const l of lines) {
    if (
      customTitle == null &&
      typeof l.customTitle === 'string' &&
      l.customTitle.trim().length > 0
    ) {
      customTitle = l.customTitle
    }
    if (aiTitle == null && typeof l.aiTitle === 'string' && l.aiTitle.trim().length > 0) {
      aiTitle = l.aiTitle
    }
    if (typeof l.summary === 'string' && l.summary.trim().length > 0) summary = l.summary
  }
  return customTitle ?? aiTitle ?? summary ?? fallback?.title ?? userTitle(lines)
}

function userTitle(lines: WbLine[]): string | null {
  for (const l of lines) {
    if (l.type !== 'message' || l.role !== 'user') continue
    const text = extractWorkbuddyUserText(messageText(l))
    if (text.length > 0) return text
  }
  return null
}

/** 轻量提取元数据（scan 用），不构造事件 */
export function extractWorkbuddyMeta(
  text: string,
  fallbackId: string,
  fallback?: WorkbuddyFallbackMeta,
): TranscriptMeta {
  const lines = parseLines(text)
  let cwd: string | null = null
  let sessionId: string | null = null
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0

  for (const l of lines) {
    if (cwd == null && typeof l.cwd === 'string' && l.cwd.trim().length > 0) cwd = l.cwd
    if (sessionId == null && typeof l.sessionId === 'string' && l.sessionId.length > 0) {
      sessionId = l.sessionId
    }
    const ts = workbuddyTimestampToIso(l.timestamp)
    if (ts != null) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }
    if (l.type === 'message' && l.role === 'user') {
      if (extractWorkbuddyUserText(messageText(l)).length > 0) messageCount++
    } else if (l.type === 'message' && l.role === 'assistant') {
      if (messageText(l).trim().length > 0) messageCount++
    }
  }

  return {
    sourceSessionId: sessionId ?? fallbackId,
    title: deriveTitle(pickTitle(lines, fallback), '未命名 WorkBuddy 会话'),
    cwd: cwd ?? fallback?.cwd ?? null,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    messageCount,
  }
}

/** 全量解析为 AgentEvent 序列 */
export function parseWorkbuddyTranscript(
  text: string,
  params: {
    sessionId: string
    sourceSessionId: string
    fallbackTimestamp: string
    fallback?: WorkbuddyFallbackMeta
  },
): ParsedTranscript {
  const lines = parseLines(text)
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)
  /** callId → toolName，用于 function_call_result 回填工具名 */
  const toolNameById = new Map<string, string>()

  let cwd: string | null = null
  let sessionId: string | null = null
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0
  let sawFirstUserTurn = false
  let textSegIndex = 0
  let thinkSegIndex = 0

  for (const l of lines) {
    if (cwd == null && typeof l.cwd === 'string' && l.cwd.trim().length > 0) cwd = l.cwd
    if (sessionId == null && typeof l.sessionId === 'string' && l.sessionId.length > 0) {
      sessionId = l.sessionId
    }
    const ts = workbuddyTimestampToIso(l.timestamp)
    if (ts != null) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }

    if (l.type === 'message' && l.role === 'user') {
      const userText = extractWorkbuddyUserText(messageText(l))
      if (userText.length === 0) continue
      builder.newTurn()
      sawFirstUserTurn = true
      textSegIndex = 0
      thinkSegIndex = 0
      builder.push({ type: 'user_message', content: userText, timestamp: ts })
      messageCount++
      continue
    }

    if (l.type === 'message' && l.role === 'assistant') {
      if (!sawFirstUserTurn) {
        builder.newTurn()
        textSegIndex = 0
        thinkSegIndex = 0
      }
      const blocks = Array.isArray(l.content) ? l.content : []
      let emittedText = false
      for (const block of blocks) {
        if (typeof block.text !== 'string' || block.text.trim().length === 0) continue
        if (block.type === 'output_text' || block.type === 'text' || block.type == null) {
          builder.push({
            type: 'assistant_message',
            mode: 'complete',
            content: block.text,
            provider: 'workbuddy',
            // isFinal=false：每段独立正文，走 segmentId 累加（同 turn 多段正文不互相覆盖）
            isFinal: false,
            segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
            timestamp: ts,
          })
          emittedText = true
        } else if (
          block.type === 'thinking' ||
          block.type === 'reasoning' ||
          block.type === 'reasoning_text'
        ) {
          builder.push({
            type: 'agent_thinking',
            mode: 'complete',
            content: block.text,
            segmentId: `${builder.currentTurnId}:think:${thinkSegIndex++}`,
            timestamp: ts,
          })
        }
      }
      if (emittedText) messageCount++
      continue
    }

    if (l.type === 'reasoning') {
      const think = reasoningText(l)
      if (think.trim().length === 0) continue
      if (!sawFirstUserTurn) {
        builder.newTurn()
        textSegIndex = 0
        thinkSegIndex = 0
      }
      builder.push({
        type: 'agent_thinking',
        mode: 'complete',
        content: think,
        segmentId: `${builder.currentTurnId}:think:${thinkSegIndex++}`,
        timestamp: ts,
      })
      continue
    }

    if (l.type === 'function_call') {
      const toolCallId = typeof l.callId === 'string' && l.callId.length > 0 ? l.callId : ''
      const toolName = typeof l.name === 'string' && l.name.length > 0 ? l.name : 'unknown'
      if (!sawFirstUserTurn) {
        builder.newTurn()
        textSegIndex = 0
        thinkSegIndex = 0
      }
      if (toolCallId.length > 0) toolNameById.set(toolCallId, toolName)
      builder.push({
        type: 'tool_call',
        toolCallId,
        toolName,
        toolInput: toolInputOf(l.arguments),
        ...inferToolSource(toolName),
        timestamp: ts,
      })
      continue
    }

    if (l.type === 'function_call_result') {
      const toolCallId = typeof l.callId === 'string' ? l.callId : ''
      const toolName =
        typeof l.name === 'string' && l.name.length > 0
          ? l.name
          : (toolNameById.get(toolCallId) ?? 'unknown')
      if (!sawFirstUserTurn) {
        builder.newTurn()
        textSegIndex = 0
        thinkSegIndex = 0
      }
      builder.push({
        type: 'tool_result',
        toolCallId,
        toolName,
        status: l.status === 'error' || l.status === 'failed' ? 'error' : 'success',
        output: stringifyContent(l.output),
        timestamp: ts,
      })
      continue
    }
    // 其它行类型（session-meta / file-history-snapshot / summary / *-title）忽略
  }

  const meta: TranscriptMeta = {
    sourceSessionId: sessionId ?? params.sourceSessionId,
    title: deriveTitle(pickTitle(lines, params.fallback), '未命名 WorkBuddy 会话'),
    cwd: cwd ?? params.fallback?.cwd ?? null,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    messageCount,
  }

  return { events: completeImportedTurns(builder.events), meta }
}
