import {
  DeliberationService,
  EvidenceCostService,
  ReplayPlaybookService,
  SteeringGateService,
  TaskGraphService,
  TeamHandoffService,
  type SparkDatabase,
} from '@spark/storage'
import type { TeamToolDefinition } from './team-mcp-http-bridge.js'
import {
  TeamDeliberationRuntimeAdapter,
  type TeamDeliberationRuntimeContext,
} from './team-deliberation-runtime-adapter.js'
import { TeamEvidenceCostRuntimeAdapter } from './team-evidence-cost-runtime-adapter.js'
import { TeamP1RuntimeAdapter } from './team-p1-runtime-adapter.js'
import { TeamReplayPlaybookRuntimeAdapter } from './team-replay-playbook-runtime-adapter.js'
import { TeamTaskGraphRuntimeAdapter } from './team-task-graph-runtime-adapter.js'

export interface TeamRuntimeAdapterContext {
  sessionId: string
  discussionId: string
  actorId: string
  capability: 'agent' | 'system'
}

export interface TeamRuntimeAdapters {
  taskGraph: TeamTaskGraphRuntimeAdapter
  deliberation: TeamDeliberationRuntimeAdapter
  evidenceCost: TeamEvidenceCostRuntimeAdapter
  replayPlaybook: TeamReplayPlaybookRuntimeAdapter
  p1: TeamP1RuntimeAdapter
}

/** Create the discussion-scoped runtime adapters from one trusted context. */
export function createTeamRuntimeAdapters(
  db: SparkDatabase,
  context: TeamRuntimeAdapterContext,
  ledgerWriter?: TeamDeliberationRuntimeContext['ledgerWriter'],
): TeamRuntimeAdapters {
  const adapterContext = {
    sessionId: context.sessionId,
    discussionId: context.discussionId,
    actorId: context.actorId,
    capability: context.capability,
  } as const
  return {
    taskGraph: new TeamTaskGraphRuntimeAdapter(db, adapterContext),
    deliberation: new TeamDeliberationRuntimeAdapter(db, {
      ...adapterContext,
      ...(ledgerWriter != null ? { ledgerWriter } : {}),
    }),
    evidenceCost: new TeamEvidenceCostRuntimeAdapter(db, adapterContext),
    replayPlaybook: new TeamReplayPlaybookRuntimeAdapter(db, adapterContext),
    p1: new TeamP1RuntimeAdapter(db, adapterContext),
  }
}

/** Compose adapter tools in the same order for in-process and HTTP MCP consumers. */
export function buildTeamRuntimeToolDefinitions(
  adapters: TeamRuntimeAdapters,
): TeamToolDefinition[] {
  return [
    ...adapters.taskGraph.buildToolDefinitions(),
    ...adapters.deliberation.buildToolDefinitions(),
    ...adapters.evidenceCost.buildToolDefinitions(),
    ...adapters.replayPlaybook.buildToolDefinitions(),
    ...adapters.p1.buildToolDefinitions(),
  ]
}

export interface TeamRuntimeCleanupOperations {
  taskGraph: () => number
  deliberation: () => number
  evidenceCost: () => number
  replayPlaybook: () => number
  handoffs: () => number
  steeringGates: () => number
}

/** Delete all session-owned team runtime state while keeping cleanup order explicit. */
export function cleanupTeamRuntimeState(operations: TeamRuntimeCleanupOperations): number {
  return (
    operations.taskGraph() +
    operations.deliberation() +
    operations.evidenceCost() +
    operations.replayPlaybook() +
    operations.handoffs() +
    operations.steeringGates()
  )
}

export function deleteTeamRuntimeState(db: SparkDatabase, sessionId: string): number {
  return cleanupTeamRuntimeState({
    taskGraph: () => TaskGraphService.deleteBySession(db, sessionId),
    deliberation: () => DeliberationService.deleteBySession(db, sessionId),
    evidenceCost: () => EvidenceCostService.deleteBySession(db, sessionId),
    replayPlaybook: () => ReplayPlaybookService.deleteBySession(db, sessionId),
    handoffs: () => TeamHandoffService.deleteBySession(db, sessionId),
    steeringGates: () => SteeringGateService.deleteBySession(db, sessionId),
  })
}
