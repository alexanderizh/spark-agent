/**
 * @module registerWorkflowRunIpc
 *
 * 工作流「历史运行回看」IPC（workflow:runs / workflow:run-detail）。
 *
 * 数据全部来自 workflow_runs 表的持久化快照（执行器 onSnapshot 时写入）：
 * - 列表：listByWorkflow 轻量查询，只解析三个小 JSON 数组做计数。
 * - 详情：按 runId 取整行，graph_json 为运行时刻的图快照（之后的图编辑不影响历史），
 *   经 normalizeWorkflowGraph 还原节点元数据，再复用 buildWorkflowProgressNodes 组装——
 *   与实时 workflow_progress 事件走同一纯函数，历史明细与实时进度渲染天然一致。
 */

import {
  buildWorkflowProgressNodes,
  normalizeWorkflowGraph,
  type WorkflowAgentExecutionRecord,
  type WorkflowAtomicNodeExecutionRecord,
  type WorkflowProgressNodeMetaInput,
} from '@spark/agent-runtime'
import type {
  WorkflowRunDetail,
  WorkflowRunDetailRequest,
  WorkflowRunDetailResponse,
  WorkflowRunsRequest,
  WorkflowRunsResponse,
  WorkflowRunSummaryItem,
} from '@spark/protocol'
import { WorkflowRunRepository } from '@spark/storage'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'

/** 防御性 JSON 解析：行内 JSON 损坏时回落空值，不让单条脏数据打挂整个回看。 */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (raw == null || raw.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (raw == null || raw.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

function parseStringIds(raw: string | null | undefined): Set<string> {
  return new Set(parseJsonArray<unknown>(raw).filter((id): id is string => typeof id === 'string'))
}

interface FailedNodeJson {
  nodeId?: unknown
  error?: { code?: unknown; message?: unknown }
}

function toSummaryItem(row: {
  id: string
  session_id: string
  status: WorkflowRunSummaryItem['status']
  objective: string
  started_at: string
  updated_at: string
  ended_at: string | null
  completed_node_ids_json: string
  skipped_node_ids_json: string
  failed_node_json: string | null
}): WorkflowRunSummaryItem {
  const failed = parseJsonObject<FailedNodeJson>(row.failed_node_json)
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    objective: row.objective,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    updatedAt: row.updated_at,
    completedCount: parseStringIds(row.completed_node_ids_json).size,
    skippedCount: parseStringIds(row.skipped_node_ids_json).size,
    failedNodeId: failed != null && typeof failed.nodeId === 'string' ? failed.nodeId : null,
  }
}

export function registerWorkflowRunIpc(options?: { repository?: WorkflowRunRepository }): void {
  const repository = options?.repository ?? new WorkflowRunRepository(getDatabase())

  typedIpcHandle(
    'workflow:runs',
    async (request: WorkflowRunsRequest): Promise<WorkflowRunsResponse> => {
      const limit = Math.min(Math.max(request.limit ?? 30, 1), 100)
      const rows = repository.listByWorkflow(request.workflowId, limit)
      return { runs: rows.map(toSummaryItem) }
    },
  )

  typedIpcHandle(
    'workflow:run-detail',
    async (request: WorkflowRunDetailRequest): Promise<WorkflowRunDetailResponse> => {
      const row = repository.get(request.runId)
      if (row == null) return { run: null }

      // graph_json 是运行时刻的图快照；损坏时回落空图，仍尽力从执行记录合成节点明细。
      const graph = parseJsonObject<Record<string, unknown>>(row.graph_json) ?? {}
      const normalized = normalizeWorkflowGraph(graph)
      const metas: WorkflowProgressNodeMetaInput[] = normalized.nodes.map((node) => {
        const agentId = node.config['agentId']
        return {
          nodeId: node.id,
          title: node.title,
          kind: node.kind,
          ...(typeof agentId === 'string' && agentId.length > 0 ? { agentId } : {}),
        }
      })

      const executions = parseJsonArray<WorkflowAgentExecutionRecord>(row.executions_json)
      const atomicExecutions = parseJsonArray<WorkflowAtomicNodeExecutionRecord>(
        row.atomic_executions_json,
      )

      // 图里已删/损坏缺失的节点，从执行记录补合成元数据，保证历史不因图缺节点而丢明细。
      const knownIds = new Set(metas.map((meta) => meta.nodeId))
      for (const record of [...executions, ...atomicExecutions]) {
        if (record == null || typeof record !== 'object') continue
        const nodeId = (record as { nodeId?: unknown }).nodeId
        if (typeof nodeId === 'string' && nodeId.length > 0 && !knownIds.has(nodeId)) {
          knownIds.add(nodeId)
          metas.push({ nodeId, title: nodeId, kind: 'agent' })
        }
      }

      const failed = parseJsonObject<FailedNodeJson>(row.failed_node_json)
      const failedNodeId =
        failed != null && typeof failed.nodeId === 'string' ? failed.nodeId : undefined
      const failedError =
        failed?.error != null && typeof failed.error.message === 'string'
          ? {
              ...(typeof failed.error.code === 'string' ? { code: failed.error.code } : {}),
              message: failed.error.message,
            }
          : undefined

      const nodes = buildWorkflowProgressNodes({
        metas,
        executions,
        atomicExecutions,
        // 历史运行没有运行中节点；遗留 working 行（异常退出未清理）按无 running 渲染。
        runningNodeIds: new Set<string>(),
        completedNodeIds: parseStringIds(row.completed_node_ids_json),
        skippedNodeIds: parseStringIds(row.skipped_node_ids_json),
        ...(failedNodeId != null ? { failedNodeId } : {}),
        ...(failedNodeId != null && failedError != null ? { failedNodeError: failedError } : {}),
        terminal: row.status !== 'working',
      })

      const run: WorkflowRunDetail = {
        id: row.id,
        sessionId: row.session_id,
        workflowId: row.workflow_id,
        status: row.status,
        objective: row.objective,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        nodes,
      }
      return { run }
    },
  )
}
