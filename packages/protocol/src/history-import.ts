/**
 * @module history-import
 *
 * 宿主机对话历史导入协议定义
 *
 * 支持检测并导入宿主机上已有的 Agent CLI 对话历史：
 *   - Claude Code：~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *   - Codex：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * 流程：
 *   1. scan   —— 轻量扫描两个来源，返回可导入条目列表（只读文件头/尾 + stat，不全量解析）
 *   2. preview —— 解析单个文件返回前若干轮对话，供右侧预览
 *   3. import —— 全量解析所选条目，映射为 AgentEvent 写入 agent_events 表
 *
 * 导入后的会话写入标准 agent_events，因此运行时在 sendTurn 时会从事件重建对话历史，
 * 天然支持「继续对话」。来源与去重信息记录在 sessions.metadata_json.importedFrom。
 */

/** 对话历史来源 */
export type HistoryImportSource = 'claude-code' | 'codex'

/** 写入 sessions.metadata_json 的导入溯源信息（也用于去重） */
export interface HistoryImportMetadata {
  /** 来源 CLI */
  importedFrom: HistoryImportSource
  /** 来源会话 ID（Claude Code 的 sessionId / Codex 的 rollout id），用于去重 */
  sourceSessionId: string
  /** 来源文件绝对路径 */
  sourceFile: string
  /** 导入时间（ISO 8601） */
  importedAt: string
}

/** 扫描得到的单个可导入条目（轻量元数据） */
export interface HistoryImportItem {
  source: HistoryImportSource
  /** 来源会话 ID */
  sourceSessionId: string
  /** 推断出的标题 */
  title: string
  /** 对话记录的工作目录（原始字符串，可能是另一台机器 / WSL 路径） */
  cwd: string | null
  /** cwd 的末段（项目名），用于分组展示 */
  project: string
  /** 估算的对话消息数（user + assistant） */
  messageCount: number
  /** 首条事件时间（ISO 8601，可能为 null） */
  firstTimestamp: string | null
  /** 末条事件时间（ISO 8601，可能为 null） */
  lastTimestamp: string | null
  /** 文件大小（字节） */
  sizeBytes: number
  /** 来源文件绝对路径 */
  filePath: string
  /** 是否已导入过（按 sourceSessionId 去重） */
  alreadyImported: boolean
}

/** scan 请求：可限定来源；不传则两个来源都扫 */
export interface HistoryImportScanRequest {
  sources?: HistoryImportSource[]
}

/** scan 响应 */
export interface HistoryImportScanResponse {
  items: HistoryImportItem[]
  scannedAt: string
  /** 各来源是否可用 + 扫描错误（如目录不存在） */
  sources: Array<{
    source: HistoryImportSource
    available: boolean
    count: number
    rootPath: string
    error?: string
  }>
}

/** preview 请求 */
export interface HistoryImportPreviewRequest {
  source: HistoryImportSource
  filePath: string
  /** 最多返回多少条消息，默认 20 */
  limit?: number
}

/** preview 中的一条消息（已扁平化，仅用于展示） */
export interface HistoryImportPreviewMessage {
  role: 'user' | 'assistant' | 'thinking' | 'tool'
  text: string
  timestamp: string | null
}

/** preview 响应 */
export interface HistoryImportPreviewResponse {
  messages: HistoryImportPreviewMessage[]
  /** 是否还有更多（被 limit 截断） */
  truncated: boolean
}

/** 用户勾选的待导入条目 */
export interface HistoryImportSelection {
  source: HistoryImportSource
  filePath: string
  sourceSessionId: string
  cwd: string | null
  title: string
}

/** import 请求 */
export interface HistoryImportRequest {
  selections: HistoryImportSelection[]
}

/** 单个条目的导入结果 */
export interface HistoryImportResultEntry {
  sourceSessionId: string
  /** 新建的 spark 会话 ID（成功时） */
  sessionId?: string
  status: 'imported' | 'skipped' | 'failed'
  /** 失败原因（status=failed 时） */
  error?: string
}

/** import 响应（汇总） */
export interface HistoryImportResponse {
  imported: number
  skipped: number
  failed: number
  results: HistoryImportResultEntry[]
}

/** import 进度（stream:history-import:progress 推送） */
export interface HistoryImportProgress {
  phase: 'parsing' | 'writing' | 'done'
  /** 已处理条目数 */
  current: number
  /** 总条目数 */
  total: number
  /** 当前处理条目标题 */
  currentTitle?: string
  sourceSessionId?: string
}
