import { describe, expect, it } from 'vitest'
import type { RemoteConnectionConfig } from '@spark/protocol'
import {
  canShareRemoteSession,
  canUseConfiguredRemoteSession,
  remoteConnectionsForSession,
  remoteRouteKey,
} from './remoteSessionIsolation.js'

function connection(
  id: string,
  sessionId: string,
  allowSharedSession = false,
): RemoteConnectionConfig {
  return {
    id,
    channel: id === 'tg' ? 'telegram' : 'qq',
    name: id,
    enabled: true,
    status: 'connected',
    credentials: {},
    commandPrefix: '/',
    allowedUserIds: [],
    allowedChatIds: [],
    defaultSessionId: sessionId,
    allowSharedSession,
    telegramCommands: [],
    capabilities: {
      sendMessages: true,
      switchModel: true,
      switchSession: true,
      switchAgent: true,
      manageWorkspace: true,
      runCommands: true,
      approvePermissions: false,
      observeDesktop: false,
      controlDesktop: false,
      useInternalBrowser: false,
      transferFiles: false,
      manageRuntime: false,
      dangerousActions: false,
    },
    pairedDevices: [],
    createdAt: '',
    updatedAt: '',
  }
}

describe('remote session isolation', () => {
  it('finds every other connection bound to a session', () => {
    const rows = [connection('tg', 's1'), connection('qq', 's1'), connection('other', 's2')]
    expect(remoteConnectionsForSession(rows, 's1', 'qq').map((item) => item.id)).toEqual(['tg'])
  })

  it('requires every connection to explicitly allow sharing', () => {
    expect(
      canShareRemoteSession({ allowSharedSession: true }, [{ allowSharedSession: true }]),
    ).toBe(true)
    expect(
      canShareRemoteSession({ allowSharedSession: true }, [{ allowSharedSession: false }]),
    ).toBe(false)
    expect(canShareRemoteSession({}, [{ allowSharedSession: true }])).toBe(false)
  })

  it('forces legacy duplicate bindings onto a new isolated session', () => {
    const telegram = connection('tg', 's1')
    const qq = connection('qq', 's1')
    expect(canUseConfiguredRemoteSession([telegram, qq], qq)).toBe(false)
    const sharedTelegram = connection('tg', 's1', true)
    const sharedQq = connection('qq', 's1', true)
    expect(canUseConfiguredRemoteSession([sharedTelegram, sharedQq], sharedQq)).toBe(true)
  })

  it('includes connection identity in transient route keys', () => {
    expect(remoteRouteKey('bot-a', 'qq-user:same')).not.toBe(
      remoteRouteKey('bot-b', 'qq-user:same'),
    )
  })
})
