/**
 * @module registerToolAuditIpc
 *
 * 工具执行审计查询 IPC（设计方案 §6 查询层）—— 检查器「工具执行」区块
 * 的五通道：list / detail / read-payload / stats / verify-chain。
 *
 * 设计约束：
 *   - 只读通道：直接读 ToolInvocationRepository（无写入路径，不属审计写入
 *     单入口约束的范围）；载荷读取走 agent-runtime 的内容寻址原语并重验
 *     sha256。
 *   - 归档载荷永不随 list 下发（摘要行）；detail 小载荷内联，大载荷按
 *     artifactId 分页读。
 *   - 会话工作区根解析：session → workspace_ids → 各 root_path，逐个尝试
 *     内容寻址定位（sha 命中即正确归档，多工作区安全）。
 */

import {
  ToolInvocationRepository,
  SessionRepository,
  WorkspaceRepository,
  type ToolInvocationRow,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { readAuditedPayloadChunk, readAuditedPayloadInline } from '@spark/agent-runtime'
import type {
  ToolAuditLedgerRow,
  ToolAuditPayloadView,
  ToolAuditStats,
  ToolAuditChainVerifyResult,
  ToolAuditStatus,
  ToolAuditSourceKind,
  ToolAuditInvocationSource,
  ToolAuditEngine,
} from '@spark/protocol'
import { typedIpcHandle } from './typed-ipc.js'
import { getDatabase } from '../db.js'
import { createLogger } from '@spark/shared'

const log = createLogger('ipc.tool-audit')

/** storage 行（snake_case）→ wire 行（camelCase）。穷尽映射，新列漏配即编译错。 */
function toWireRow(row: ToolInvocationRow): ToolAuditLedgerRow {
  return {
    id: row.id,
    ledgerSeq: row.ledger_seq,
    correlationId: row.correlation_id,
    chainSessionId: row.chain_session_id,
    prevHash: row.prev_hash,
    recordHash: row.record_hash,
    finishedRecordHash: row.finished_record_hash,
    sessionId: row.session_id,
    turnId: row.turn_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    workflowId: row.workflow_id,
    memberAgentId: row.member_agent_id,
    dispatchId: row.dispatch_id,
    hookId: row.hook_id,
    hookRunId: row.hook_run_id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    sourceKind: row.source_kind as ToolAuditSourceKind,
    invocationSource: row.invocation_source as ToolAuditInvocationSource,
    mcpServerId: row.mcp_server_id,
    engine: row.engine as ToolAuditEngine | null,
    sourceId: row.source_id,
    packageId: row.package_id,
    version: row.version,
    adapter: row.adapter,
    status: row.status as ToolAuditStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    inputSha256: row.input_sha256,
    inputBytes: row.input_bytes,
    inputArtifactId: row.input_artifact_id,
    outputBytes: row.output_bytes,
    outputSha256: row.output_sha256,
    outputArtifactId: row.output_artifact_id,
    resultTruncated: row.result_truncated === 1,
    resultArchived: row.result_archived === 1,
  }
}

export function registerToolAuditIpc(): void {
  const db: SparkDatabase = getDatabase()
  const repo = new ToolInvocationRepository(db)
  const sessionRepo = new SessionRepository(db)
  const workspaceRepo = new WorkspaceRepository(db)

  /** 会话的候选工作区根（归档定位逐个尝试；解析失败静默跳过）。 */
  const workspaceRootsOf = (sessionId: string | null): string[] => {
    if (sessionId == null) return []
    try {
      const session = sessionRepo.get(sessionId)
      if (session == null) return []
      return sessionRepo.getWorkspaceIds(sessionId).flatMap((workspaceId) => {
        const workspace = workspaceRepo.get(workspaceId)
        return workspace?.root_path != null && workspace.root_path !== ''
          ? [workspace.root_path]
          : []
      })
    } catch (error) {
      log.warn('tool-audit workspace roots resolve failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  typedIpcHandle('tool-audit:list', async (request) => {
    const result = repo.listLedger({
      sessionId: request.sessionId,
      ...(request.turnId != null ? { turnId: request.turnId } : {}),
      ...(request.toolName != null ? { toolName: request.toolName } : {}),
      ...(request.status != null ? { status: request.status } : {}),
      ...(request.sourceKind != null ? { sourceKind: request.sourceKind } : {}),
      ...(request.invocationSource != null ? { invocationSource: request.invocationSource } : {}),
      ...(request.memberAgentId != null ? { memberAgentId: request.memberAgentId } : {}),
      ...(request.cursor != null ? { cursor: request.cursor } : {}),
      ...(request.limit != null ? { limit: request.limit } : {}),
    })
    return {
      rows: result.items.map(toWireRow),
      ...(result.nextCursor != null ? { nextCursor: result.nextCursor } : {}),
      hasMore: result.nextCursor != null,
    }
  })

  typedIpcHandle('tool-audit:detail', async (request) => {
    const row = repo.get(request.id)
    if (row == null) throw new Error(`工具执行记录不存在：${request.id}`)
    const roots = workspaceRootsOf(row.session_id)
    const inputView = ((): ToolAuditPayloadView | undefined => {
      if (row.input_artifact_id != null) {
        const inline = readAuditedPayloadInline(row.input_artifact_id, roots)
        return {
          ...(inline != null ? { inline } : {}),
          artifactId: row.input_artifact_id,
          bytes: row.input_bytes,
          sha256: row.input_sha256,
        }
      }
      if (row.input_sha256 != null || row.input_bytes != null) {
        return { bytes: row.input_bytes, sha256: row.input_sha256 }
      }
      return undefined
    })()
    const outputView = ((): ToolAuditPayloadView | undefined => {
      if (row.output_artifact_id != null) {
        const inline = readAuditedPayloadInline(row.output_artifact_id, roots)
        return {
          ...(inline != null ? { inline } : {}),
          artifactId: row.output_artifact_id,
          bytes: row.output_bytes,
          sha256: row.output_sha256,
        }
      }
      if (row.output_sha256 != null || row.output_bytes != null) {
        return { bytes: row.output_bytes, sha256: row.output_sha256 }
      }
      return undefined
    })()
    return {
      row: toWireRow(row),
      ...(inputView != null ? { input: inputView } : {}),
      ...(outputView != null ? { output: outputView } : {}),
    }
  })

  typedIpcHandle('tool-audit:read-payload', async (request) => {
    // 载荷不记会话归属：全库候选工作区里内容寻址定位（sha 命中即正确）。
    // 常见路径是最近会话的工作区；为控制扫描面，这里取全部 workspace 根。
    const roots = allWorkspaceRoots(workspaceRepo)
    const result = readAuditedPayloadChunk({
      artifactId: request.artifactId,
      workspaceRoots: roots,
      ...(request.offset != null ? { offset: request.offset } : {}),
      ...(request.limit != null ? { limit: request.limit } : {}),
    })
    if (result == null) {
      throw new Error(`审计载荷不可读（未命中归档或校验失败）：${request.artifactId.slice(0, 12)}…`)
    }
    return {
      chunk: result.chunk,
      ...(result.nextOffset != null ? { nextOffset: result.nextOffset } : {}),
      truncated: result.truncated,
    }
  })

  typedIpcHandle('tool-audit:stats', async (request) => {
    const stats = repo.statsBySession(request.sessionId)
    const byStatus: Record<ToolAuditStatus, number> = {
      running: 0,
      ok: 0,
      error: 0,
      timeout: 0,
      denied: 0,
      cancelled: 0,
      stale: 0,
    }
    for (const [key, value] of Object.entries(stats.byStatus)) {
      byStatus[key as ToolAuditStatus] = value ?? 0
    }
    const bySource = {} as Record<ToolAuditSourceKind, number>
    for (const [key, value] of Object.entries(stats.bySourceKind)) {
      bySource[key as ToolAuditSourceKind] = value ?? 0
    }
    const wire: ToolAuditStats = {
      total: stats.total,
      byStatus,
      bySource,
      byTool: stats.byTool,
      p50Ms: stats.durationP50Ms,
      p95Ms: stats.durationP95Ms,
      totalBytes: stats.totalInputBytes + stats.totalOutputBytes,
      timeRange:
        stats.firstStartedAt != null && stats.lastFinishedAt != null
          ? { from: stats.firstStartedAt, to: stats.lastFinishedAt }
          : null,
    }
    return wire
  })

  typedIpcHandle('tool-audit:verify-chain', async (request) => {
    const result = repo.verifyChain(request.sessionId)
    const wire: ToolAuditChainVerifyResult = {
      chainSessionId: result.chainSessionId,
      ok: result.valid,
      checkedCount: result.checkedCount,
      ...(result.break != null
        ? {
            breakAt: {
              ledgerSeq: result.break.ledgerSeq,
              reason: result.break.reason,
              ...(result.break.expectedRecordHash != null
                ? { expectedHash: result.break.expectedRecordHash }
                : {}),
              ...(result.break.actualRecordHash != null
                ? { actualHash: result.break.actualRecordHash }
                : {}),
            },
          }
        : {}),
    }
    return wire
  })
}

/** 全部 workspace 根（read-payload 无会话上下文时的内容寻址候选面）。 */
function allWorkspaceRoots(workspaceRepo: WorkspaceRepository): string[] {
  try {
    return workspaceRepo
      .listAll(500, 0)
      .flatMap((workspace) =>
        workspace.root_path != null && workspace.root_path !== '' ? [workspace.root_path] : [],
      )
  } catch {
    return []
  }
}
