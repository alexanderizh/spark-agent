/**
 * @module session-history-retrieval-tools
 *
 * 会话全量历史检索的 Agent 工具门面（session_history_* MCP 工具的 bridge 侧实现）。
 *
 * 上下文压缩（compact/summarize）后的摘要会丢信息；agent_events 表是 append-only
 * 全量存档，压缩从不删除原始事件。这组工具让 agent 按需检索自己会话的完整历史
 * （含工具调用输入输出），是压缩之外的增量逃生门，不改变压缩本身。
 *
 * 会话绑定与 SessionScheduleAgentTools 一致：sessionId 由运行时 env 注入子进程后
 * 经 bridge 回传，绝不信任模型输入的其他会话 id；所有查询都强制限定在当前会话。
 */

import type {
  SessionHistoryListResponse,
  SessionHistoryReadResponse,
  SessionHistorySearchResponse,
} from '@spark/protocol'
import type { SessionHistoryRepository } from '@spark/storage'

/** Controller facade over the append-only agent_events archive for the current session. */
export class SessionHistoryRetrievalTools {
  constructor(private readonly repo: SessionHistoryRepository) {}

  list(
    sessionId: string,
    params: { cursor?: number; limit?: number; order?: 'asc' | 'desc' },
  ): SessionHistoryListResponse {
    const currentSessionId = requireCurrentSessionId(sessionId)
    return this.repo.listTurnTimeline({
      sessionId: currentSessionId,
      ...optionalNumber(params.cursor, 'cursor'),
      ...optionalNumber(params.limit, 'limit'),
      ...(params.order === 'desc' ? { order: 'desc' as const } : {}),
    })
  }

  read(
    sessionId: string,
    params:
      | { mode: 'turns'; cursor?: number; turnLimit?: number; order?: 'asc' | 'desc' }
      | { mode: 'event'; turnId: string; seq: number },
  ): SessionHistoryReadResponse {
    const currentSessionId = requireCurrentSessionId(sessionId)
    if (params.mode === 'event') {
      const turnId = typeof params.turnId === 'string' ? params.turnId.trim() : ''
      if (!turnId) throw new Error('Missing parameter: turnId')
      if (typeof params.seq !== 'number' || !Number.isInteger(params.seq) || params.seq < 0) {
        throw new Error('Invalid parameter: seq must be a non-negative integer')
      }
      const event = this.repo.readEvent({
        sessionId: currentSessionId,
        turnId,
        seq: params.seq,
      })
      if (event == null) throw new Error('未找到指定事件（可能不在检索范围内或已超出本会话）')
      return { mode: 'event', event }
    }
    return {
      mode: 'turns',
      ...this.repo.readTurns({
        sessionId: currentSessionId,
        ...optionalNumber(params.cursor, 'cursor'),
        ...optionalNumber(params.turnLimit, 'turnLimit'),
        ...(params.order === 'desc' ? { order: 'desc' as const } : {}),
      }),
    }
  }

  search(
    sessionId: string,
    params: { query: string; eventTypes?: string[]; limit?: number },
  ): SessionHistorySearchResponse {
    const currentSessionId = requireCurrentSessionId(sessionId)
    const query = typeof params.query === 'string' ? params.query.trim() : ''
    if (!query) throw new Error('Missing parameter: query')
    return this.repo.searchEvents({
      sessionId: currentSessionId,
      query,
      ...(Array.isArray(params.eventTypes)
        ? { eventTypes: params.eventTypes.filter((type): type is string => typeof type === 'string') }
        : {}),
      ...optionalNumber(params.limit, 'limit'),
    })
  }
}

function optionalNumber<K extends string>(
  value: number | undefined,
  key: K,
): Partial<Record<K, number>> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {}
  return { [key]: value } as Partial<Record<K, number>>
}

function requireCurrentSessionId(sessionId: string): string {
  const value = sessionId.trim()
  if (!value) throw new Error('Current session id is unavailable')
  return value
}
