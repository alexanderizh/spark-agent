/**
 * @module HistoryImport/zcodeParser
 *
 * 解析 ZCode CLI 会话（~/.zcode/cli/db/db.sqlite 的 session/message/part 三级表，
 * 由 zcodeStore 以结构化行载入，本模块保持纯函数可测）。
 *
 * 消息信封（message.data）关键字段：role / time.created(epoch ms) / semantics.kind /
 * synthetic / metadata.source；内容在独立 part 行（type: text / reasoning / tool /
 * step-start / step-finish / timeline / file / compaction）。工具调用与结果是同一个
 * tool part 的状态机（state.input / state.output / state.status）。
 *
 * rewind 分支（session.revert 列）语义（已在真实库上验证）：
 *   - message.sequence 是全会话单调追加序号，rewind 后新消息不重用旧序号
 *   - 当前主线路 = keptMessageIDs 前缀 + rewind 之后的新消息
 *   - 被回退旧分支 = [targetMessageID.sequence, 边界] 连续区间：
 *       旧格式边界 = createdMessageID.sequence - 1（rewind 会生成一条合成消息）
 *       新格式边界 = branchCutAfterMessageID.sequence（无合成消息）
 *   - kept 为空数组合法（回退到会话开头，主线路 = rewind 后全部消息）
 *   - 多次 rewind 时 revert 列只保留最后一次，降级为按最后一次切分
 *
 * 映射：user_prompt→user_message，assistant text→assistant_message(complete)，
 *       reasoning→agent_thinking，tool part→tool_call+tool_result 成对。
 *       合成消息（todo/system reminder、rewind 标记、压缩摘要等）与注入上下文跳过。
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

// ─── 行类型（由 zcodeStore 查询载入，测试可直接构造） ──────────────────────────

/** part.data 内容块（只声明本 parser 关心的字段） */
export interface ZcodePart {
  type?: string
  /** text / reasoning 块正文 */
  text?: string
  /** tool 块：调用 ID（形如 call_<hex>） */
  callID?: string
  /** tool 块：工具名 */
  tool?: string
  /** tool 块状态机 */
  state?: {
    status?: string
    input?: unknown
    output?: unknown
    error?: unknown
  }
}

/** message.data 信封（只声明本 parser 关心的字段） */
export interface ZcodeMessageData {
  role?: string
  time?: { created?: number }
  modelID?: string
  providerID?: string
  semantics?: { kind?: string; uiVisibility?: string }
  /** 合成消息（reminder / rewind 标记等），非真实用户输入 */
  synthetic?: boolean
  metadata?: { source?: string; visibility?: string }
}

/** 单条消息（含其 parts，均已按 sequence 排序） */
export interface ZcodeMessageRow {
  id: string
  sequence: number
  /** epoch ms */
  timeCreated: number
  data: ZcodeMessageData
  parts: ZcodePart[]
}

/** session.revert 列 JSON（只声明切分所需字段） */
export interface ZcodeRevert {
  kind?: string
  /** 被回退段的第一条消息（丢弃段起点，不在 kept 中） */
  targetMessageID?: string
  /** rewind 生成的合成消息（旧格式）；其 sequence 是被回退段上边界 + 1 */
  createdMessageID?: string
  /** 被回退段的最后一条消息（新格式） */
  branchCutAfterMessageID?: string
  /** rewind 时保留的消息白名单（仅快照，不含 rewind 后新消息） */
  keptMessageIDs?: string[]
  /** 发起 rewind 时刻有效线路的最后一条消息（= kept 最后一个元素；旧格式） */
  messageID?: string
  /** 分支计数（新格式） */
  branchGeneration?: number
}

/** 分支线路切分结果 */
export interface ZcodeRoutes {
  main: ZcodeMessageRow[]
  branches: Array<{ index: number; rows: ZcodeMessageRow[] }>
}

// ─── 分支切分 ────────────────────────────────────────────────────────────────

/**
 * 按 revert 记录把会话消息切分为当前主线路与被回退的旧分支线路。
 * 输入无需预排序（内部按 sequence 排序）；revert 缺失或引用的消息不存在时
 * 降级为单线路（全部视为主线路）。
 */
export function splitZcodeRoutes(
  messages: ZcodeMessageRow[],
  revert: ZcodeRevert | null | undefined,
): ZcodeRoutes {
  const sorted = [...messages].sort((a, b) => a.sequence - b.sequence)
  if (revert == null || typeof revert.targetMessageID !== 'string') {
    return { main: sorted, branches: [] }
  }

  const seqById = new Map(sorted.map((m) => [m.id, m.sequence]))
  const targetSeq = seqById.get(revert.targetMessageID)
  if (targetSeq == null) {
    // revert 引用失效（schema 演进 / 数据迁移）：保守地放弃分支切分
    return { main: sorted, branches: [] }
  }

  // 被回退段上边界（含）：旧格式看 rewind 合成消息，新格式看 branchCut
  let droppedEnd: number
  if (typeof revert.createdMessageID === 'string') {
    const rewSeq = seqById.get(revert.createdMessageID)
    if (rewSeq == null || rewSeq <= targetSeq) return { main: sorted, branches: [] }
    droppedEnd = rewSeq - 1
  } else if (typeof revert.branchCutAfterMessageID === 'string') {
    const cutSeq = seqById.get(revert.branchCutAfterMessageID)
    if (cutSeq == null || cutSeq < targetSeq) return { main: sorted, branches: [] }
    droppedEnd = cutSeq
  } else {
    return { main: sorted, branches: [] }
  }

  const main: ZcodeMessageRow[] = []
  const branchRows: ZcodeMessageRow[] = []
  for (const m of sorted) {
    if (m.sequence >= targetSeq && m.sequence <= droppedEnd) branchRows.push(m)
    else main.push(m)
  }
  // 分支线路里可能残留更早 rewind 的合成消息（多次 rewind 历史被最后一次 revert
  // 覆盖），parse 阶段会按 synthetic 过滤，这里保留原始行不额外处理。
  return {
    main,
    branches: branchRows.length > 0 ? [{ index: 1, rows: branchRows }] : [],
  }
}

