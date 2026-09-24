import type { SettingsService } from '@spark/agent-runtime'
import type { RemoteConnectionConfig, RemoteMessageAction } from '@spark/protocol'
import type {
  WeixinClawBotClient,
  WeixinInboundMessage,
  WeixinQrLoginResult,
} from './WeixinClawBotClient.js'

const SETTINGS_CATEGORY = 'remote-connections'
const SETTINGS_KEY = 'data'

export type WeixinConnectionState = {
  getUpdatesBuf: string
  contexts: Record<string, string>
}

type WeixinInboundPayload = {
  externalId: string
  senderName: string
  text: string
  messageId?: string
}

type WeixinOutboundMessage = {
  title?: string
  text: string
  actions?: RemoteMessageAction[]
  images?: Array<{ source: string; alt: string }>
}

type WeixinInboundHandler = (
  connection: RemoteConnectionConfig,
  message: WeixinInboundPayload,
) => Promise<void>

type WeixinConnectionStore = {
  listConnections: () => RemoteConnectionConfig[]
  saveConnection: (connection: RemoteConnectionConfig) => RemoteConnectionConfig
  syncRuntime: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeWeixinState(value: unknown): Record<string, WeixinConnectionState> {
  if (!isRecord(value)) return {}
  const state: Record<string, WeixinConnectionState> = {}
  for (const [connectionId, rawEntry] of Object.entries(value)) {
    if (!isRecord(rawEntry)) continue
    const contexts: Record<string, string> = {}
    if (isRecord(rawEntry.contexts)) {
      for (const [externalId, token] of Object.entries(rawEntry.contexts).slice(-200)) {
        if (externalId.length <= 160 && typeof token === 'string' && token.length <= 4000) {
          contexts[externalId] = token
        }
      }
    }
    state[connectionId] = {
      getUpdatesBuf:
        typeof rawEntry.getUpdatesBuf === 'string' ? rawEntry.getUpdatesBuf.slice(0, 20_000) : '',
      contexts,
    }
  }
  return state
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>|]/g, '')
    .trim()
}

function splitText(text: string, maxLen: number): string[] {
  const chars = Array.from(text)
  if (chars.length <= maxLen) return [text]
  const chunks: string[] = []
  for (let index = 0; index < chars.length; index += maxLen) {
    chunks.push(chars.slice(index, index + maxLen).join(''))
  }
  return chunks
}

