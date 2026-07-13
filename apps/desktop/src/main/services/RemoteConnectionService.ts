import crypto from 'node:crypto'
import http from 'node:http'
import { URL } from 'node:url'
import type { SettingsService } from '@spark/agent-runtime'
import type {
  RemoteChannelType,
  RemoteCommandDefinition,
  RemoteConnectionCapabilities,
  RemoteConnectionConfig,
  RemoteConnectionGlobalSettings,
  RemoteConnectionStatus,
  RemoteCreateBotDraftResponse,
  RemotePairingChallenge,
  RemotePairingMode,
  RemoteTestResponse,
} from '@spark/protocol'

const SETTINGS_CATEGORY = 'remote-connections'
const SETTINGS_KEY = 'data'

type RemoteConnectionStore = {
  global: RemoteConnectionGlobalSettings
  connections: RemoteConnectionConfig[]
}

export type RemoteInboundMessage = {
  connection: RemoteConnectionConfig
  externalId: string
  senderName: string
  text: string
  messageId?: string
}

export type RemoteInboundHandler = (message: RemoteInboundMessage) => Promise<{
  title: string
  text: string
} | void>

export type RemoteConnectionChangeEvent = {
  reason: 'connection-saved' | 'connection-deleted' | 'pairing-updated' | 'runtime-updated'
  connectionId?: string
}

type TelegramPollingState = {
  offset: number
  timer: ReturnType<typeof setTimeout> | null
  token: string
  running: boolean
  failCount: number
  lastError?: string
}

type FeishuWsState = {
  appId: string
  appSecret: string
  running: boolean
  startedAt: number
  client?: { close: () => void }
  lastError?: string
}

type FeishuMessageReceiveEvent = {
  sender?: {
    sender_type?: string
    sender_id?: {
      open_id?: string
    }
  }
  message?: {
    chat_id?: string
    message_id?: string
    message_type?: string
    content?: string
    create_time?: string | number
  }
}

type TokenCacheEntry = {
  token: string
  expiresAt: number
}

const DEFAULT_GLOBAL: RemoteConnectionGlobalSettings = {
  enabled: true,
  requirePairing: true,
  allowQrPairing: true,
  pairingTtlMinutes: 10,
  localWebhookPort: 32178,
}

const DEFAULT_CAPABILITIES: RemoteConnectionCapabilities = {
  sendMessages: true,
  switchModel: true,
  switchSession: true,
  switchAgent: true,
  manageWorkspace: true,
  runCommands: true,
  approvePermissions: false,
  observeDesktop: true,
  controlDesktop: false,
  useInternalBrowser: false,
  transferFiles: false,
  manageRuntime: false,
  dangerousActions: false,
}

const COMMAND_CATALOG: RemoteCommandDefinition[] = [
  { name: 'help', usage: '/help', description: '查看远程可用命令', capability: 'system' },
  {
    name: 'sessions',
    usage: '/sessions',
    description: '列出最近会话',
    capability: 'switchSession',
  },
  {
    name: 'use-session',
    usage: '/use-session <序号|名称|sessionId>',
    description: '切换默认会话',
    capability: 'switchSession',
  },
  { name: 'models', usage: '/models', description: '列出可用模型配置', capability: 'switchModel' },
  {
    name: 'use-model',
    usage: '/use-model <序号|名称|modelId>',
    description: '切换当前会话或连接默认模型',
    capability: 'switchModel',
  },
  {
    name: 'providers',
    usage: '/providers',
    description: '列出 Provider 配置',
    capability: 'switchModel',
  },
  {
    name: 'use-provider',
    usage: '/use-provider <序号|名称|providerProfileId>',
    description: '切换当前会话或连接默认 Provider',
    capability: 'switchModel',
  },
  { name: 'agents', usage: '/agents', description: '列出 Agent', capability: 'switchAgent' },
  {
    name: 'use-agent',
    usage: '/use-agent <序号|名称|agentId>',
    description: '切换当前会话或连接默认 Agent',
    capability: 'switchAgent',
  },
  {
    name: 'workspaces',
    usage: '/workspaces',
    description: '列出工作区',
    capability: 'manageWorkspace',
  },
  {
    name: 'new-session',
    usage: '/new-session [序号|名称|workspaceId]',
    description: '新建会话并设为默认会话',
    capability: 'switchSession',
  },
  {
    name: 'open-workspace',
    usage: '/open-workspace <path>',
    description: '打开本地项目目录',
    capability: 'manageWorkspace',
  },
  {
    name: 'send',
    usage: '/send <message>',
    description: '向默认会话发送消息',
    capability: 'sendMessages',
  },
  {
    name: 'progress',
    usage: '/progress',
    description: '查看默认会话当前队列和最近状态',
    capability: 'manageRuntime',
  },
  {
    name: 'queue',
    usage: '/queue',
    description: '查看默认会话排队消息',
    capability: 'manageRuntime',
  },
  {
    name: 'history',
    usage: '/history',
    description: '查看最近远程命令审计',
    capability: 'manageRuntime',
  },
  {
    name: 'cancel',
    usage: '/cancel',
    description: '取消默认会话当前任务',
    capability: 'manageRuntime',
  },
  {
    name: 'stop',
    usage: '/stop',
    description: '停止当前远程任务（等同 /cancel）',
    capability: 'manageRuntime',
  },
  {
    name: 'screen',
    usage: '/screen',
    description: '查看当前桌面/窗口概览',
    capability: 'observeDesktop',
  },
  {
    name: 'windows',
    usage: '/windows',
    description: '列出当前可观察窗口',
    capability: 'observeDesktop',
  },
  {
    name: 'focus',
    usage: '/focus <序号|窗口标题>',
    description: '聚焦窗口（需要桌面控制权限）',
    capability: 'controlDesktop',
  },
  {
    name: 'click',
    usage: '/click <x> <y>',
    description: '远程点击（需要桌面控制权限）',
    capability: 'controlDesktop',
  },
  {
    name: 'type',
    usage: '/type <text>',
    description: '远程输入文本（需要桌面控制权限）',
    capability: 'controlDesktop',
  },
  {
    name: 'hotkey',
    usage: '/hotkey <keys>',
    description: '远程快捷键（需要桌面控制权限）',
    capability: 'controlDesktop',
  },
  {
    name: 'confirm',
    usage: '/confirm <code>',
    description: '确认高危远程动作',
    capability: 'dangerousActions',
  },
  { name: 'status', usage: '/status', description: '查看连接与配对状态', capability: 'system' },
]

