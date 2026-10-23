import type { RemoteAgentDispatchStatusResponse } from '@spark/protocol'

export type RemoteAgentDispatchRecoveryAction = 'adopt' | 'retry' | 'wait' | 'interrupted'

/**
 * Decide whether A can safely resume a dispatch from B's status snapshot.
 * Replaying a task is safe only with the original request body and B's taskId lock.
 */
export function getRemoteAgentDispatchRecoveryAction(
  snapshot: RemoteAgentDispatchStatusResponse,
  hasOriginalRequest: boolean,
): RemoteAgentDispatchRecoveryAction {
  const task = snapshot.task
  if (task != null && task.status !== 'dispatching') return 'adopt'
  if (snapshot.dispatchActive === true) return 'wait'
  if (task == null) return hasOriginalRequest ? 'retry' : 'interrupted'
  if (hasOriginalRequest) return 'retry'
  if (snapshot.dispatchActive === false) return 'interrupted'
  // Older B versions do not report dispatchActive. Avoid falsely failing a live request.
  return 'wait'
}
