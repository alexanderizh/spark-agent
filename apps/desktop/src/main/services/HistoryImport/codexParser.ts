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

const SPARK_MCP_SECTION_RE = new RegExp(
  '^# MCP Servers\\r?\\n' +
    '(?:The following MCP servers have been configured for Codex (?:CLI|SDK) when supported:' +
    '|These MCP servers are configured in Spark:)\\r?$',
  'm',
)

/** 注入式上下文（环境说明 / 指令），不算真实用户输入 */
function isInjectedContext(text: string): boolean {
  const t = text.trimStart()
  const lower = t.toLowerCase()
  return (
    lower.startsWith('<recommended_plugins') ||
    lower.startsWith('<permissions') ||
    lower.startsWith('<environment_context') ||
    lower.startsWith('<user_instructions') ||
    lower.startsWith('<instructions') ||
    lower.startsWith('<system') ||
    lower.startsWith('<files') ||
    t.startsWith('# AGENTS.md') ||
    t.startsWith('# Spark Runtime Context') ||
    t.startsWith('# Spark Skills')
  )
}

/**
 * 剥离 SparkWork 注入到 codex user message 开头的运行时上下文段，保留真实用户消息。
 *
 * SparkWork 调用 codex 时会把「运行时上下文 / 技能目录 / MCP 清单」与真实用户输入
 * 拼接成同一条 user message（见 codex-*-executor 的 prompt builder）。历史上
 * Runtime Context 和 Spark Skills 的顺序曾调整，因此不依赖首个段落，而是以执行器
 * 生成的 `# MCP Servers` 说明行作为稳定边界，提取其后的真实用户消息。
 * 这些注入段（含 [Available Skills Catalog] 等）不是真实用户输入，预览/导入时应剥离。
 *
 * 实测所有含 `# Spark Skills` 的消息均同时含 `# MCP Servers`（最后一个注入段），
 * 且该段内部仅单换行，其后第一个 `\n\n` 即真实用户消息起点，可可靠定位。
 * 不符合该结构时原样返回，避免误删真实内容。
 */
function stripSparkInjectedSections(text: string): string {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('# Spark Runtime Context') && !trimmed.startsWith('# Spark Skills')) {
    return text
  }
  const markerMatch = SPARK_MCP_SECTION_RE.exec(trimmed)
  if (markerMatch?.index == null) return text
  const markerEnd = markerMatch.index + markerMatch[0].length
  const sepMatch = /\r?\n\r?\n/.exec(trimmed.slice(markerEnd))
  if (sepMatch?.index == null) return text
  const sep = markerEnd + sepMatch.index + sepMatch[0].length
  const userMessage = trimmed.slice(sep)
  return userMessage.trim().length > 0 ? userMessage.trimStart() : text
}

/** Codex 附件输入会将真实请求包在 `## My request:` 之后。 */
function stripCodexUserEnvelope(text: string): string {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('# Files mentioned by the user:')) return text
  const match = /^## My request:\r?$/m.exec(trimmed)
  if (match?.index == null) return text
  const request = trimmed.slice(match.index + match[0].length).trimStart()
  return request.length > 0 ? request : text
}

function messageText(content: CodexContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

/**
 * user message 可由多个 content block 组成：Codex 会将插件清单、AGENTS.md
 * 和环境上下文分别写入同一条消息的独立 block。必须逐 block 清洗，不能先拼接再
 * 只看整体首个前缀，否则任意一个注入 block 都可能被误当成标题。
 */
function userMessageText(content: CodexContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block.text !== 'string') continue
    const withoutSparkContext = stripSparkInjectedSections(block.text)
    if (isInjectedContext(withoutSparkContext)) continue
    const cleaned = stripCodexUserEnvelope(withoutSparkContext)
    if (cleaned.trim().length > 0) parts.push(cleaned)
  }
  return parts.join('\n')
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
      const text = userMessageText(p.content)
      if (text.trim().length > 0) return text
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

/**
 * sourceSessionId 取「最后一条 session_meta 的 id」而非首条，这是刻意的：
 * Codex resume/续聊 fork 出的新 rollout 文件首行是自己的新 session id，
 * 但末尾会回写被续聊原 thread 的 session_meta（内容归属标记）。取最后一条
 * 即可让同一 thread 的所有快照（原始文件 + 各代 fork 文件）解析出同一个 id，
 * HistoryImportService.scanCodex 按它归并为一个导入条目。勿改为只取首条——
 * 那会把 fork 快照当独立会话重复展示。
 */
function collectMeta(
  lines: CodexLine[],
  threadName: string | null,
  fallbackId: string,
): TranscriptMeta {
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
      // firstTs 取全行最早而非首行：resume/fork 文件可能复制了更早的历史行
      // （首行自己的 meta 时间晚于被复制内容），取全行 min 才能让
      // HistoryImportService 的主线拼接正确识别文件间的内容重叠。
      if (firstTs == null || l.timestamp.localeCompare(firstTs) < 0) firstTs = l.timestamp
      lastTs = l.timestamp
    }
    if (l.type === 'response_item' && p?.type === 'message') {
      if (p.role === 'assistant') messageCount++
      else if (p.role === 'user') {
        const text = userMessageText(p.content)
        if (text.trim().length > 0) messageCount++
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
export function extractCodexMeta(
  text: string,
  threadName: string | null,
  fallbackId: string,
): TranscriptMeta {
  return collectMeta(parseLines(text), threadName, fallbackId)
}

/** 全量解析为 AgentEvent 序列 */
export function parseCodexRollout(
  text: string,
  params: {
    sessionId: string
    sourceSessionId: string
    threadName: string | null
    fallbackTimestamp: string
  },
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
      if (p.role === 'user') {
        const cleaned = userMessageText(p.content)
        if (cleaned.trim().length === 0) continue
        builder.newTurn()
        segIndex = 0
        sawFirstUserTurn = true
        builder.push({ type: 'user_message', content: cleaned, timestamp: ts })
      } else if (p.role === 'assistant') {
        const text2 = messageText(p.content)
        if (text2.trim().length === 0) continue
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

    if (
      p.type === 'function_call' ||
      p.type === 'custom_tool_call' ||
      p.type === 'local_shell_call'
    ) {
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