const CHANNEL_META: Record<
  RemoteChannelType,
  {
    defaultName: string
    consoleUrl: string
    requiredFields: Array<keyof RemoteConnectionConfig['credentials']>
    instructions: string[]
  }
> = {
  telegram: {
    defaultName: 'Telegram Bot',
    consoleUrl: 'https://t.me/BotFather',
    requiredFields: ['botToken'],
    instructions: [
      '在 BotFather 中创建 bot 并复制 bot token。',
      '回到 SparkWork 填入 bot token，生成配对码后发送给 bot。',
      '可选：在 Telegram 命令配置中同步 /help、/sessions、/models、/agents。',
    ],
  },
  feishu: {
    defaultName: '飞书机器人',
    consoleUrl: 'https://open.feishu.cn/page/openclaw?form=multiAgent',
    requiredFields: ['appId', 'appSecret'],
    instructions: [
      '使用飞书 openclaw 快捷入口创建自建应用并预选机器人能力。',
      '复制 App ID 和 App Secret 到 SparkWork。',
      'SparkWork 会用飞书 WebSocket 长连接接收消息，无需公网 webhook。',
    ],
  },
  qq: {
    defaultName: 'QQ 机器人',
    consoleUrl: 'https://q.qq.com/#/app/bot',
    requiredFields: ['qqBotAppId', 'qqBotSecret'],
    instructions: [
      '在 QQ 开放平台创建机器人应用并开通消息事件。',
      '复制机器人 AppID 和 AppSecret 到连接配置。',
      '保存后生成配对码，在目标群聊或私聊内完成绑定。',
    ],
  },
  'wechat-claw': {
    defaultName: '微信 Claw',
    // 微信 Claw 为自建网关协议，无官方统一搭建入口；指向远程连接文档以便用户了解如何对接。
    consoleUrl: 'https://spark.yiqibyte.com/docs/remote-connections',
    requiredFields: ['clawEndpoint', 'clawAccessToken'],
    instructions: [
      '启动微信 Claw 网关，并确认 SparkWork 可访问网关地址。',
      '填入 Claw Endpoint 与 Access Token。',
      '生成配对码或二维码负载，在 Claw 会话内完成绑定。',
    ],
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function nowIso(): string {
  return new Date().toISOString()
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function defaultTelegramCommands(): string[] {
  return COMMAND_CATALOG.map((cmd) => cmd.name).filter((name) => name !== 'send')
}

function createPairingPayload(
  connection: RemoteConnectionConfig,
  pairing: RemotePairingChallenge,
): string {
  const params = new URLSearchParams({
    connectionId: connection.id,
    channel: connection.channel,
    code: pairing.code,
    expiresAt: pairing.expiresAt,
  })
  return `spark-agent://remote-pair?${params.toString()}`
}

const BIND_COMMAND_PATTERN = /^\/bind\s+([A-Z0-9]{6,12})$/i

function extractBindCode(text: string): string | null {
  const match = text.trim().match(BIND_COMMAND_PATTERN)
  return match?.[1]?.toUpperCase() ?? null
}

function normalizeInboundText(channel: RemoteChannelType, rawText: string): string {
  const trimmed = rawText.trim()
  if (channel === 'telegram') return trimmed.replace(/^@[a-zA-Z0-9_]+\s*/, '').trim()
  if (channel === 'feishu') return trimmed.replace(/@_user_\d+\s*/g, '').trim()
  if (channel === 'qq')
    return trimmed
      .replace(/<@[^>]+>\s*/g, '')
      .replace(/^@\S+\s*/, '')
      .trim()
  return trimmed.replace(/^@\S+\s*/, '').trim()
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function parseJsonContent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as { text?: unknown }
    return readString(parsed.text)
  } catch {
    return value
  }
}

function parseWebhookBody(
  channel: RemoteChannelType,
  body: unknown,
):
  | {
      kind: 'message'
      externalId: string
      senderName: string
      text: string
      messageId?: string
    }
  | { kind: 'challenge'; responseBody: unknown }
  | { kind: 'ignore' } {
  if (!isRecord(body)) return { kind: 'ignore' }

  if (channel === 'telegram') {
    const message = isRecord(body.message) ? body.message : undefined
    const chat = isRecord(message?.chat) ? message.chat : undefined
    const from = isRecord(message?.from) ? message.from : undefined
    const externalId = chat != null ? String(chat.id ?? '') : ''
    const text = readString(message?.text)
    if (!externalId || !text) return { kind: 'ignore' }
    const username = readString(from?.username)
    const firstName = readString(from?.first_name)
    return {
      kind: 'message',
      externalId,
      senderName:
        username != null
          ? `${firstName ?? username}(@${username})`
          : (firstName ?? 'Telegram 用户'),
      text: normalizeInboundText(channel, text),
      ...(message?.message_id != null
        ? { messageId: `telegram:${String(message.message_id)}` }
        : {}),
    }
  }

  if (channel === 'feishu') {
    if (body.challenge != null)
      return { kind: 'challenge', responseBody: { challenge: body.challenge } }
    const event = isRecord(body.event) ? body.event : body
    const message = isRecord(event.message) ? event.message : event
    const externalId =
      readString(message.chat_id) ?? readString(message.open_chat_id) ?? readString(event.chat_id)
    const text = parseJsonContent(message.content) ?? readString(message.text)
    if (!externalId || !text) return { kind: 'ignore' }
    const sender = isRecord(event.sender) ? event.sender : undefined
    const senderId = isRecord(sender?.sender_id) ? sender.sender_id : undefined
    return {
      kind: 'message',
      externalId,
      senderName: readString(senderId?.open_id) ?? readString(senderId?.user_id) ?? '飞书用户',
      text: normalizeInboundText(channel, text),
      ...(readString(message.message_id)
        ? { messageId: `feishu:${String(message.message_id)}` }
        : {}),
    }
  }

  if (channel === 'qq') {
    if (body.t && body.t !== 'GROUP_AT_MESSAGE_CREATE' && body.t !== 'C2C_MESSAGE_CREATE') {
      return { kind: 'ignore' }
    }
    const data = isRecord(body.d) ? body.d : body
    const externalId =
      readString(data.group_openid) ??
      readString(data.guild_id) ??
      readString(data.channel_id) ??
      readString(data.author_id)
    const text = readString(data.content)
    if (!externalId || !text) return { kind: 'ignore' }
    const author = isRecord(data.author) ? data.author : undefined
    return {
      kind: 'message',
      externalId,
      senderName: readString(author?.member_openid) ?? readString(author?.user_openid) ?? 'QQ 用户',
      text: normalizeInboundText(channel, text),
      ...(readString(body.id) ? { messageId: `qq:${String(body.id)}` } : {}),
    }
  }

  const externalId = readString(body.chatId) ?? readString(body.externalId) ?? readString(body.from)
  const text = readString(body.text) ?? readString(body.content) ?? parseJsonContent(body.message)
  if (!externalId || !text) return { kind: 'ignore' }
  return {
    kind: 'message',
    externalId,
    senderName: readString(body.senderName) ?? readString(body.sender) ?? '微信用户',
    text: normalizeInboundText(channel, text),
    ...(readString(body.messageId) ? { messageId: `wechat-claw:${String(body.messageId)}` } : {}),
  }
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

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>|]/g, '')
    .trim()
}

