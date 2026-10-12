/**
 * 工具执行审计 IPC 契约（设计方案 §6 查询层）。
 *
 * 检查器「工具执行」区块的五通道：游标分页 list、按需 detail（载荷不随
 * list 下发）、归档载荷分页 read-payload（读取时重验 sha256）、统计 stats、
 * 哈希链校验 verify-chain。wire 类型为 camelCase（storage 行为 snake_case，
 * main 侧映射）。
 */
import { z } from 'zod'

export type ToolAuditSourceKind =
  | 'sdk-builtin'
  | 'mcp'
  | 'custom-tool'
  | 'tool-package'
  | 'connector'
  | 'workflow'
  | 'hook'
  | 'test'

export type ToolAuditInvocationSource =
  | 'model'
  | 'workflow'
  | 'test'
  | 'platform'
  | 'nested'
  | 'hook'

export type ToolAuditStatus =
  | 'running'
  | 'ok'
  | 'error'
  | 'timeout'
  | 'denied'
  | 'cancelled'
  | 'stale'

export type ToolAuditEngine = 'claude' | 'codex' | 'spark'

/** 账本摘要行（无载荷；时间线与导出用）。 */
export interface ToolAuditLedgerRow {
  id: string
  ledgerSeq: number
  correlationId: string | null
  chainSessionId: string
  prevHash: string | null
  recordHash: string | null
  finishedRecordHash: string | null
  sessionId: string | null
  turnId: string | null
  projectId: string | null
  agentId: string | null
  workflowId: string | null
  memberAgentId: string | null
  dispatchId: string | null
  hookId: string | null
  hookRunId: string | null
  toolId: string | null
  toolName: string
  sourceKind: ToolAuditSourceKind
  invocationSource: ToolAuditInvocationSource
  mcpServerId: string | null
  engine: ToolAuditEngine | null
  sourceId: string
  packageId: string | null
  version: string | null
  adapter: string | null
  status: ToolAuditStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  errorCode: string | null
  errorMessage: string | null
  retryCount: number
  inputSha256: string | null
  inputBytes: number | null
  inputArtifactId: string | null
  outputBytes: number | null
  outputSha256: string | null
  outputArtifactId: string | null
  resultTruncated: boolean
  resultArchived: boolean
}

/** 载荷视图：内联（小载荷直出）或归档（artifactId + 按需分页读）。 */
export interface ToolAuditPayloadView {
  /** 脱敏后内联载荷（≤ 内联阈值时直出；JSON 值或字符串）。 */
  inline?: unknown
  artifactId?: string
  bytes: number | null
  sha256: string | null
}

export interface ToolAuditStats {
  total: number
  byStatus: Record<ToolAuditStatus, number>
  bySource: Record<ToolAuditSourceKind, number>
  byTool: Array<{ toolName: string; count: number }>
  p50Ms: number | null
  p95Ms: number | null
  totalBytes: number
  timeRange: { from: string; to: string } | null
}

export interface ToolAuditChainVerifyResult {
  chainSessionId: string
  ok: boolean
  checkedCount: number
  breakAt?: {
    ledgerSeq: number
    reason:
      | 'seq-order'
      | 'prev-mismatch'
      | 'hash-mismatch'
      | 'finish-hash-mismatch'
      | 'missing-finish-hash'
    expectedHash?: string
    actualHash?: string
  }
}

export interface ToolAuditIpcChannelMap {
  'tool-audit:list': [
    {
      sessionId: string
      turnId?: string
      /** 工具名搜索词（包含匹配，LIKE 转义由仓储层处理）。 */
      toolName?: string
      status?: ToolAuditStatus
      sourceKind?: ToolAuditSourceKind
      invocationSource?: ToolAuditInvocationSource
      memberAgentId?: string
      /** ledger_seq 游标（上一页最后一行的 seq，严格小于该值继续）：向下（旧）翻页；缺省从最新开始。 */
      cursor?: number
      /** ≤200。 */
      limit?: number
    },
    { rows: ToolAuditLedgerRow[]; nextCursor?: number; hasMore: boolean },
  ]
  'tool-audit:detail': [
    { id: string },
    { row: ToolAuditLedgerRow; input?: ToolAuditPayloadView; output?: ToolAuditPayloadView },
  ]
  'tool-audit:read-payload': [
    { artifactId: string; offset?: number; limit?: number },
    { chunk: string; nextOffset?: number; truncated: boolean },
  ]
  'tool-audit:stats': [{ sessionId: string }, ToolAuditStats]
  'tool-audit:verify-chain': [{ sessionId: string }, ToolAuditChainVerifyResult]
}

const ToolAuditSourceKindSchema = z.enum([
  'sdk-builtin',
  'mcp',
  'custom-tool',
  'tool-package',
  'connector',
  'workflow',
  'hook',
  'test',
])
const ToolAuditInvocationSourceSchema = z.enum([
  'model',
  'workflow',
  'test',
  'platform',
  'nested',
  'hook',
])
const ToolAuditStatusSchema = z.enum([
  'running',
  'ok',
  'error',
  'timeout',
  'denied',
  'cancelled',
  'stale',
])

export const ToolAuditIpcSchemaRegistry = {
  'tool-audit:list': z
    .object({
      sessionId: z.string().min(1).max(128),
      turnId: z.string().min(1).max(128).optional(),
      toolName: z.string().min(1).max(300).optional(),
      status: ToolAuditStatusSchema.optional(),
      sourceKind: ToolAuditSourceKindSchema.optional(),
      invocationSource: ToolAuditInvocationSourceSchema.optional(),
      memberAgentId: z.string().min(1).max(128).optional(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  'tool-audit:detail': z.object({ id: z.string().uuid() }).strict(),
  'tool-audit:read-payload': z
    .object({
      artifactId: z.string().regex(/^[0-9a-f]{64}$/, 'artifactId must be sha256 hex'),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(40_000).optional(),
    })
    .strict(),
  'tool-audit:stats': z.object({ sessionId: z.string().min(1).max(128) }).strict(),
  'tool-audit:verify-chain': z.object({ sessionId: z.string().min(1).max(128) }).strict(),
} as const