// ─── 消息过滤 ────────────────────────────────────────────────────────────────

/** 应作为可见正文保留的消息类型（其余全部跳过） */
function isVisibleUserMessage(m: ZcodeMessageRow): boolean {
  const d = m.data
  if (d.role !== 'user') return false
  if (d.synthetic === true) return false
  const kind = d.semantics?.kind
  // 新数据显式标 user_prompt；早期数据无 semantics，视为真实用户输入
  if (kind != null && kind !== 'user_prompt') return false
  // rewind 标记等合成行（部分旧版本走 metadata.source 而非 semantics）
  if (d.metadata?.source === 'rewind') return false
  return true
}

function userText(m: ZcodeMessageRow): string {
  return m.parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
}

// ─── 解析 ────────────────────────────────────────────────────────────────────

export interface ZcodeParseParams {
  sessionId: string
  sourceSessionId: string
  fallbackTimestamp: string
  /** 会话标题（session.title；空则回落首条用户消息推导） */
  title?: string | null
  /** 工作目录（session.directory） */
  cwd?: string | null
}

/**
 * 把一条线路（主线路或分支线路）的消息行解析为标准 AgentEvent 序列。
 * 与 claudeCodeParser 的 turn / segmentId 约定一致：
 *   - 真实用户输入开新 turn；turn 内被工具调用分隔的多个正文段各有独立 segmentId
 *   - assistant_message 一律 isFinal=false（历史快照，避免 summarizer 覆盖）
 */
export function parseZcodeTranscript(
  rows: ZcodeMessageRow[],
  params: ZcodeParseParams,
): ParsedTranscript {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence)
  const builder = new EventSeqBuilder(params.sessionId, params.fallbackTimestamp)

  let firstTs: number | null = null
  let lastTs: number | null = null
  let messageCount = 0
  let sawFirstUserTurn = false
  let textSegIndex = 0
  let thinkSegIndex = 0

  for (const m of sorted) {
    const created = m.data.time?.created ?? m.timeCreated
    if (typeof created === 'number' && !Number.isNaN(created)) {
      if (firstTs == null) firstTs = created
      lastTs = created
    }
    const ts =
      typeof created === 'number' && !Number.isNaN(created) ? new Date(created).toISOString() : null

    if (m.data.role === 'user') {
      if (!isVisibleUserMessage(m)) continue
      const text = userText(m)
      if (text.trim().length === 0) continue

      builder.newTurn()
      sawFirstUserTurn = true
      textSegIndex = 0
      thinkSegIndex = 0
      builder.push({ type: 'user_message', content: text, timestamp: ts })
      messageCount++
      continue
    }

    if (m.data.role === 'assistant') {
      if (!sawFirstUserTurn) {
        builder.newTurn()
        textSegIndex = 0
        thinkSegIndex = 0
      }
      let emittedText = false

      for (const part of m.parts) {
        if (
          part.type === 'reasoning' &&
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
        } else if (
          part.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.trim().length > 0
        ) {
          builder.push({
            type: 'assistant_message',
            mode: 'complete',
            content: part.text,
            provider: 'zcode',
            isFinal: false,
            segmentId: `${builder.currentTurnId}:text:${textSegIndex++}`,
            timestamp: ts,
          })
          emittedText = true
        } else if (
          part.type === 'tool' &&
          typeof part.callID === 'string' &&
          typeof part.tool === 'string'
        ) {
          const state = part.state ?? {}
          const status = state.status === 'error' ? 'error' : 'success'
          builder.push({
            type: 'tool_call',
            toolCallId: part.callID,
            toolName: part.tool,
            toolInput: isRecord(state.input) ? state.input : {},
            ...inferToolSource(part.tool),
            timestamp: ts,
          })
          builder.push({
            type: 'tool_result',
            toolCallId: part.callID,
            toolName: part.tool,
            status,
            output: stringifyContent(state.output),
            ...(state.error != null ? { error: stringifyContent(state.error) } : {}),
            timestamp: ts,
          })
        }
        // step-start / step-finish / timeline / file / compaction：忽略
      }
      if (emittedText) messageCount++
      continue
    }
    // 其它 role（system 等）跳过
  }

  const meta: TranscriptMeta = {
    sourceSessionId: params.sourceSessionId,
    title: deriveTitle(params.title ?? firstVisibleUserText(sorted), '未命名 ZCode 会话'),
    cwd: params.cwd ?? null,
    firstTimestamp: firstTs != null ? new Date(firstTs).toISOString() : null,
    lastTimestamp: lastTs != null ? new Date(lastTs).toISOString() : null,
    messageCount,
  }

  return { events: completeImportedTurns(builder.events), meta }
}

function firstVisibleUserText(rows: ZcodeMessageRow[]): string | null {
  for (const m of rows) {
    if (!isVisibleUserMessage(m)) continue
    const text = userText(m)
    if (text.trim().length > 0) return text
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
