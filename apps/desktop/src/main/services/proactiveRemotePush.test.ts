import { describe, expect, it } from 'vitest'
import type { RemoteConnectionCapabilities, RemoteConnectionConfig } from '@spark/protocol'
import {
  deliverProactivePush,
  type DesktopNotificationRequest,
  type ProactivePushConnectionService,
} from './proactiveRemotePush.js'

function capabilities(
  overrides: Partial<RemoteConnectionCapabilities> = {},
): RemoteConnectionCapabilities {
  return {
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
    ...overrides,
  }
}

function connection(overrides: Partial<RemoteConnectionConfig> = {}): RemoteConnectionConfig {
  return {
    id: 'conn-1',
    channel: 'telegram',
    name: 'TG Bot',
    enabled: true,
    status: 'connected',
    credentials: {},
    commandPrefix: '/',
    allowedUserIds: [],
    allowedChatIds: [],
    routeBindings: [{ externalId: 'chat-100', defaultSessionId: 'session-1' }],
    telegramCommands: [],
    qqCommands: [],
    capabilities: capabilities(),
    pairedDevices: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

type SentReply = { connectionId: string; externalId: string; text: string }

function stubService(
  connections: RemoteConnectionConfig[],
  sent: SentReply[] = [],
  failureConnectionIds: ReadonlySet<string> = new Set(),
): ProactivePushConnectionService {
  return {
    list: () => ({
      global: {
        enabled: true,
        requirePairing: true,
        allowQrPairing: true,
        pairingTtlMinutes: 10,
        localWebhookPort: 32178,
      },
      connections,
    }),
    sendReply: async (connectionId, externalId, text) => {
      if (failureConnectionIds.has(connectionId)) {
        throw new Error('delivery failed after retries')
      }
      sent.push({ connectionId, externalId, text })
    },
  }
}

describe('deliverProactivePush', () => {
  it('falls back to the desktop notifier when no route is bound', async () => {
    const notifications: DesktopNotificationRequest[] = []
    const sent: SentReply[] = []
    const result = await deliverProactivePush(
      stubService([connection({ routeBindings: [] })], sent),
      'session-1',
      '构建完成',
      undefined,
      { showDesktopNotification: (request) => notifications.push(request) },
    )
    expect(result).toEqual({ delivered: [], failures: [], fallbackDesktop: true })
    expect(sent).toEqual([])
    expect(notifications).toEqual([
      {
        title: '助手通知',
        body: '构建完成',
        navigationTarget: { target: 'session', sessionId: 'session-1' },
      },
    ])
  })

  it('uses the given title for the desktop fallback', async () => {
    const notifications: DesktopNotificationRequest[] = []
    await deliverProactivePush(
      stubService([connection({ routeBindings: [] })]),
      'session-1',
      'body text',
      '长任务完成',
      { showDesktopNotification: (request) => notifications.push(request) },
    )
    expect(notifications[0]?.title).toBe('长任务完成')
    expect(notifications[0]?.body).toBe('body text')
  })

  it('delivers to the bound route with the title prepended to the text', async () => {
    const sent: SentReply[] = []
    const result = await deliverProactivePush(
      stubService([connection()], sent),
      'session-1',
      '构建完成，产物已就绪',
      '任务状态',
    )
    expect(result.fallbackDesktop).toBe(false)
    expect(result.delivered).toEqual([{ label: 'TG Bot', channel: 'telegram' }])
    expect(sent).toEqual([
      { connectionId: 'conn-1', externalId: 'chat-100', text: '任务状态\n构建完成，产物已就绪' },
    ])
  })

  it('sends without a title prefix when title is omitted', async () => {
    const sent: SentReply[] = []
    await deliverProactivePush(stubService([connection()], sent), 'session-1', 'plain message')
    expect(sent[0]?.text).toBe('plain message')
  })

  it('ignores disabled connections and falls back to desktop', async () => {
    const sent: SentReply[] = []
    const notifications: DesktopNotificationRequest[] = []
    const result = await deliverProactivePush(
      stubService([connection({ enabled: false })], sent),
      'session-1',
      'msg',
      undefined,
      { showDesktopNotification: (request) => notifications.push(request) },
    )
    expect(sent).toEqual([])
    expect(result.fallbackDesktop).toBe(true)
    expect(notifications).toHaveLength(1)
  })

  it('ignores connections with proactivePush capability disabled and falls back to desktop', async () => {
    const sent: SentReply[] = []
    const notifications: DesktopNotificationRequest[] = []
    const result = await deliverProactivePush(
      stubService([connection({ capabilities: capabilities({ proactivePush: false }) })], sent),
      'session-1',
      'msg',
      undefined,
      { showDesktopNotification: (request) => notifications.push(request) },
    )
    expect(sent).toEqual([])
    expect(result.fallbackDesktop).toBe(true)
    expect(notifications).toHaveLength(1)
  })

  it('delivers to every qualifying route when multiple routes share the session', async () => {
    const sent: SentReply[] = []
    const connections = [
      connection({ id: 'conn-tg', channel: 'telegram', name: 'TG' }),
      connection({
        id: 'conn-feishu',
        channel: 'feishu',
        name: '飞书',
        routeBindings: [{ externalId: 'oc_chat_9', defaultSessionId: 'session-1' }],
      }),
    ]
    const result = await deliverProactivePush(stubService(connections, sent), 'session-1', 'hello')
    expect(result.delivered).toEqual([
      { label: 'TG', channel: 'telegram' },
      { label: '飞书', channel: 'feishu' },
    ])
    expect(result.failures).toEqual([])
    expect(sent.map((item) => item.connectionId)).toEqual(['conn-tg', 'conn-feishu'])
    // 未绑定该会话的路由不得被波及。
    const unbound = connections[0]!.routeBindings!.every(
      (route) => route.defaultSessionId === 'session-1',
    )
    expect(unbound).toBe(true)
  })

  it('reports per-route failures without blocking other routes', async () => {
    const sent: SentReply[] = []
    const connections = [
      connection({ id: 'conn-tg', channel: 'telegram', name: 'TG' }),
      connection({
        id: 'conn-qq',
        channel: 'qq',
        name: 'QQ',
        routeBindings: [{ externalId: 'qq-friend-1', defaultSessionId: 'session-1' }],
      }),
    ]
    const result = await deliverProactivePush(
      stubService(connections, sent, new Set(['conn-qq'])),
      'session-1',
      'hello',
    )
    expect(result.delivered).toEqual([{ label: 'TG', channel: 'telegram' }])
    expect(result.failures).toEqual([
      { label: 'QQ', channel: 'qq', error: 'delivery failed after retries' },
    ])
    expect(result.fallbackDesktop).toBe(false)
    expect(sent.map((item) => item.connectionId)).toEqual(['conn-tg'])
  })

  it('does not fall back to desktop when routes existed but all deliveries failed', async () => {
    const notifications: DesktopNotificationRequest[] = []
    const result = await deliverProactivePush(
      stubService([connection()], [], new Set(['conn-1'])),
      'session-1',
      'hello',
      undefined,
      { showDesktopNotification: (request) => notifications.push(request) },
    )
    expect(result.delivered).toEqual([])
    expect(result.failures).toHaveLength(1)
    // 投递已尝试过：不再叠加桌面通知，避免双通道重复轰炸。
    expect(result.fallbackDesktop).toBe(false)
    expect(notifications).toEqual([])
  })
})
