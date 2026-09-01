/**
 * workspace-search — 代码侧栏「工作区搜索」IPC 协议。
 *
 * 两种搜索模式：
 *   1. 文件搜索（workspace-search:files）：全工作区文件名模糊匹配，
 *      覆盖未加载进文件树的文件；主进程维护文件清单缓存，纯内存打分。
 *   2. 内容搜索（workspace-search:content）：工作区代码内容文本搜索，
 *      结果通过 stream:workspace-search:content 分批流式推送，
 *      支持 requestId 取消、总量上限与截断标记。
 *
 * 性能约束（主进程 WorkspaceSearchService 实现，渲染端依赖这些语义）：
 *   - 文件清单缓存（TTL + LRU），文件搜索不产生磁盘 IO；
 *   - 内容搜索并发受限、单/总匹配上限、大文件与二进制跳过；
 *   - 新搜索发起前先 workspace-search:cancel 旧 requestId。
 */

import { z } from 'zod'

/* ============================================================
   文件搜索（quick open）
   ============================================================ */

export interface WorkspaceSearchFileHit {
  /** 相对 workspace 根的 posix 路径 */
  path: string
  /** 模糊匹配得分（越高越靠前；仅供调试，渲染端不需使用） */
  score: number
}

export const WorkspaceSearchFilesRequestSchema = z.object({
  workspaceId: z.string().min(1),
  /** Resolve a no-project workspace to this session's isolated child directory. */
  sessionId: z.string().uuid().optional(),
  query: z.string().max(300),
  /** 返回条数上限，默认 100，硬上限 500 */
  limit: z.number().int().min(1).max(500).optional(),
  /** true 时强制重建文件清单缓存（文件树与磁盘不一致时手动刷新用） */
  refresh: z.boolean().optional(),
})

export interface WorkspaceSearchFilesRequest extends z.infer<
  typeof WorkspaceSearchFilesRequestSchema
> {}

export interface WorkspaceSearchFilesResponse {
  hits: WorkspaceSearchFileHit[]
  /** 本次文件清单覆盖的文件总数（空查询时也返回，供 UI 提示索引规模） */
  totalFiles: number
  /** 文件清单是否命中缓存（false = 本次重新遍历了磁盘） */
  fromCache: boolean
  /** 是否因 limit 截断 */
  truncated: boolean
}

/* ============================================================
   内容搜索（跨文件代码搜索）
   ============================================================ */

export interface WorkspaceSearchContentMatch {
  /** 相对 workspace 根的 posix 路径 */
  path: string
  /** 1 起始行号 */
  line: number
  /** 行文本（已截断到安全长度） */
  text: string
  /** 匹配在 text 中的 0 起始字符列 */
  column: number
  /** 匹配长度（字符数） */
  length: number
}

export interface WorkspaceSearchContentStats {
  filesScanned: number
  filesSearched: number
  matches: number
  elapsedMs: number
}

export const WorkspaceSearchContentRequestSchema = z.object({
  workspaceId: z.string().min(1),
  /** Resolve a no-project workspace to this session's isolated child directory. */
  sessionId: z.string().uuid().optional(),
  /** 渲染端预先生成，确保首个流事件到达前即可建立过滤令牌。 */
  requestId: z.string().uuid(),
  query: z.string().min(1).max(500),
  caseSensitive: z.boolean().optional(),
  /** 总匹配数上限，默认 2000，硬上限 5000 */
  maxResults: z.number().int().min(10).max(5000).optional(),
})

export interface WorkspaceSearchContentRequest extends z.infer<
  typeof WorkspaceSearchContentRequestSchema
> {}

export interface WorkspaceSearchContentResponse {
  /** 与请求一致；用于确认主进程已接受本次搜索。 */
  requestId: string
}

/* ============================================================
   取消
   ============================================================ */

export const WorkspaceSearchCancelRequestSchema = z.object({
  /** 要取消的 requestId；缺省 = 取消该服务当前所有进行中的内容搜索 */
  requestId: z.string().uuid().optional(),
})

export interface WorkspaceSearchCancelRequest extends z.infer<
  typeof WorkspaceSearchCancelRequestSchema
> {}

export interface WorkspaceSearchCancelResponse {
  cancelled: boolean
}

/* ============================================================
   流式推送 payload
   ============================================================ */

export interface WorkspaceSearchContentStreamPayload {
  requestId: string
  /** 本批新增匹配（done 时可能为空数组） */
  batch: WorkspaceSearchContentMatch[]
  /** true = 搜索已结束（正常完成 / 截断 / 出错 / 被取消） */
  done: boolean
  /** true = 因总匹配上限提前终止 */
  truncated: boolean
  /** true = 被新请求或显式 cancel 取消 */
  cancelled: boolean
  /** done 时携带的统计 */
  stats?: WorkspaceSearchContentStats
  /** done 时可能携带的错误信息 */
  error?: string
}

/* ============================================================
   Channel map + schema registry
   ============================================================ */

export interface WorkspaceSearchIpcChannelMap {
  'workspace-search:files': [WorkspaceSearchFilesRequest, WorkspaceSearchFilesResponse]
  'workspace-search:content': [WorkspaceSearchContentRequest, WorkspaceSearchContentResponse]
  'workspace-search:cancel': [WorkspaceSearchCancelRequest, WorkspaceSearchCancelResponse]
}

export const WorkspaceSearchIpcSchemaRegistry = {
  'workspace-search:files': WorkspaceSearchFilesRequestSchema,
  'workspace-search:content': WorkspaceSearchContentRequestSchema,
  'workspace-search:cancel': WorkspaceSearchCancelRequestSchema,
} as const
