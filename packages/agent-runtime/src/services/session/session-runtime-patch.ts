import type { SessionRepository } from '@spark/storage'
import {
  getChatModeFromSession,
  getCliSparkOverrideFromMetadata,
  getFastModeFromMetadata,
  normalizeCliSparkOverride,
  normalizeReasoningEffort,
  type SessionRuntimePatch,
} from './session-pure-utils.js'
import { normalizeAgentAdapter, normalizePermissionMode } from './engine-kinds.js'

type RuntimeSessionRepository = Pick<SessionRepository, 'patchMetadata' | 'updateRuntime'>

type RuntimeSelectionSessionRow = {
  provider_profile_id: string | null
  model_id: string | null
  agent_adapter: string
  chat_mode: string
  metadata_json: string | null
}

type GoalRuntimeSessionRow = RuntimeSelectionSessionRow & {
  agent_id: string
  permission_mode: string
  reasoning_effort: string
}

/**
 * 会话 turn 起跑时物化的运行时选择。成员可能在 Host 已运行一段时间后才被派发，
 * 因此不能在成员执行时重新读取会被后续排队消息修改的会话选择。
 */
export type TurnRuntimeSelectionSnapshot = Readonly<{
  providerProfileId: string | null
  modelId: string | null
  agentAdapter: string
  chatMode: string
  cliSparkOverride: Readonly<{
    providerProfileId: string
    modelId: string
  }> | null
}>

export function captureTurnRuntimeSelectionSnapshot(
  session: RuntimeSelectionSessionRow,
): TurnRuntimeSelectionSnapshot {
  const cliSparkOverride = getCliSparkOverrideFromMetadata(session.metadata_json)
  return Object.freeze({
    providerProfileId: session.provider_profile_id,
    modelId: session.model_id,
    agentAdapter: session.agent_adapter,
    chatMode: session.chat_mode,
    cliSparkOverride: cliSparkOverride == null ? null : Object.freeze({ ...cliSparkOverride }),
  })
}

export function captureGoalDrainableRuntimeBaseline(
  session: GoalRuntimeSessionRow,
): SessionRuntimePatch {
  return {
    ...(session.provider_profile_id != null
      ? { providerProfileId: session.provider_profile_id }
      : {}),
    modelId: session.model_id,
    agentId: session.agent_id,
    agentAdapter: normalizeAgentAdapter(session.agent_adapter),
    permissionMode: normalizePermissionMode(session.permission_mode),
    chatMode: getChatModeFromSession(session.chat_mode),
    reasoningEffort: normalizeReasoningEffort(session.reasoning_effort),
    fastMode: getFastModeFromMetadata(session.metadata_json),
    cliSparkOverride: getCliSparkOverrideFromMetadata(session.metadata_json),
  }
}

export function applySessionRuntimePatch(
  sessionRepo: RuntimeSessionRepository,
  sessionId: string,
  runtimePatch: SessionRuntimePatch | undefined,
): void {
  if (runtimePatch == null) return
  if (runtimePatch.cliSparkOverride !== undefined) {
    sessionRepo.patchMetadata(sessionId, {
      cliSparkOverride: normalizeCliSparkOverride(runtimePatch.cliSparkOverride),
    })
  }
  if (runtimePatch.fastMode !== undefined) {
    sessionRepo.patchMetadata(sessionId, { fastMode: runtimePatch.fastMode })
  }
  sessionRepo.updateRuntime(sessionId, runtimePatch)
}
