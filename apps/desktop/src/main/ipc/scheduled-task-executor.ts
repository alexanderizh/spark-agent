import { createScheduledTaskTurnPresentation } from '@spark/protocol'

export interface SessionScheduledTaskTurnParams {
  sessionId: string
  promptTemplate: string
  userMessageDisplayContent: string
  onSessionCreated?: (sessionId: string) => void
}

export interface SessionScheduledTaskTurnDeps {
  getSession: (sessionId: string) => { id: string; archived_at: string | null } | null
  submitTurn: (params: {
    sessionId: string
    message: string
    turnSource: 'scheduled_task'
    userMessageVisibility: 'hidden'
    userMessageDisplayContent: string
  }) => Promise<{ turnId: string }>
}

/** Queue a scheduled turn in its existing session, preserving that session's live runtime config. */
export async function runSessionScheduledTaskTurn(
  params: SessionScheduledTaskTurnParams,
  deps: SessionScheduledTaskTurnDeps,
): Promise<{ sessionId: string; output: string }> {
  const session = deps.getSession(params.sessionId)
  if (session == null) {
    throw new Error(`Scheduled task session no longer exists: ${params.sessionId}`)
  }
  if (session.archived_at != null) {
    throw new Error(`Scheduled task session is archived: ${params.sessionId}`)
  }

  params.onSessionCreated?.(params.sessionId)
  const result = await deps.submitTurn({
    sessionId: params.sessionId,
    message: params.promptTemplate,
    ...createScheduledTaskTurnPresentation(params.userMessageDisplayContent),
  })
  return {
    sessionId: params.sessionId,
    output: `Turn ${result.turnId} queued`,
  }
}
