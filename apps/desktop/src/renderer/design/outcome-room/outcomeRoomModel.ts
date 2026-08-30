import type {
  OutcomeRoomMutationAction,
  OutcomeRoomRecord,
  OutcomeRoomSnapshot,
} from '@spark/protocol'
import { boundedLedgerJson } from '@spark/protocol'

export interface OutcomeRoomSummary {
  activeCount: number
  proposalCount: number
  attentionCount: number
  health: 'on-track' | 'at-risk' | 'blocked'
  healthLabel: '进展正常' | '需要关注' | '存在阻塞'
}

export function getLedgerActions(record: OutcomeRoomRecord): OutcomeRoomMutationAction[] {
  switch (record.status) {
    case 'proposed':
      return ['confirm', 'reject', 'correct', 'invalidate']
    case 'active':
      return ['correct', 'invalidate']
    case 'rejected':
    case 'invalid':
    case 'expired':
    case 'deleted':
      return ['restore']
  }
}

export function summarizeOutcomeRoom(records: OutcomeRoomRecord[]): OutcomeRoomSummary {
  const activeCount = records.filter((record) => record.status === 'active').length
  const proposalCount = records.filter((record) => record.status === 'proposed').length
  const terminalCount = records.filter((record) =>
    ['rejected', 'invalid', 'expired', 'deleted'].includes(record.status),
  ).length
  const attentionCount = proposalCount + terminalCount
  const blocked = records.some(
    (record) =>
      record.logicalKey.toLowerCase().includes('block') &&
      (record.status === 'active' || record.status === 'proposed'),
  )
  return {
    activeCount,
    proposalCount,
    attentionCount,
    health: blocked ? 'blocked' : attentionCount > 0 ? 'at-risk' : 'on-track',
    healthLabel: blocked ? '存在阻塞' : attentionCount > 0 ? '需要关注' : '进展正常',
  }
}

export function outcomeTitle(snapshot: OutcomeRoomSnapshot): string {
  const topic = snapshot.discussion?.topic?.trim()
  if (topic) return topic
  const goal = snapshot.records.find((record) => record.logicalKey.startsWith('goal.'))
  return typeof goal?.value === 'string' && goal.value.trim() ? goal.value : '团队成果作业间'
}

export function displayLedgerValue(value: unknown): string {
  if (typeof value === 'string') return value.length <= 1_200 ? value : `${value.slice(0, 1_180)}\n[ledger truncated]`
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return boundedLedgerJson(value, 1_200)
}