function resolveFeishuReceiveIdType(
  externalId: string,
): 'chat_id' | 'open_id' | 'user_id' | 'union_id' {
  if (externalId.startsWith('ou_')) return 'open_id'
  if (externalId.startsWith('on_')) return 'union_id'
  if (externalId.startsWith('user_')) return 'user_id'
  return 'chat_id'
}

function parseFeishuMessageTimestamp(value: unknown): number | null {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric
}

function sanitizeConnection(input: unknown): RemoteConnectionConfig | null {
  if (!isRecord(input)) return null
  const channel = input.channel
  if (
    channel !== 'telegram' &&
    channel !== 'feishu' &&
    channel !== 'qq' &&
    channel !== 'wechat-claw'
  ) {
    return null
  }
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : nowIso()
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : createdAt
  const status =
    input.status === 'disabled' ||
    input.status === 'draft' ||
    input.status === 'pending-pairing' ||
    input.status === 'connected' ||
    input.status === 'error'
      ? input.status
      : 'draft'

  return {
    id: typeof input.id === 'string' ? input.id : createId('remote'),
    channel,
    name: typeof input.name === 'string' ? input.name : CHANNEL_META[channel].defaultName,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : false,
    status,
    credentials: isRecord(input.credentials) ? { ...input.credentials } : {},
    commandPrefix: typeof input.commandPrefix === 'string' ? input.commandPrefix : '/',
    allowedUserIds: normalizeStringArray(input.allowedUserIds),
    allowedChatIds: normalizeStringArray(input.allowedChatIds),
    ...(typeof input.defaultSessionId === 'string'
      ? { defaultSessionId: input.defaultSessionId }
      : {}),
    ...(typeof input.defaultProviderProfileId === 'string'
      ? { defaultProviderProfileId: input.defaultProviderProfileId }
      : {}),
    ...(typeof input.defaultModelId === 'string' ? { defaultModelId: input.defaultModelId } : {}),
    ...(typeof input.defaultAgentId === 'string' ? { defaultAgentId: input.defaultAgentId } : {}),
    telegramCommands:
      normalizeStringArray(input.telegramCommands).length > 0
        ? normalizeStringArray(input.telegramCommands)
        : defaultTelegramCommands(),
    capabilities: isRecord(input.capabilities)
      ? { ...DEFAULT_CAPABILITIES, ...input.capabilities }
      : { ...DEFAULT_CAPABILITIES },
    ...(isRecord(input.pairing)
      ? { pairing: input.pairing as unknown as RemotePairingChallenge }
      : {}),
    pairedDevices: Array.isArray(input.pairedDevices)
      ? (input.pairedDevices as RemoteConnectionConfig['pairedDevices'])
      : [],
    createdAt,
    updatedAt,
    ...(typeof input.lastConnectedAt === 'string'
      ? { lastConnectedAt: input.lastConnectedAt }
      : {}),
    ...(typeof input.lastError === 'string' ? { lastError: input.lastError } : {}),
  }
}

export class RemoteConnectionService {
  private server: http.Server | null = null
  private runtimePort: number | null = null
  private inboundHandler: RemoteInboundHandler | null = null
  private pollingStates = new Map<string, TelegramPollingState>()
  private feishuWsStates = new Map<string, FeishuWsState>()
  private processedMessages = new Set<string>()
  private tokenCache = new Map<string, TokenCacheEntry>()
  private telegramCommandSignatures = new Map<string, string>()
  private changeListeners = new Set<(event: RemoteConnectionChangeEvent) => void>()

  constructor(private readonly settingsService: SettingsService) {}

