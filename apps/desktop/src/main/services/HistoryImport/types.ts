/**
 * @module HistoryImport/types
 *
 * 历史导入内部类型 + AgentEvent 构造辅助。
 *
 * 两个 parser（Claude Code / Codex）共用一套输出：把宿主 transcript 解析为
 * 标准 AgentEvent 序列（带单调 seq + turnId + timestamp），写入 agent_events 表后
 * 运行时即可重建对话历史、继续对话。
 */

import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'

/** 分配式 Omit：在联合类型上逐个成员 Omit，保留各自的判别字段 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** push 的入参：去掉由 builder 统一填充的 base 字段，timestamp 改为可选 */
type EventInput = DistributiveOmit<AgentEvent, 'id' | 'sessionId' | 'turnId' | 'seq' | 'timestamp'> & {
  timestamp?: string | null
}

/** transcript 轻量元数据（scan / 导入结果共用） */
export interface TranscriptMeta {
  sourceSessionId: string
  title: string
  cwd: string | null
  firstTimestamp: string | null
  lastTimestamp: string | null
  /** user + assistant 文本消息数 */
  messageCount: number
}

/** 完整解析结果 */
export interface ParsedTranscript {
  events: AgentEvent[]
  meta: TranscriptMeta
}

/**
 * 顺序事件构造器：统一分配 id / seq / turnId / timestamp，保证 seq 单调递增
 * （EventRepository 按 json_extract($.seq) 排序回放）。
 */
export class EventSeqBuilder {
  private seq = 0
  private turnId: string
  readonly events: AgentEvent[] = []
  private lastTimestamp: string | null = null

  constructor(
    private readonly sessionId: string,
    private readonly fallbackTimestamp: string,
  ) {
    this.turnId = randomUUID()
  }

  /** 开启新一轮对话（一次用户输入到 Agent 完整响应为一个 turn） */
  newTurn(): string {
    this.turnId = randomUUID()
    return this.turnId
  }

  get currentTurnId(): string {
    return this.turnId
  }

  /** 规范化时间戳为 ISO 8601；非法则回落上一条 / 文件兜底时间 */
  private normTs(ts: string | null | undefined): string {
    if (ts != null && ts !== '') {
      const d = new Date(ts)
      if (!Number.isNaN(d.getTime())) {
        this.lastTimestamp = d.toISOString()
        return this.lastTimestamp
      }
    }
    return this.lastTimestamp ?? this.fallbackTimestamp
  }

  /** 追加一个事件；自动补齐 base 字段 */
  push(event: EventInput): void {
    const { timestamp, ...rest } = event
    const full = {
      ...rest,
      id: randomUUID(),
      sessionId: this.sessionId,
      turnId: this.turnId,
      seq: this.seq++,
      timestamp: this.normTs(timestamp),
    } as AgentEvent
    this.events.push(full)
  }
}

/** 工具来源推断：mcp__server__tool → mcp，否则 builtin */
export function inferToolSource(toolName: string): {
  source: 'builtin' | 'mcp'
  mcpServerId?: string
} {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    return { source: 'mcp', mcpServerId: parts[1] ?? 'unknown' }
  }
  return { source: 'builtin' }
}

/** 把任意工具结果内容压成字符串（用于 tool_result.output / 预览） */
export function stringifyContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        if (b != null && typeof b === 'object') {
          const obj = b as Record<string, unknown>
          if (typeof obj['text'] === 'string') return obj['text']
        }
        return ''
      })
      .filter((s) => s.length > 0)
      .join('\n')
  }
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>
    if (typeof obj['text'] === 'string') return obj['text']
  }
  return ''
}

/** 标题截断 */
export function deriveTitle(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (text.length === 0) return fallback
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
