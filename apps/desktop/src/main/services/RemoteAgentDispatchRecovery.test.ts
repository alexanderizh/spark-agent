import { describe, expect, it } from 'vitest'
import { getRemoteAgentDispatchRecoveryAction } from './RemoteAgentDispatchRecovery.js'
import type { RemoteAgentDispatchStatusResponse } from '@spark/protocol'

const incompleteTask: NonNullable<RemoteAgentDispatchStatusResponse['task']> = {
  taskId: 'task-1',
  remoteSessionId: null,
  turnId: null,
  status: 'dispatching',
}

describe('getRemoteAgentDispatchRecoveryAction', () => {
  it('replays a missing reservation only while the original request body is available', () => {
    expect(getRemoteAgentDispatchRecoveryAction({ task: null }, true)).toBe('retry')
    expect(getRemoteAgentDispatchRecoveryAction({ task: null }, false)).toBe('interrupted')
  })

  it('waits when B has accepted the request but has not written its reservation yet', () => {
    expect(getRemoteAgentDispatchRecoveryAction({ task: null, dispatchActive: true }, true)).toBe(
      'wait',
    )
    expect(getRemoteAgentDispatchRecoveryAction({ task: null, dispatchActive: true }, false)).toBe(
      'wait',
    )
  })

  it('does not replay or fail while B still owns an active dispatch request', () => {
    expect(
      getRemoteAgentDispatchRecoveryAction({ task: incompleteTask, dispatchActive: true }, true),
    ).toBe('wait')
    expect(
      getRemoteAgentDispatchRecoveryAction({ task: incompleteTask, dispatchActive: true }, false),
    ).toBe('wait')
  })

  it('retries an orphaned reservation with the same original payload', () => {
    expect(
      getRemoteAgentDispatchRecoveryAction({ task: incompleteTask, dispatchActive: false }, true),
    ).toBe('retry')
  })

  it('does not mistake a created-but-unsubmitted session for an accepted task', () => {
    expect(
      getRemoteAgentDispatchRecoveryAction(
        {
          task: { ...incompleteTask, remoteSessionId: 'session-1' },
          dispatchActive: false,
        },
        true,
      ),
    ).toBe('retry')
  })

  it('closes an orphaned reservation when A no longer has the payload', () => {
    expect(
      getRemoteAgentDispatchRecoveryAction({ task: incompleteTask, dispatchActive: false }, false),
    ).toBe('interrupted')
  })

  it('adopts a task once B reports a submitted lifecycle state', () => {
    expect(
      getRemoteAgentDispatchRecoveryAction(
        {
          task: { ...incompleteTask, remoteSessionId: 'session-1', status: 'running' },
        },
        false,
      ),
    ).toBe('adopt')
  })

  it('adopts submitted tasks even while B is finishing its dispatch handler', () => {
    expect(
      getRemoteAgentDispatchRecoveryAction(
        {
          task: { ...incompleteTask, remoteSessionId: 'session-1', status: 'running' },
          dispatchActive: true,
        },
        false,
      ),
    ).toBe('adopt')
  })

  it('keeps legacy B status snapshots pending when processing state is unknown', () => {
    expect(getRemoteAgentDispatchRecoveryAction({ task: incompleteTask }, false)).toBe('wait')
  })
})