  onChange(listener: (event: RemoteConnectionChangeEvent) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  list(): RemoteConnectionStore {
    return this.readStore()
  }

  getCommandCatalog(): RemoteCommandDefinition[] {
    return COMMAND_CATALOG
  }

  save(
    patch: Partial<RemoteConnectionConfig> & Pick<RemoteConnectionConfig, 'channel' | 'name'>,
  ): RemoteConnectionConfig {
    const store = this.readStore()
    const existing =
      patch.id != null ? store.connections.find((item) => item.id === patch.id) : undefined
    const timestamp = nowIso()
    const base: RemoteConnectionConfig = existing ?? {
      id: patch.id ?? createId('remote'),
      channel: patch.channel,
      name: patch.name,
      enabled: false,
      status: 'draft',
      credentials: {},
      commandPrefix: '/',
      allowedUserIds: [],
      allowedChatIds: [],
      telegramCommands: defaultTelegramCommands(),
      capabilities: { ...DEFAULT_CAPABILITIES },
      pairedDevices: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const next: RemoteConnectionConfig = {
      ...base,
      ...patch,
      credentials: { ...base.credentials, ...(patch.credentials ?? {}) },
      capabilities: { ...base.capabilities, ...(patch.capabilities ?? {}) },
      allowedUserIds: patch.allowedUserIds ?? base.allowedUserIds,
      allowedChatIds: patch.allowedChatIds ?? base.allowedChatIds,
      telegramCommands: patch.telegramCommands ?? base.telegramCommands,
      status: patch.enabled === false ? 'disabled' : (patch.status ?? base.status),
      updatedAt: timestamp,
    }
    const sanitized = sanitizeConnection(next)
    if (sanitized == null) throw new Error('Invalid remote connection')
    this.writeConnections(store, sanitized)
    this.emitChange({ reason: 'connection-saved', connectionId: sanitized.id })
    return sanitized
  }

  delete(id: string): boolean {
    const store = this.readStore()
    const next = store.connections.filter((item) => item.id !== id)
    this.writeStore({ ...store, connections: next })
    if (next.length !== store.connections.length) {
      this.emitChange({ reason: 'connection-deleted', connectionId: id })
    }
    return next.length !== store.connections.length
  }

  createBotDraft(channel: RemoteChannelType, name?: string): RemoteCreateBotDraftResponse {
    const meta = CHANNEL_META[channel]
    const connection = this.save({
      channel,
      name: name?.trim() || meta.defaultName,
      enabled: false,
      status: 'draft',
      credentials: {},
    })
    return {
      connection,
      consoleUrl: meta.consoleUrl,
      instructions: meta.instructions,
    }
  }

  test(id: string): RemoteTestResponse {
    const store = this.readStore()
    const connection = store.connections.find((item) => item.id === id)
    if (connection == null) {
      return { ok: false, status: 'error', message: '连接不存在' }
    }
    const missing = CHANNEL_META[connection.channel].requiredFields.filter((field) => {
      const value = connection.credentials[field]
      return typeof value !== 'string' || value.trim().length === 0
    })
    const status: RemoteConnectionStatus =
      missing.length > 0
        ? 'error'
        : connection.pairedDevices.length > 0
          ? 'connected'
          : 'pending-pairing'
    const patch: Partial<RemoteConnectionConfig> &
      Pick<RemoteConnectionConfig, 'channel' | 'name'> = {
      ...connection,
      status,
      enabled: status !== 'error' ? connection.enabled : false,
    }
    if (missing.length > 0) patch.lastError = `缺少字段：${missing.join(', ')}`
    else delete patch.lastError
    const next = this.save(patch)
    return {
      ok: missing.length === 0,
      status: next.status,
      message:
        missing.length === 0 ? '配置完整，等待远程用户配对' : `缺少字段：${missing.join(', ')}`,
    }
  }

  generatePairing(
    id: string,
    mode: RemotePairingMode,
  ): { connection: RemoteConnectionConfig; pairing: RemotePairingChallenge } {
    const store = this.readStore()
    const connection = store.connections.find((item) => item.id === id)
    if (connection == null) throw new Error('Remote connection not found')
    const expires = new Date(Date.now() + store.global.pairingTtlMinutes * 60_000).toISOString()
    const pairing: RemotePairingChallenge = {
      code: crypto.randomInt(100_000, 999_999).toString(),
      mode,
      expiresAt: expires,
      qrPayload: '',
    }
    pairing.qrPayload = createPairingPayload(connection, pairing)
    const next = this.save({
      ...connection,
      status: 'pending-pairing',
      enabled: true,
      pairing,
    })
    return { connection: next, pairing }
  }

  confirmPairing(input: {
    id: string
    code: string
    remoteUserId: string
    displayName?: string
    channelThreadId?: string
  }): { ok: boolean; connection: RemoteConnectionConfig } {
    const store = this.readStore()
    const connection = store.connections.find((item) => item.id === input.id)
    if (connection == null) throw new Error('Remote connection not found')
    if (connection.pairing == null || connection.pairing.code !== input.code.trim()) {
      throw new Error('Pairing code mismatch')
    }
    if (Date.parse(connection.pairing.expiresAt) < Date.now()) {
      throw new Error('Pairing code expired')
    }
    const device = {
      id: createId('pair'),
      remoteUserId: input.remoteUserId,
      ...(input.displayName != null ? { displayName: input.displayName } : {}),
      ...(input.channelThreadId != null ? { channelThreadId: input.channelThreadId } : {}),
      pairedAt: nowIso(),
      lastSeenAt: nowIso(),
    }
    const next: RemoteConnectionConfig = {
      ...connection,
      enabled: true,
      status: 'connected',
      pairedDevices: [...connection.pairedDevices, device],
      lastConnectedAt: nowIso(),
    }
    delete next.pairing
    delete next.lastError
    this.writeConnections(this.readStore(), next)
    this.emitChange({ reason: 'pairing-updated', connectionId: next.id })
    return { ok: true, connection: next }
  }

  updateConnectionDefaults(
    id: string,
    patch: Partial<
      Pick<
        RemoteConnectionConfig,
        'defaultSessionId' | 'defaultProviderProfileId' | 'defaultModelId' | 'defaultAgentId'
      >
    >,
  ): RemoteConnectionConfig {
    const connection = this.readStore().connections.find((item) => item.id === id)
    if (connection == null) throw new Error('Remote connection not found')
    return this.save({ ...connection, ...patch })
  }

  async sendReply(connectionId: string, externalId: string, text: string): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null) throw new Error('Remote connection not found')
    await this.sendDirectMessage(connection, externalId, text)
  }