/** Stores iLink cursors and conversation context tokens outside renderer-visible connection data. */
export class RemoteWeixinChannel {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly client: WeixinClawBotClient,
    private readonly handleInbound: WeixinInboundHandler,
    private readonly connectionStore: WeixinConnectionStore,
  ) {}

  async startQrLogin(
    connectionId: string,
  ): Promise<{ loginId: string; qrPayload: string; expiresAt: string }> {
    const connections = this.connectionStore.listConnections()
    const connection = connections.find((item) => item.id === connectionId)
    if (connection == null || connection.channel !== 'wechat') {
      throw new Error('微信机器人连接不存在')
    }
    const localTokens = connections
      .filter((item) => item.channel === 'wechat')
      .map((item) => item.credentials.wechatBotToken?.trim())
      .filter((token): token is string => token != null && token.length > 0)
    return this.client.startQrLogin(connectionId, localTokens)
  }

  async pollQrLogin(
    connectionId: string,
    loginId: string,
    verifyCode?: string,
  ): Promise<
    Pick<WeixinQrLoginResult, 'status' | 'message'> & { connection?: RemoteConnectionConfig }
  > {
    const connection = this.connectionStore
      .listConnections()
      .find((item) => item.id === connectionId)
    if (connection == null || connection.channel !== 'wechat') {
      this.client.cancelQrLogin(connectionId, loginId)
      return { status: 'expired', message: '微信连接已删除或类型已改变，请重新选择连接。' }
    }
    const result = await this.client.pollQrLogin(connectionId, loginId, verifyCode)
    if (result.status !== 'confirmed' || result.botToken == null || result.botId == null) {
      return result
    }
    const current = this.connectionStore.listConnections().find((item) => item.id === connectionId)
    if (current == null || current.channel !== 'wechat') {
      this.client.cancelQrLogin(connectionId, loginId)
      return { status: 'expired', message: '微信连接已删除，请重新创建连接后授权。' }
    }
    const updated: RemoteConnectionConfig = {
      ...current,
      credentials: {
        ...current.credentials,
        wechatBotToken: result.botToken,
        wechatBotId: result.botId,
        ...(result.baseUrl ? { wechatApiBaseUrl: result.baseUrl } : {}),
        ...(result.userId ? { wechatAuthorizedUserId: result.userId } : {}),
      },
      status: current.enabled ? current.status : 'draft',
    }
    delete updated.lastError
    const saved = this.connectionStore.saveConnection(updated)
    if (saved.enabled) this.connectionStore.syncRuntime()
    return { status: result.status, message: result.message, connection: saved }
  }

  cancelQrLogin(connectionId: string, loginId: string): void {
    this.client.cancelQrLogin(connectionId, loginId)
  }

  getCursor(connectionId: string): string | undefined {
    return this.readState()[connectionId]?.getUpdatesBuf
  }

  async handleMessage(connectionId: string, message: WeixinInboundMessage): Promise<void> {
    const raw = this.readRawSettings()
    const connections = Array.isArray(raw.connections) ? raw.connections : []
    const connectionValue = connections.find(
      (item) => isRecord(item) && item.id === connectionId && item.channel === 'wechat',
    )
    if (!isRecord(connectionValue)) return
    const connection = connectionValue as unknown as RemoteConnectionConfig
    if (!connection.enabled) return
    if (message.contextToken != null) {
      this.rememberContext(connectionId, message.externalId, message.contextToken)
    }
    await this.handleInbound(connection, {
      externalId: message.externalId,
      senderName: '微信用户',
      text: message.text,
      ...(message.messageId ? { messageId: `wechat:${connectionId}:${message.messageId}` } : {}),
    })
  }

  rememberCursor(connectionId: string, cursor: string): void {
    const state = this.readState()
    const current = state[connectionId] ?? { getUpdatesBuf: '', contexts: {} }
    this.writeState(connectionId, { ...current, getUpdatesBuf: cursor })
  }

  async sendMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    message: WeixinOutboundMessage,
  ): Promise<void> {
    const token = connection.credentials.wechatBotToken?.trim()
    if (!token) throw new Error('微信机器人尚未扫码授权')
    const contextToken = this.readState()[connection.id]?.contexts[externalId]
    const actionText = (message.actions ?? []).map((action) => `${action.label}: ${action.command}`)
    const imageNotice = (message.images?.length ?? 0) > 0 ? ['当前微信通道暂不支持发送图片。'] : []
    const body = [
      plainText(message.title != null ? `${message.title}\n${message.text}` : message.text),
      ...actionText,
      ...imageNotice,
    ]
      .filter((part) => part.length > 0)
      .join('\n')
    if (body.length === 0) return
    for (const text of splitText(body, 3500)) {
      await this.client.sendText({
        token,
        ...(connection.credentials.wechatApiBaseUrl != null
          ? { baseUrl: connection.credentials.wechatApiBaseUrl }
          : {}),
        externalId,
        contextToken: contextToken ?? '',
        text,
      })
    }
  }

  deleteConnectionState(connectionId: string): void {
    const state = this.readState()
    if (state[connectionId] == null) return
    delete state[connectionId]
    const raw = this.readRawSettings()
    this.settingsService.set(SETTINGS_CATEGORY, SETTINGS_KEY, { ...raw, weixinState: state })
  }

  readState(): Record<string, WeixinConnectionState> {
    return sanitizeWeixinState(this.readRawSettings().weixinState)
  }

  private rememberContext(connectionId: string, externalId: string, contextToken: string): void {
    const state = this.readState()
    const current = state[connectionId] ?? { getUpdatesBuf: '', contexts: {} }
    if (current.contexts[externalId] === contextToken) return
    const contexts = { ...current.contexts }
    delete contexts[externalId]
    contexts[externalId] = contextToken
    this.writeState(connectionId, {
      ...current,
      contexts: Object.fromEntries(Object.entries(contexts).slice(-200)),
    })
  }

  private writeState(connectionId: string, entry: WeixinConnectionState): void {
    const state = this.readState()
    const raw = this.readRawSettings()
    this.settingsService.set(SETTINGS_CATEGORY, SETTINGS_KEY, {
      ...raw,
      weixinState: { ...state, [connectionId]: entry },
    })
  }

  private readRawSettings(): Record<string, unknown> {
    const value = this.settingsService.get(SETTINGS_CATEGORY, SETTINGS_KEY)
    return isRecord(value) ? value : {}
  }
}
