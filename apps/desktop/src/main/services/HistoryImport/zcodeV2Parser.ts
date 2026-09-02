/**
 * @module HistoryImport/zcodeV2Parser
 *
 * 解析 ZCode 桌面 App 会话（~/.zcode/v2/sessions/<workspace-hash>/<taskId>.json）。
 *
 * 文件为单个 JSON 对象：
 *   {
 *     meta:     { taskId, title, workspacePath, createdAt, updatedAt, model, provider, ... }
 *     messages: [
 *       { role: 'user',      content, timestamp, turnIndex, attachments?, ... }
 *       { role: 'assistant', content, timestamp, turnIndex, thought?, tools?, parts?, ... }
 *     ]
 *   }
 *
 * 消息字段（本机 114 个会话实测）：
 *   - parts —— 顺序流：{type:'thought',content} / {type:'content',content} /
 *     {type:'tool-call',toolIndex}，其中 toolIndex 指向同消息 tools[] 数组下标
 *   - tools —— 工具调用明细：{title, kind: read|search|edit|think|execute|other,
 *     status: completed|failed, input: object|string, output: {success,content}|string }
 *   - thought —— 与 parts 中 thought 段等价的首段思考文本（无 parts 时的兜底）
 *   - attachments —— user 消息内嵌 base64 图片，导入对话文本时不搬运（跳过）
 *
 * 映射：user→user_message；parts 依次 thought→agent_thinking、
 *       tool-call→tool_call+tool_result（zcode 把输入输出合存于 tools 条目）、
 *       content→assistant_message(isFinal=false, segmentId)。
 * 无 parts 的旧消息回落 content/thought 顶层字段。
 */

import {
  EventSeqBuilder,
  completeImportedTurns,
  inferToolSource,
  deriveTitle,
  type ParsedTranscript,
  type TranscriptMeta,
} from './types.js'

interface ZcodeV2Meta {
  taskId?: string
  title?: string
  workspacePath?: string
  createdAt?: number
  updatedAt?: number
  model?: string
  provider?: string
}

interface ZcodeV2Tool {
  title?: string
  kind?: string
  status?: string
  input?: unknown
  output?: unknown
}

interface ZcodeV2Part {
  type?: string
  content?: string
  toolIndex?: number
}

interface ZcodeV2Message {
  role?: string
  content?: unknown
  timestamp?: number
  thought?: unknown
  tools?: ZcodeV2Tool[]
  parts?: ZcodeV2Part[]
  turnIndex?: number
}

interface ZcodeV2File {
  meta?: ZcodeV2Meta
  messages?: ZcodeV2Message[]
}

function parseFile(text: string): ZcodeV2File | null {
  try {
    const obj = JSON.parse(text) as ZcodeV2File
    if (obj != null && typeof obj === 'object' && Array.isArray(obj.messages)) return obj
  } catch {
    // 单文件整体 JSON，损坏则放弃
  }
  return null
}