  async startRuntime(handler: RemoteInboundHandler): Promise<void> {
    this.inboundHandler = handler
    const store = this.readStore()
    if (!store.global.enabled) {
      await this.stopRuntime()
      return
    }
    await this.ensureWebhookServer(store.global.localWebhookPort)
    this.syncRuntime()
  }

  async stopRuntime(): Promise<void> {
    for (const connectionId of this.pollingStates.keys()) {
      this.stopTelegramPolling(connectionId)
    }
    for (const connectionId of this.feishuWsStates.keys()) {
      this.stopFeishuWs(connectionId)
    }
    this.telegramCommandSignatures.clear()
    if (this.server == null) return
    const server = this.server
    this.server = null
    this.runtimePort = null
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  syncRuntime(): void {
    const store = this.readStore()
    if (!store.global.enabled) {
      void this.stopRuntime()
      return
    }

    const activeTelegramIds = new Set<string>()
    const activeFeishuIds = new Set<string>()
    for (const connection of store.connections) {
      if (!connection.enabled) continue
      if (connection.channel === 'telegram') {
        const token = readString(connection.credentials.botToken)
        if (token == null) continue
        activeTelegramIds.add(connection.id)
        this.startTelegramPolling(connection, token)
        void this.syncTelegramCommands(connection, token)
      } else if (connection.channel === 'feishu') {
        const appId = readString(connection.credentials.appId)
        const appSecret = readString(connection.credentials.appSecret)
        if (appId == null || appSecret == null) continue
        activeFeishuIds.add(connection.id)
        this.startFeishuWs(connection, appId, appSecret)
      }
    }

    for (const connectionId of this.pollingStates.keys()) {
      if (!activeTelegramIds.has(connectionId)) {
        this.stopTelegramPolling(connectionId)
      }
    }
    for (const connectionId of this.feishuWsStates.keys()) {
      if (!activeFeishuIds.has(connectionId)) {
        this.stopFeishuWs(connectionId)
      }
    }
  }

  getRuntimeStatus(): {
    running: boolean
    port: number | null
    localBaseUrl: string | null
    polling: Array<{ connectionId: string; running: boolean; lastError?: string }>
    longConnections: Array<{
      connectionId: string
      channel: 'feishu'
      running: boolean
      lastError?: string
    }>
  } {
    return {
      running: this.server != null,
      port: this.runtimePort,
      localBaseUrl: this.runtimePort != null ? `http://127.0.0.1:${this.runtimePort}` : null,
      polling: Array.from(this.pollingStates.entries()).map(([connectionId, state]) => ({
        connectionId,
        running: state.running,
        ...(state.lastError != null ? { lastError: state.lastError } : {}),
      })),
      longConnections: Array.from(this.feishuWsStates.entries()).map(([connectionId, state]) => ({
        connectionId,
        channel: 'feishu',
        running: state.running,
        ...(state.lastError != null ? { lastError: state.lastError } : {}),
      })),
    }
  }

  private async ensureWebhookServer(preferredPort: number): Promise<void> {
    if (this.server != null) return
    const port =
      Number.isFinite(preferredPort) && preferredPort > 0
        ? preferredPort
        : DEFAULT_GLOBAL.localWebhookPort
    try {
      await this.listenWebhookServer(port)
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code !== 'EADDRINUSE') throw err
      await this.listenWebhookServer(0)
    }
  }

