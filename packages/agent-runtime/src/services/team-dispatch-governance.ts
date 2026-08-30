import { EvidenceCostService, SteeringGateService } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { TeamA2ATask } from '@spark/protocol'
import type { TeamDispatchUsage } from './team-dispatch.service.js'

export interface TeamDispatchGovernanceContext {
  sessionId: string
  discussionId?: string
  actorId: string
}

export interface TeamDispatchGovernanceHooks {
  beforeExecuteMember?: (args: {
    task: TeamA2ATask
    member: { id: string; name: string }
    dispatchId: string
  }) => void
  onDispatchUsage?: (usage: TeamDispatchUsage) => void
}

/** Build discussion-scoped execution hooks without growing SessionService's orchestration code. */
export function createTeamDispatchGovernanceHooks(
  db: SparkDatabase,
  context: TeamDispatchGovernanceContext,
): TeamDispatchGovernanceHooks {
  if (context.discussionId == null) return {}

  const scope = {
    sessionId: context.sessionId,
    roomId: `team-room:${context.sessionId}`,
    discussionId: context.discussionId,
    actorId: context.actorId,
  }
  const steeringGate = SteeringGateService.forSystem(db, scope)

  return {
    beforeExecuteMember: ({ task }) => {
      steeringGate.assertTargetRunnable('task', task.taskId)
    },
    onDispatchUsage: (usage) => {
      EvidenceCostService.forSystem(db, scope).recordUsage({
        id: `dispatch:${usage.dispatchId}`,
        taskId: usage.taskId,
        agentId: usage.agentId,
        dispatchId: usage.dispatchId,
        tokens: usage.tokens,
        latencyMs: usage.latencyMs,
        status: usage.status,
        source: 'team-dispatch',
        opId: `team-dispatch:${usage.dispatchId}`,
      })
    },
  }
}
