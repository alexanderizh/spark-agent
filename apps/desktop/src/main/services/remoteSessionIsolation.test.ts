import { describe, expect, it } from 'vitest'
import type { RemoteConnectionConfig } from '@spark/protocol'
import {
  canShareRemoteSession,
  canBindRemoteRouteSession,
  canUseConfiguredRemoteSession,
  remoteConnectionsForSession,
  remoteRouteKey,
  remoteRouteSessionOwners,
  resolveScheduledRemoteRoute,
  withRemoteRouteDefaults,
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
    qqCommands: [],
    capabilities: {
      sendMessages: true,
      proactivePush: true,
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
    expect(remoteRouteKey('bot-a', 'chat-a')).not.toBe(remoteRouteKey('bot-a', 'chat-b'))
  })

  it('keeps independent chats on one bot from binding the same session', () => {
    const bot = connection('tg', 'legacy')
    bot.routeBindings = [
      { externalId: 'chat-a', defaultSessionId: 'session-a', defaultModelId: 'model-a' },
      {
        externalId: 'chat-b',
        defaultSessionId: 'session-b',
        defaultModelId: 'model-b',
        defaultReasoningEffort: 'high',
      },
    ]
    expect(canBindRemoteRouteSession([bot], bot, 'chat-b', 'session-a')).toBe(false)
    expect(remoteRouteSessionOwners([bot], 'session-a')).toMatchObject([
      { route: { externalId: 'chat-a' } },
    ])
    expect(
      withRemoteRouteDefaults(bot, bot.routeBindings[1] ?? { externalId: 'chat-b' }).defaultModelId,
    ).toBe('model-b')
    expect(
      withRemoteRouteDefaults(bot, bot.routeBindings[1] ?? { externalId: 'chat-b' })
        .defaultReasoningEffort,
    ).toBe('high')
    expect(withRemoteRouteDefaults(bot, { externalId: 'chat-c' }).defaultSessionId).toBeUndefined()
  })

  it('delivers scheduled turns only when exactly one enabled chat owns the session', () => {
    const bot = connection('tg', 'legacy')
    bot.routeBindings = [
      { externalId: 'chat-a', defaultSessionId: 'session-a' },
      { externalId: 'chat-b', defaultSessionId: 'session-b' },
    ]
    expect(resolveScheduledRemoteRoute([bot], 'session-a')).toEqual({
      connectionId: 'tg',
      externalId: 'chat-a',
    })
    expect(resolveScheduledRemoteRoute([bot], 'legacy')).toBeNull()
    const second = bot.routeBindings[1]
    if (second == null) throw new Error('Missing second route')
    second.defaultSessionId = 'session-a'
    expect(resolveScheduledRemoteRoute([bot], 'session-a')).toBeNull()
    bot.enabled = false
    expect(resolveScheduledRemoteRoute([bot], 'session-a')).toBeNull()
  })
})