  private async listenWebhookServer(port: number): Promise<void> {
    const server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res).catch((err) => {
        const body = JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(body)
      })
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })

    const address = server.address()
    this.server = server
    this.runtimePort = typeof address === 'object' && address != null ? address.port : port
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    if (req.method === 'GET' && requestUrl.pathname === '/remote/health') {
      this.writeJson(res, 200, { ok: true, ...this.getRuntimeStatus() })
      return
    }

    const match = requestUrl.pathname.match(/^\/remote\/webhook\/([^/]+)\/([^/]+)$/)
    if (req.method !== 'POST' || match == null) {
      this.writeJson(res, 404, { ok: false, error: 'not found' })
      return
    }

    const [, channelRaw, id] = match
    const channel = channelRaw as RemoteChannelType
    const connection = this.readStore().connections.find(
      (item) => item.id === id && item.channel === channel,
    )
    if (connection == null) {
      this.writeJson(res, 404, { ok: false, error: 'remote connection not found' })
      return
    }

    const rawBody = await this.readRequestBody(req)
    const body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
    const responseBody = await this.handleInboundWebhook(connection, body)
    this.writeJson(res, 200, responseBody)
  }

  private async handleInboundWebhook(
    connection: RemoteConnectionConfig,
    body: unknown,
  ): Promise<unknown> {
    const parsed = parseWebhookBody(connection.channel, body)
    if (parsed.kind === 'challenge') return parsed.responseBody
    if (parsed.kind === 'ignore') return { ok: true, ignored: true }
    await this.handleInboundMessage(connection, parsed)
    return { ok: true }
  }

  private async handleInboundMessage(
    connection: RemoteConnectionConfig,
    message: {
      externalId: string
      senderName: string
      text: string
      messageId?: string
    },
  ): Promise<void> {
    if (message.messageId != null) {
      if (this.processedMessages.has(message.messageId)) return
      this.processedMessages.add(message.messageId)
      if (this.processedMessages.size > 2000) {
        this.processedMessages = new Set(Array.from(this.processedMessages).slice(-1000))
      }
    }

    const text = message.text.trim()
    if (text.length === 0) return

    const bindCode = extractBindCode(text)
    if (bindCode != null) {
      await this.confirmInboundPairing(connection, bindCode, message.externalId, message.senderName)
      return
    }

    const latest =
      this.readStore().connections.find((item) => item.id === connection.id) ?? connection
    if (!latest.enabled) return
    if (!this.isAuthorized(latest, message.externalId)) {
      await this.sendDirectMessage(
        latest,
        message.externalId,
        '该远程会话尚未绑定。请先在 SparkWork 设置里生成配对码，然后发送 /bind 配对码。',
      )
      return
    }

    this.markSeen(latest.id, message.externalId)
    await this.sendProcessingFeedback(latest, message.externalId, message.messageId)
    if (this.inboundHandler == null) {
      await this.sendDirectMessage(
        latest,
        message.externalId,
        '远程连接运行时尚未就绪，请稍后重试。',
      )
      return
    }

    try {
      const response = await this.inboundHandler({
        connection: latest,
        externalId: message.externalId,
        senderName: message.senderName,
        text,
        ...(message.messageId != null ? { messageId: message.messageId } : {}),
      })
      if (response != null) {
        await this.sendDirectMessage(
          latest,
          message.externalId,
          `${response.title}\n${response.text}`.trim(),
        )
      }
    } catch (err) {
      await this.sendDirectMessage(
        latest,
        message.externalId,
        `处理失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async confirmInboundPairing(
    connection: RemoteConnectionConfig,
    code: string,
    externalId: string,
    senderName: string,
  ): Promise<void> {
    const latest =
      this.readStore().connections.find((item) => item.id === connection.id) ?? connection
    try {
      this.confirmPairing({
        id: latest.id,
        code,
        remoteUserId: externalId,
        displayName: senderName,
        channelThreadId: externalId,
      })
      await this.sendDirectMessage(
        latest,
        externalId,
        '已绑定 SparkWork。后续消息会进入该连接的默认会话，发送 /help 查看命令。',
      )
    } catch (err) {
      await this.sendDirectMessage(
        latest,
        externalId,
        `绑定失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private isAuthorized(connection: RemoteConnectionConfig, externalId: string): boolean {
    const paired = connection.pairedDevices.some(
      (device) => device.remoteUserId === externalId || device.channelThreadId === externalId,
    )
    if (paired) return true
    if (
      connection.allowedChatIds.includes(externalId) ||
      connection.allowedUserIds.includes(externalId)
    )
      return true
    const global = this.readStore().global
    const hasAllowList =
      connection.allowedChatIds.length > 0 || connection.allowedUserIds.length > 0
    return !global.requirePairing && !hasAllowList
  }

  private markSeen(id: string, externalId: string): void {
    const store = this.readStore()
    const connection = store.connections.find((item) => item.id === id)
    if (connection == null) return
    const timestamp = nowIso()
    const pairedDevices = connection.pairedDevices.map((device) =>
      device.remoteUserId === externalId || device.channelThreadId === externalId
        ? { ...device, lastSeenAt: timestamp }
        : device,
    )
    this.writeConnections(store, {
      ...connection,
      pairedDevices,
      lastConnectedAt: timestamp,
      updatedAt: timestamp,
    })
  }

  private startTelegramPolling(connection: RemoteConnectionConfig, token: string): void {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      this.pollingStates.set(connection.id, {
        offset: 0,
        timer: null,
        token,
        running: false,
        failCount: 0,
        lastError: 'Telegram bot token 格式无效',
      })
      return
    }

    const existing = this.pollingStates.get(connection.id)
    if (existing?.running && existing.token === token) return
    if (existing?.timer != null) clearTimeout(existing.timer)
    const state: TelegramPollingState = {
      offset: existing?.offset ?? 0,
      timer: null,
      token,
      running: true,
      failCount: 0,
    }
    this.pollingStates.set(connection.id, state)

    const loop = () => {
      void this.pollTelegramOnce(connection.id, state).finally(() => {
        if (this.pollingStates.get(connection.id) !== state) return
        const delay = state.failCount > 0 ? Math.min(2 ** state.failCount * 1000, 30_000) : 1000
        state.timer = setTimeout(loop, delay)
      })
    }
    loop()
  }

  private stopTelegramPolling(connectionId: string): void {
    const state = this.pollingStates.get(connectionId)
    if (state?.timer != null) clearTimeout(state.timer)
    this.pollingStates.delete(connectionId)
    this.telegramCommandSignatures.delete(connectionId)
  }

  private startFeishuWs(
    connection: RemoteConnectionConfig,
    appId: string,
    appSecret: string,
  ): void {
    const existing = this.feishuWsStates.get(connection.id)
    if (existing?.running && existing.appId === appId && existing.appSecret === appSecret) return
    this.stopFeishuWs(connection.id)
    const state: FeishuWsState = {
      appId,
      appSecret,
      running: false,
      startedAt: Date.now(),
    }
    this.feishuWsStates.set(connection.id, state)
    void this.runFeishuWs(connection.id, state)
  }

  private stopFeishuWs(connectionId: string): void {
    const state = this.feishuWsStates.get(connectionId)
    try {
      state?.client?.close()
    } catch {
      // 飞书 SDK close 失败不影响本地状态清理。
    }
    this.feishuWsStates.delete(connectionId)
  }

  private async runFeishuWs(connectionId: string, state: FeishuWsState): Promise<void> {
    try {
      const larkModule = await import('@larksuiteoapi/node-sdk')
      const lark = (larkModule.default ?? larkModule) as {
        WSClient: new (options: {
          appId: string
          appSecret: string
          onReady?: () => void
          onReconnecting?: () => void
          onReconnected?: () => void
          onError?: (error: unknown) => void
        }) => { start: (input: { eventDispatcher: unknown }) => Promise<void>; close: () => void }
        EventDispatcher: new (options: Record<string, unknown>) => {
          register: (
            handlers: Record<string, (data: FeishuMessageReceiveEvent) => Promise<void>>,
          ) => unknown
        }
      }
      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (event) => {
          await this.handleFeishuWsEvent(connectionId, state, event)
        },
      })
      const client = new lark.WSClient({
        appId: state.appId,
        appSecret: state.appSecret,
        onReady: () => {
          state.running = true
          delete state.lastError
          this.emitChange({ reason: 'runtime-updated', connectionId })
        },
        onReconnecting: () => {
          state.running = false
        },
        onReconnected: () => {
          state.running = true
          delete state.lastError
          this.emitChange({ reason: 'runtime-updated', connectionId })
        },
        onError: (error) => {
          state.running = false
          state.lastError = error instanceof Error ? error.message : String(error)
          this.emitChange({ reason: 'runtime-updated', connectionId })
        },
      })
      state.client = client
      await client.start({ eventDispatcher: dispatcher })
      state.running = true
      delete state.lastError
      this.emitChange({ reason: 'runtime-updated', connectionId })
    } catch (err) {
      state.running = false
      state.lastError = err instanceof Error ? err.message : String(err)
      this.emitChange({ reason: 'runtime-updated', connectionId })
    }
  }

  private async handleFeishuWsEvent(
    connectionId: string,
    state: FeishuWsState,
    event: FeishuMessageReceiveEvent,
  ): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null || !connection.enabled || connection.channel !== 'feishu') return
    const message = event.message
    if (message?.chat_id == null) return
    if (event.sender?.sender_type != null && event.sender.sender_type !== 'user') return
    if (message.message_type === 'interactive') return
    const createdAt = parseFeishuMessageTimestamp(message.create_time)
    if (createdAt != null && createdAt < state.startedAt - 60_000) return

    const text = parseJsonContent(message.content) ?? ''
    const normalized = normalizeInboundText('feishu', text)
    if (normalized.length === 0) return
    await this.handleInboundMessage(connection, {
      externalId: message.chat_id,
      senderName: event.sender?.sender_id?.open_id ?? '飞书用户',
      text: normalized,
      ...(message.message_id != null ? { messageId: `feishu:${message.message_id}` } : {}),
    })
  }

  private async pollTelegramOnce(connectionId: string, state: TelegramPollingState): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null || !connection.enabled || connection.channel !== 'telegram') {
      this.stopTelegramPolling(connectionId)
      return
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(state.token)}/getUpdates?offset=${state.offset}&timeout=25&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`,
      )
      if (response.status === 401 || response.status === 404) {
        state.running = false
        state.lastError = 'Telegram token 无效'
        this.stopTelegramPolling(connectionId)
        return
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Telegram polling failed: ${response.status} ${text.slice(0, 200)}`)
      }
      const payload = (await response.json()) as {
        ok?: boolean
        result?: Array<{ update_id: number; message?: unknown }>
      }
      if (payload.ok === false) throw new Error('Telegram getUpdates returned ok=false')
      state.failCount = 0
      delete state.lastError
      for (const update of payload.result ?? []) {
        if (update.message != null) {
          await this.handleInboundWebhook(connection, { message: update.message })
        }
        state.offset = update.update_id + 1
      }
    } catch (err) {
      state.failCount += 1
      state.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  private async syncTelegramCommands(
    connection: RemoteConnectionConfig,
    token: string,
  ): Promise<void> {
    const signature = JSON.stringify(connection.telegramCommands)
    if (this.telegramCommandSignatures.get(connection.id) === signature) return
    const catalog = new Map(COMMAND_CATALOG.map((cmd) => [cmd.name, cmd]))
    const commands = connection.telegramCommands
      .map((name) => catalog.get(name.replace(/^\//, '')))
      .filter((cmd): cmd is RemoteCommandDefinition => cmd != null)
      .map((cmd) => ({
        command: cmd.name,
        description: cmd.description.slice(0, 256),
      }))
    if (commands.length === 0) return
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/setMyCommands`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commands }),
        },
      )
      if (response.ok) this.telegramCommandSignatures.set(connection.id, signature)
    } catch {
      // 命令同步失败不影响消息桥接。
    }
  }

  private async sendDirectMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    text: string,
  ): Promise<void> {
    if (connection.channel === 'telegram') {
      await this.sendTelegramMessage(connection, externalId, text)
      return
    }
    if (connection.channel === 'feishu') {
      await this.sendFeishuMessage(connection, externalId, text)
      return
    }
    if (connection.channel === 'qq') {
      await this.sendQqMessage(connection, externalId, text)
      return
    }
    await this.sendClawMessage(connection, externalId, text)
  }

  private async sendTelegramMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    text: string,
  ): Promise<void> {
    const token = readString(connection.credentials.botToken)
    if (token == null) throw new Error('Telegram bot token 未配置')
    for (const chunk of splitText(text, 3900)) {
      await this.postJson(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
        chat_id: externalId,
        text: chunk,
        disable_web_page_preview: true,
      })
    }
  }

  private async sendTelegramChatAction(
    connection: RemoteConnectionConfig,
    externalId: string,
    action:
      | 'typing'
      | 'upload_photo'
      | 'record_video'
      | 'upload_video'
      | 'record_voice'
      | 'upload_voice'
      | 'upload_document'
      | 'find_location'
      | 'record_video_note'
      | 'upload_video_note'
      | 'choose_sticker' = 'typing',
  ): Promise<void> {
    const token = readString(connection.credentials.botToken)
    if (token == null) return
    try {
      await this.postJson(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendChatAction`,
        {
          chat_id: externalId,
          action,
        },
      )
    } catch {
      // Chat action 发送失败不阻断主流程
    }
  }

  private async sendFeishuMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    text: string,
  ): Promise<void> {
    const appId = readString(connection.credentials.appId)
    const appSecret = readString(connection.credentials.appSecret)
    if (appId == null || appSecret == null) throw new Error('飞书 App ID 或 App Secret 未配置')
    const token = await this.getFeishuToken(connection.id, appId, appSecret)
    const receiveIdType = resolveFeishuReceiveIdType(externalId)
    await this.postJson(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        receive_id: externalId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      { Authorization: `Bearer ${token}` },
    )
  }

  private async sendProcessingFeedback(
    connection: RemoteConnectionConfig,
    externalId: string,
    messageId?: string,
  ): Promise<void> {
    if (connection.channel === 'telegram') {
      await this.sendTelegramChatAction(connection, externalId, 'typing')
    }
    if (connection.channel === 'feishu' && messageId != null) {
      const feishuMessageId = messageId.replace(/^feishu:/, '')
      if (feishuMessageId.length === 0) return
      const appId = readString(connection.credentials.appId)
      const appSecret = readString(connection.credentials.appSecret)
      if (appId == null || appSecret == null) return
      try {
        const token = await this.getFeishuToken(connection.id, appId, appSecret)
        await this.postJson(
          `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(feishuMessageId)}/reactions`,
          {
            reaction_type: { emoji_type: 'Typing' },
          },
          { Authorization: `Bearer ${token}` },
        )
      } catch {
        // 反馈表情失败只影响体验，不阻断消息处理。
      }
    }
  }

  private async sendQqMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    text: string,
  ): Promise<void> {
    const appId = readString(connection.credentials.qqBotAppId)
    const clientSecret = readString(connection.credentials.qqBotSecret)
    if (appId == null || clientSecret == null) throw new Error('QQ 机器人 AppID 或 AppSecret 未配置')
    const token = await this.getQqToken(connection.id, appId, clientSecret)
    await this.postJson(
      `https://api.sgroup.qq.com/v2/groups/${encodeURIComponent(externalId)}/messages`,
      {
        msg_type: 0,
        content: plainText(text).slice(0, 1900),
      },
      { Authorization: `QQBot ${token}` },
    )
  }

  private async sendClawMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    text: string,
  ): Promise<void> {
    const endpoint = readString(connection.credentials.clawEndpoint)
    if (endpoint == null) throw new Error('Claw Endpoint 未配置')
    const token = readString(connection.credentials.clawAccessToken)
    const baseUrl = endpoint.replace(/\/+$/, '')
    const headers = token != null ? { Authorization: `Bearer ${token}` } : undefined
    try {
      await this.postJson(`${baseUrl}/send`, { chatId: externalId, text }, headers)
    } catch (err) {
      await this.postJson(`${baseUrl}/message`, { chatId: externalId, text }, headers).catch(() => {
        throw err
      })
    }
  }

  private async getFeishuToken(
    connectionId: string,
    appId: string,
    appSecret: string,
  ): Promise<string> {
    const cacheKey = `feishu:${connectionId}`
    const cached = this.readCachedToken(cacheKey)
    if (cached != null) return cached
    const data = (await this.postJson(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: appId,
        app_secret: appSecret,
      },
    )) as { tenant_access_token?: string; expire?: number }
    if (data.tenant_access_token == null) throw new Error('飞书 token 响应缺少 tenant_access_token')
    this.writeCachedToken(cacheKey, data.tenant_access_token, data.expire ?? 3600)
    return data.tenant_access_token
  }

  private async getQqToken(
    connectionId: string,
    appId: string,
    clientSecret: string,
  ): Promise<string> {
    const cacheKey = `qq:${connectionId}`
    const cached = this.readCachedToken(cacheKey)
    if (cached != null) return cached
    const data = (await this.postJson('https://bots.qq.com/app/getAppAccessToken', {
      appId,
      clientSecret,
    })) as { access_token?: string; expires_in?: string | number }
    if (data.access_token == null) throw new Error('QQ token 响应缺少 access_token')
    const expires =
      typeof data.expires_in === 'string' ? Number.parseInt(data.expires_in, 10) : data.expires_in
    this.writeCachedToken(
      cacheKey,
      data.access_token,
      Number.isFinite(expires) ? Number(expires) : 3600,
    )
    return data.access_token
  }

  private readCachedToken(cacheKey: string): string | null {
    const entry = this.tokenCache.get(cacheKey)
    if (entry == null) return null
    if (Date.now() >= entry.expiresAt) {
      this.tokenCache.delete(cacheKey)
      return null
    }
    return entry.token
  }

  private writeCachedToken(cacheKey: string, token: string, expiresInSeconds: number): void {
    this.tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + Math.max(expiresInSeconds - 60, 60) * 1000,
    })
  }

  private async postJson(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      throw new Error(`${url} failed: ${response.status} ${text.slice(0, 200)}`)
    }
    if (text.length === 0) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { text }
    }
  }

  private async readRequestBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (Buffer.concat(chunks).length > 2_000_000) {
        throw new Error('request body too large')
      }
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  private readStore(): RemoteConnectionStore {
    const raw = this.settingsService.get(SETTINGS_CATEGORY, SETTINGS_KEY)
    if (!isRecord(raw)) return { global: { ...DEFAULT_GLOBAL }, connections: [] }
    const global = isRecord(raw.global)
      ? { ...DEFAULT_GLOBAL, ...raw.global }
      : { ...DEFAULT_GLOBAL }
    const connections = Array.isArray(raw.connections)
      ? raw.connections
          .map(sanitizeConnection)
          .filter((item): item is RemoteConnectionConfig => item != null)
      : []
    return { global, connections }
  }

  private writeConnections(store: RemoteConnectionStore, connection: RemoteConnectionConfig): void {
    const exists = store.connections.some((item) => item.id === connection.id)
    const connections = exists
      ? store.connections.map((item) => (item.id === connection.id ? connection : item))
      : [connection, ...store.connections]
    this.writeStore({ ...store, connections })
  }

  private writeStore(store: RemoteConnectionStore): void {
    this.settingsService.set(SETTINGS_CATEGORY, SETTINGS_KEY, store)
  }

  private emitChange(event: RemoteConnectionChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event)
      } catch {
        // 单个监听器失败不影响远程连接运行时。
      }
    }
  }
}