/** ms epoch → ISO 8601；非法返回 null */
function msToIso(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** tools 条目的 input/output 可能是对象、{success,content} 包装或 repr 字符串，统一压成字符串 */
function toolPayloadText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (
      typeof obj['content'] === 'string' &&
      (typeof obj['success'] === 'boolean' || Object.keys(obj).length === 1)
    ) {
      return obj['content']
    }
    try {
      return JSON.stringify(value, null, 0)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** tools 条目的 input 保留结构化形态（tool_call.toolInput 期望对象） */
function toolInputObject(value: unknown): Record<string, unknown> {
  if (value == null) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return { raw: value }
    } catch {
      return { raw: value }
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}

function toolNameOf(tool: ZcodeV2Tool | undefined, index: number): string {
  const title = asText(tool?.title).trim()
  if (title.length > 0) return title
  return `zcode-tool-${index}`
}

function messageText(msg: ZcodeV2Message): string {
  return asText(msg.content)
}

/** 首条真实用户消息文本（标题兜底） */
function firstUserText(messages: ZcodeV2Message[]): string | null {
  for (const m of messages) {
    if (m.role !== 'user') continue
    const text = messageText(m)
    if (text.trim().length > 0) return text
  }
  return null
}

function collectMeta(file: ZcodeV2File, fallbackId: string): TranscriptMeta {
  const meta = file.meta ?? {}
  let firstTs: string | null = null
  let lastTs: string | null = null
  let messageCount = 0
  for (const m of file.messages ?? []) {
    const ts = msToIso(m.timestamp)
    if (ts != null) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }
    const text = messageText(m)
    if (m.role === 'user') {
      if (text.trim().length > 0) messageCount++
    } else if (m.role === 'assistant') {
      if (text.trim().length > 0 || asText(m.thought).trim().length > 0) messageCount++
    }
  }
  const created = msToIso(meta.createdAt)
  const updated = msToIso(meta.updatedAt)
  // provider: glm / claude / codex（导入时用于映射续聊 adapter）
  const providerHint = asText(meta.provider).trim()
  return {
    sourceSessionId: asText(meta.taskId) || fallbackId,
    title: deriveTitle(asText(meta.title) || firstUserText(file.messages ?? []), '未命名 ZCode 会话'),
    cwd: asText(meta.workspacePath) || null,
    firstTimestamp: firstTs ?? created,
    lastTimestamp: lastTs ?? updated,
    messageCount,
    ...(providerHint.length > 0 ? { providerHint } : {}),
  }
}

/** 轻量提取元数据（scan 用），不构造事件 */
export function extractZcodeV2Meta(text: string, fallbackId: string): TranscriptMeta | null {
  const file = parseFile(text)
  if (file == null) return null
  return collectMeta(file, fallbackId)
}

/** 全量解析为 AgentEvent 序列 */
export function parseZcodeV2Transcript(
  text: string,
  params: { sessionId: string; sourceSessionId: string; fallbackTimestamp: string },
): ParsedTranscript {
  const file = parseFile(text) ?? { messages: [] }
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)
  let sawFirstUserTurn = false
  // 同 turn 内被工具调用分隔的多段正文各自需要独立 segmentId（见 claudeCodeParser 同款注释）
  let textSegIndex = 0
  let thinkSegIndex = 0

  const openTurn = () => {
    builder.newTurn()
    textSegIndex = 0
    thinkSegIndex = 0
  }

  for (const msg of file.messages ?? []) {
    const ts = msToIso(msg.timestamp)

    if (msg.role === 'user') {
      const text = messageText(msg).trim()
      if (text.length === 0) continue
      openTurn()
      sawFirstUserTurn = true
      builder.push({ type: 'user_message', content: text, timestamp: ts })
      continue
    }

    if (msg.role !== 'assistant') continue
    if (!sawFirstUserTurn) {
      openTurn()
    }

    const parts = Array.isArray(msg.parts) ? msg.parts : []
    if (parts.length > 0) {
      for (const part of parts) {
        if (part.type === 'thought') {
          const thoughtText = asText(part.content).trim()
          if (thoughtText.length === 0) continue
          builder.push({
            type: 'agent_thinking',
            mode: 'complete',
            content: thoughtText,
            segmentId: `${builder.currentTurnId}:think:${thinkSegIndex++}`,
            timestamp: ts,
          })
        } else if (part.type === 'content') {
          const contentText = asText(part.content).trim()
          if (contentText.length === 0) continue
          builder.push({
            type: 'assistant_message',
            mode: 'complete',
            content: contentText,
            provider: 'zcode',
            // isFinal=false：导入的每段正文都是独立完整文本，运行时一个 turn 只允许
            // 一个 isFinal=true，多段标 true 会互相覆盖（见 claudeCodeParser 注释）。
            isFinal: false,
            segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
            timestamp: ts,
          })
        } else if (part.type === 'tool-call') {
          const tool = msg.tools?.[part.toolIndex ?? -1]
          const toolName = toolNameOf(tool, part.toolIndex ?? 0)
          const toolCallId = `zc-${params.sourceSessionId}:${builder.currentTurnId}:${part.toolIndex ?? 0}`
          const failed = tool?.status === 'failed'
          builder.push({
            type: 'tool_call',
            toolCallId,
            toolName,
            toolInput: toolInputObject(tool?.input),
            ...inferToolSource(toolName),
            timestamp: ts,
          })
          builder.push({
            type: 'tool_result',
            toolCallId,
            toolName,
            status: failed ? 'error' : 'success',
            output: toolPayloadText(tool?.output),
            timestamp: ts,
          })
        }
      }
      continue
    }

    // 无 parts 的旧版/精简消息：回落顶层 thought + content
    const thoughtText = asText(msg.thought).trim()
    if (thoughtText.length > 0) {
      builder.push({
        type: 'agent_thinking',
        mode: 'complete',
        content: thoughtText,
        segmentId: `${builder.currentTurnId}:think:${thinkSegIndex++}`,
        timestamp: ts,
      })
    }
    const contentText = messageText(msg).trim()
    if (contentText.length > 0) {
      builder.push({
        type: 'assistant_message',
        mode: 'complete',
        content: contentText,
        provider: 'zcode',
        isFinal: false,
        segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
        timestamp: ts,
      })
    }
  }

  const meta = collectMeta(file, params.sourceSessionId)
  return { events: completeImportedTurns(builder.events), meta }
}
