/**
 * @module session-history-retrieval
 *
 * 会话全量历史检索（session_history_* agent 工具）的协议类型。
 *
 * 背景：引擎侧上下文压缩（compact/summarize）后的摘要会丢信息，而 agent_events
 * 表是 append-only 全量存档。这组工具让 agent 按需检索自己当前会话的全量历史
 * （含工具调用输入输出），作为压缩之外的增量逃生门，不改变压缩本身的行为。
 *
 * 会话边界：工具只作用于当前会话，sessionId 由运行时注入，模型无法指定其他会话。
 */

// ─── 轮次时间线（session_history_list）───────────────────────────────────────

/** 单个轮次的时间线概览（目录条目，非正文） */
export interface SessionHistoryTurnOverview {
  turnId: string
  firstSeq: number
  lastSeq: number
  /** 用户消息开头（截断预览，仅用于辨认轮次） */
  userMessageHead: string
  /** 轮内完整消息数（用户 + 助手 + 团队成员） */
  messageCount: number
  /** 轮内工具调用数 */
  toolCallCount: number
  /** 轮内出现过的工具名（去重，截断） */
  toolNames: string[]
  /** 轮内是否发生上下文压缩/摘要 */
  hasCompaction: boolean
  /** 轮内最后一个事件的落库时间（ISO 时间戳） */
  lastEventAt: string
}

export interface SessionHistoryListRequest {
  /** 游标（seq）。asc：取 firstSeq > cursor 的轮次；desc：取 firstSeq < cursor 的轮次。缺省从头开始。 */
  cursor?: number
  /** 每页轮次数（1～50，默认 20） */
  limit?: number
  /** 翻页方向，默认 asc（时间正序） */
  order?: 'asc' | 'desc'
}

export interface SessionHistoryListResponse {
  turns: SessionHistoryTurnOverview[]
  nextCursor: number | null
  hasMore: boolean
}

// ─── 全量保真读取（session_history_read）────────────────────────────────────

/** 历史事件条目：消息正文或工具调用的文本化输入输出 */
export interface SessionHistoryEventItem {
  seq: number
  eventType: string
  /** 内容角色：消息角色 / 工具调用 / 系统性事件（压缩、轮次终态） */
  role: 'user' | 'assistant' | 'team_member' | 'tool' | 'system'
  toolName?: string
  toolCallId?: string
  /** tool_result 的执行状态 */
  status?: string
  /** 文本化内容：消息正文 / 工具入参 JSON / 工具输出 JSON（超长结果为 envelope，含 artifactId） */
  content: string
  /** content 是否被字符预算截断；true 时可用 mode:'event' 定点读全文 */
  truncated: boolean
}

/** 单个轮次的全量保真内容 */
export interface SessionHistoryTurnDetail {
  turnId: string
  firstSeq: number
  lastSeq: number
  /** 事件按 seq 升序；字符预算触底时可能在轮中截断，nextCursor 指向下一个未读事件 */
  events: SessionHistoryEventItem[]
  /** 本轮 events 是否因页预算被截断（未包含轮内全部事件） */
  partial: boolean
}

export type SessionHistoryReadRequest =
  | {
      /** 按轮分页读取 */
      mode: 'turns'
      /** 游标（seq）：asc 取 seq > cursor；desc 取 seq < cursor。缺省从头开始。 */
      cursor?: number
      /** 每页最大轮数（1～8，默认 4） */
      turnLimit?: number
      /** 翻页方向，默认 asc（时间正序） */
      order?: 'asc' | 'desc'
    }
  | {
      /** 定点读取单个事件全文（单事件上限 32k，无页预算） */
      mode: 'event'
      turnId: string
      seq: number
    }

export interface SessionHistoryReadTurnsResponse {
  mode: 'turns'
  turns: SessionHistoryTurnDetail[]
  nextCursor: number | null
  hasMore: boolean
}

export interface SessionHistoryReadEventResponse {
  mode: 'event'
  event: SessionHistoryEventItem & { turnId: string }
}

export type SessionHistoryReadResponse =
  | SessionHistoryReadTurnsResponse
  | SessionHistoryReadEventResponse

// ─── 关键词检索（session_history_search）─────────────────────────────────────

export interface SessionHistorySearchHit {
  turnId: string
  seq: number
  eventType: string
  role: SessionHistoryEventItem['role']
  toolName?: string
  /** 命中上下文片段 */
  snippet: string
}

export interface SessionHistorySearchRequest {
  /** 关键词（1～200 字符，子串匹配） */
  query: string
  /** 限定事件类型；缺省检索全部纳入范围的事件类型 */
  eventTypes?: string[]
  /** 命中数上限（1～50，默认 20） */
  limit?: number
}

export interface SessionHistorySearchResponse {
  hits: SessionHistorySearchHit[]
}
