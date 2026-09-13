import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { URL } from 'node:url'
import type { SettingsService } from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import { DEFAULT_TELEGRAM_REMOTE_COMMANDS } from '@spark/protocol'
import type {
  RemoteChannelType,
  RemoteCommandDefinition,
  RemoteConnectionCapabilities,
  RemoteConnectionConfig,
  RemoteConnectionGlobalSettings,
  RemoteConnectionStatus,
  RemoteCreateBotDraftResponse,
  RemoteMessageAction as ProtocolRemoteMessageAction,
  RemotePairingChallenge,
  RemotePairingMode,
  RemoteTestResponse,
  SessionAttachment,
} from '@spark/protocol'
import { QqBotGateway } from './QqBotGateway.js'
import { getAuthService } from './Auth/AuthService.js'
import {
  downloadTelegramInboundImage,
  extractTelegramInboundImages,
  type TelegramInboundImageDescriptor,
} from './telegramInboundMedia.js'
import {
  extractTelegramOutboundMedia,
  mergeTelegramOutboundImages,
  sendTelegramOutboundImage,
} from './telegramOutboundMedia.js'
import { formatTelegramMarkdown, isTelegramFormattingError } from './telegramTextFormatting.js'
import {
  downloadFeishuImage,
  extractFeishuInboundImage,
  uploadFeishuImage,
  type FeishuInboundImage,
} from './feishuImageMedia.js'
import { downloadQqImage, uploadQqImage, type QqInboundImage } from './qqImageMedia.js'
import { readOutboundImage } from './remoteImageMedia.js'
import {
  canShareRemoteSession,
  remoteConnectionsForSession,
  remoteRouteKey,
} from './remoteSessionIsolation.js'
import {
  TelegramTurnFeedbackManager,
  type TelegramTurnDraftUpdate,
} from './telegramTurnFeedback.js'
import {
  buildQqExternalId,
  parseQqDispatchEvent,
  parseQqExternalId,
  splitQqContent,
  type QqInboundMessage,
} from './qqProtocol.js'

const SETTINGS_CATEGORY = 'remote-connections'
const log = createLogger('remote-connections')
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
  attachments?: SessionAttachment[]
}

export type RemoteMessageAction = ProtocolRemoteMessageAction

export type RemoteInboundResponse = {
  title: string
  text: string
  actions?: RemoteMessageAction[]
}

export type RemoteInboundHandler = (
  message: RemoteInboundMessage,
) => Promise<RemoteInboundResponse | void>

type RemoteOutboundMessage = {
  title?: string
  text: string
  actions?: RemoteMessageAction[]
  images?: Array<{ source: string; alt: string }>
}

function buildRemoteRuntimeErrorMessage(error: unknown, commandPrefix = '/'): string {
  const message = (error instanceof Error ? error.message : String(error)).trim().slice(0, 1000)
  const prefix = commandPrefix.trim() || '/'
  return `处理失败：${message || '未知错误'}\n\n建议：发送 ${prefix}status 查看连接状态，发送 ${prefix}help 查看可用命令；如果问题与模型有关，请依次使用 ${prefix}providers、${prefix}models、${prefix}use-model。`
}

function formatRemoteOutboundText(message: RemoteOutboundMessage): string {
  return message.title != null ? `${message.title}\n${message.text}` : message.text
}

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

type FeishuCardActionReceiveEvent = {
  action?: {
    value?: unknown
  }
  open_chat_id?: string
  chat_id?: string
  operator?: {
    operator_id?: {
      open_id?: string
      user_id?: string
    }
  }
  token?: string
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
  approvePermissions: true,
  observeDesktop: true,
  controlDesktop: false,
  useInternalBrowser: false,
  transferFiles: false,
  manageRuntime: true,
  dangerousActions: false,
}

const COMMAND_CATALOG: RemoteCommandDefinition[] = [
  { name: 'help', usage: '/help', description: '查看远程可用命令', capability: 'system' },
  {
    name: 'sessions',
    usage: '/sessions [all|idle|running|error] [页码]',
    description: '查看并切换会话',
    capability: 'switchSession',
  },
  {
    name: 'use-session',
    usage: '/use-session <序号|名称|sessionId>',
    description: '切换默认会话',
    capability: 'switchSession',
  },
  {
    name: 'models',
    usage: '/models [页码]',
    description: '列出当前渠道的可用模型',
    capability: 'switchModel',
  },
  {
    name: 'use-model',
    usage: '/use-model <序号|名称|modelId>',
    description: '切换当前会话或连接默认模型',
    capability: 'switchModel',
  },
  {
    name: 'providers',
    usage: '/providers [页码]',
    description: '列出 Provider（兼容命令）',
    capability: 'switchModel',
  },
  {
    name: 'use-provider',
    usage: '/use-provider <序号|名称|providerProfileId>',
    description: '切换当前会话或连接默认 Provider',
    capability: 'switchModel',
  },
  {
    name: 'channels',
    usage: '/channels [页码]',
    description: '列出可用模型渠道',
    capability: 'switchModel',
  },
  {
    name: 'use-channel',
    usage: '/use-channel <序号|名称|渠道ID>',
    description: '切换当前会话的模型渠道',
    capability: 'switchModel',
  },
  { name: 'agents', usage: '/agents [页码]', description: '列出 Agent', capability: 'switchAgent' },
  {
    name: 'use-agent',
    usage: '/use-agent <序号|名称|agentId>',
    description: '切换当前会话或连接默认 Agent',
    capability: 'switchAgent',
  },
  {
    name: 'workspaces',
    usage: '/workspaces [页码]',
    description: '列出项目（兼容命令）',
    capability: 'manageWorkspace',
  },
  {
    name: 'projects',
    usage: '/projects [页码]',
    description: '列出项目',
    capability: 'manageWorkspace',
  },
  {
    name: 'use-project',
    usage: '/use-project <序号|名称|项目ID>',
    description: '切换默认项目',
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
    description: '添加本地项目（兼容命令）',
    capability: 'manageWorkspace',
  },
  {
    name: 'add-project',
    usage: '/add-project <path>',
    description: '添加本地项目',
    capability: 'manageWorkspace',
  },
  {
    name: 'reasoning',
    usage: '/reasoning',
    description: '选择推理强度',
    capability: 'manageRuntime',
  },
  {
    name: 'use-reasoning',
    usage: '/use-reasoning <minimal|low|medium|high|xhigh|max>',
    description: '切换推理强度',
    capability: 'manageRuntime',
  },
  {
    name: 'permissions',
    usage: '/permissions',
    description: '选择权限模式',
    capability: 'approvePermissions',
  },
  {
    name: 'use-permission',
    usage: '/use-permission <manual|auto|plan|full>',
    description: '切换权限模式',
    capability: 'approvePermissions',
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
      '可选：在 Telegram 命令配置中同步 /help、/projects、/sessions、/channels、/models。',
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
      '在 QQ 开放平台创建机器人，并在管理端申请开通「群聊」与「单聊」消息能力。',
      '复制机器人 AppID 和 AppSecret 到连接配置。',
      'SparkWork 通过 QQ 官方 WebSocket 长连接接收消息，无需公网地址。',
      '单聊：在 QQ 里搜索机器人加好友即可直接私聊；群聊：把机器人拉进群后 @机器人 发消息。',
      '生成配对码后在 QQ 里发送 /bind <配对码> 完成绑定。',
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

function isRemotePermissionMode(
  value: unknown,
): value is NonNullable<RemoteConnectionConfig['defaultPermissionMode']> {
  return [
    'claude-ask',
    'claude-auto-edits',
    'claude-plan',
    'claude-auto',
    'claude-bypass',
    'codex-default',
    'codex-auto-review',
    'codex-full-access',
    'spark-default',
    'spark-accept-edits',
    'spark-plan',
    'spark-bypass',
    'spark-auto',
  ].includes(String(value))
}

function isRemoteReasoningEffort(
  value: unknown,
): value is NonNullable<RemoteConnectionConfig['defaultReasoningEffort']> {
  return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(value))
}

function defaultTelegramCommands(): string[] {
  return [...DEFAULT_TELEGRAM_REMOTE_COMMANDS]
}

export function buildTelegramBotCommands(
  connection: Pick<RemoteConnectionConfig, 'telegramCommands' | 'capabilities'>,
): Array<{ command: string; description: string }> {
  const catalog = new Map(COMMAND_CATALOG.map((cmd) => [cmd.name, cmd]))
  const seen = new Set<string>()
  const commands: Array<{ command: string; description: string }> = []

  for (const configuredName of connection.telegramCommands) {
    const canonicalName = configuredName.trim().replace(/^\/+/, '').toLowerCase().replace(/_/g, '-')
    const definition = catalog.get(canonicalName)
    if (definition == null) continue
    if (
      definition.capability !== 'system' &&
      connection.capabilities[definition.capability] !== true
    ) {
      continue
    }
    const command = definition.name.replace(/-/g, '_')
    if (seen.has(command)) continue
    seen.add(command)
    commands.push({ command, description: definition.description.slice(0, 256) })
  }

  return commands
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

function extractBindCode(text: string, commandPrefix = '/'): string | null {
  const prefix = commandPrefix.trim() || '/'
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.trim().match(new RegExp(`^${escapedPrefix}bind\\s+([A-Z0-9]{6,12})$`, 'i'))
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

export function parseWebhookBody(
  channel: RemoteChannelType,
  body: unknown,
):
  | {
      kind: 'message'
      externalId: string
      senderName: string
      text: string
      messageId?: string
      inboundImages?: TelegramInboundImageDescriptor[]
      feishuImage?: FeishuInboundImage
      qqImages?: QqInboundImage[]
    }
  | { kind: 'challenge'; responseBody: unknown }
  | { kind: 'ignore' } {
  if (!isRecord(body)) return { kind: 'ignore' }

  if (channel === 'telegram') {
    const callback = isRecord(body.callback_query) ? body.callback_query : undefined
    const callbackMessage = isRecord(callback?.message) ? callback.message : undefined
    const callbackChat = isRecord(callbackMessage?.chat) ? callbackMessage.chat : undefined
    const callbackFrom = isRecord(callback?.from) ? callback.from : undefined
    const callbackText = readString(callback?.data)
    if (callback != null && callbackChat != null && callbackText != null) {
      const externalId = String(callbackChat.id ?? '')
      if (externalId.length === 0) return { kind: 'ignore' }
      const username = readString(callbackFrom?.username)
      const firstName = readString(callbackFrom?.first_name)
      return {
        kind: 'message',
        externalId,
        senderName:
          username != null
            ? `${firstName ?? username}(@${username})`
            : (firstName ?? 'Telegram 用户'),
        text: normalizeInboundText(channel, callbackText),
        ...(callback.id != null ? { messageId: `telegram:callback:${String(callback.id)}` } : {}),
      }
    }
    const message = isRecord(body.message) ? body.message : undefined
    const chat = isRecord(message?.chat) ? message.chat : undefined
    const from = isRecord(message?.from) ? message.from : undefined
    const externalId = chat != null ? String(chat.id ?? '') : ''
    const inboundImages = message != null ? extractTelegramInboundImages(message) : []
    const text = readString(message?.text) ?? readString(message?.caption)
    if (!externalId || (text == null && inboundImages.length === 0)) return { kind: 'ignore' }
    const username = readString(from?.username)
    const firstName = readString(from?.first_name)
    return {
      kind: 'message',
      externalId,
      senderName:
        username != null
          ? `${firstName ?? username}(@${username})`
          : (firstName ?? 'Telegram 用户'),
      text: normalizeInboundText(channel, text ?? '请识别并说明这张图片。'),
      ...(inboundImages.length > 0 ? { inboundImages } : {}),
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
    const feishuImage = extractFeishuInboundImage({
      message_id: readString(message.message_id),
      message_type: readString(message.message_type),
      content: readString(message.content),
    })
    const text = parseJsonContent(message.content) ?? readString(message.text)
    if (!externalId || (!text && feishuImage == null)) return { kind: 'ignore' }
    const sender = isRecord(event.sender) ? event.sender : undefined
    const senderId = isRecord(sender?.sender_id) ? sender.sender_id : undefined
    return {
      kind: 'message',
      externalId,
      senderName: readString(senderId?.open_id) ?? readString(senderId?.user_id) ?? '飞书用户',
      text: normalizeInboundText(channel, text ?? '请识别并说明这张图片。'),
      ...(feishuImage != null ? { feishuImage } : {}),
      ...(readString(message.message_id)
        ? { messageId: `feishu:${String(message.message_id)}` }
        : {}),
    }
  }

  if (channel === 'qq') {
    const event = parseQqDispatchEvent(
      isRecord(body) ? readString(body.t) : undefined,
      isRecord(body) && isRecord(body.d) ? body.d : body,
    )
    if (event == null || (event.text.length === 0 && (event.images?.length ?? 0) === 0))
      return { kind: 'ignore' }
    return {
      kind: 'message',
      externalId: buildQqExternalId(event.scene, event.targetId),
      senderName: event.senderName,
      text: event.text,
      ...(event.images != null ? { qqImages: event.images } : {}),
      ...(event.msgId != null ? { messageId: `qq:${event.msgId}` } : {}),
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

function chunkActions<T>(actions: T[], size = 2): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < actions.length; index += size) {
    rows.push(actions.slice(index, index + size))
  }
  return rows
}

export function buildFeishuCard(message: RemoteOutboundMessage): Record<string, unknown> {
  const actions = message.actions ?? []
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: (message.title ?? 'SparkWork').slice(0, 80),
      },
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: message.text.slice(0, 10_000) },
      },
      ...chunkActions(actions, 3).map((row) => ({
        tag: 'action',
        actions: row.map((action) => ({
          tag: 'button',
          text: { tag: 'plain_text', content: action.label.slice(0, 30) },
          type: action.style ?? 'default',
          value: { command: action.command },
        })),
      })),
    ],
  }
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
    ...(typeof input.allowSharedSession === 'boolean'
      ? { allowSharedSession: input.allowSharedSession }
      : {}),
    ...(typeof input.defaultWorkspaceId === 'string'
      ? { defaultWorkspaceId: input.defaultWorkspaceId }
      : {}),
    ...(typeof input.defaultProviderProfileId === 'string'
      ? { defaultProviderProfileId: input.defaultProviderProfileId }
      : {}),
    ...(typeof input.defaultModelId === 'string' ? { defaultModelId: input.defaultModelId } : {}),
    ...(typeof input.defaultAgentId === 'string' ? { defaultAgentId: input.defaultAgentId } : {}),
    ...(isRemotePermissionMode(input.defaultPermissionMode)
      ? { defaultPermissionMode: input.defaultPermissionMode }
      : {}),
    ...(isRemoteReasoningEffort(input.defaultReasoningEffort)
      ? { defaultReasoningEffort: input.defaultReasoningEffort }
      : {}),
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
  private qqGateways = new Map<string, QqBotGateway>()
  private processedMessages = new Set<string>()
  private tokenCache = new Map<string, TokenCacheEntry>()
  private telegramCommandSignatures = new Map<string, string>()
  private telegramCallbackActions = new Map<
    string,
    { connectionId: string; command: string; expiresAt: number }
  >()
  // QQ 群聊/单聊被动回复需要引用触发消息的 msg_id（5 分钟窗口、同一 msg_id 至多 5 条）。
  private qqReplyContexts = new Map<
    string,
    { msgId: string; sentCount: number; expiresAt: number }
  >()
  private changeListeners = new Set<(event: RemoteConnectionChangeEvent) => void>()
  private readonly telegramTurnFeedback: TelegramTurnFeedbackManager

  constructor(
    private readonly settingsService: SettingsService,
    private readonly telegramAttachmentRoot?: string,
  ) {
    this.telegramTurnFeedback = new TelegramTurnFeedbackManager({
      sendTyping: async (connectionId, externalId) => {
        const connection = this.readStore().connections.find((item) => item.id === connectionId)
        if (connection?.channel !== 'telegram') return
        await this.sendTelegramChatAction(connection, externalId, 'typing')
      },
      sendPreview: async (connectionId, externalId, text) => {
        const connection = this.readStore().connections.find((item) => item.id === connectionId)
        if (connection?.channel !== 'telegram') throw new Error('Telegram connection unavailable')
        const token = readString(connection.credentials.botToken)
        if (token == null) throw new Error('Telegram bot token 未配置')
        const response = await this.postTelegramFormattedText(
          `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
          { chat_id: externalId, disable_web_page_preview: true },
          text,
        )
        const messageId = (response as { result?: { message_id?: unknown } }).result?.message_id
        if (!Number.isSafeInteger(messageId)) throw new Error('Telegram preview message ID missing')
        return messageId as number
      },
      editPreview: async (connectionId, externalId, messageId, text) => {
        const connection = this.readStore().connections.find((item) => item.id === connectionId)
        if (connection?.channel !== 'telegram') throw new Error('Telegram connection unavailable')
        const token = readString(connection.credentials.botToken)
        if (token == null) throw new Error('Telegram bot token 未配置')
        await this.postTelegramFormattedText(
          `https://api.telegram.org/bot${encodeURIComponent(token)}/editMessageText`,
          {
            chat_id: externalId,
            message_id: messageId,
            disable_web_page_preview: true,
          },
          text,
        )
      },
    })
  }

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
    patch: Omit<Partial<RemoteConnectionConfig>, 'defaultSessionId'> &
      Pick<RemoteConnectionConfig, 'channel' | 'name'> & {
        defaultSessionId?: string | null
      },
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
    const next = {
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
    const sessionConflicts = remoteConnectionsForSession(
      store.connections,
      sanitized.defaultSessionId,
      sanitized.id,
    )
    const isEnablingShareForExistingBinding =
      existing?.defaultSessionId === sanitized.defaultSessionId &&
      sanitized.allowSharedSession === true &&
      patch.allowSharedSession === true
    if (
      sessionConflicts.length > 0 &&
      !canShareRemoteSession(sanitized, sessionConflicts) &&
      !isEnablingShareForExistingBinding
    ) {
      throw new Error(
        `会话已绑定到远程连接“${sessionConflicts.map((item) => item.name).join('、')}”。为避免渠道、历史和运行配置混淆，请选择其他会话；如确需共享，请先在所有相关连接中开启“跨连接共享会话”。`,
      )
    }
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
    patch: Omit<
      Partial<
        Pick<
          RemoteConnectionConfig,
          | 'defaultSessionId'
          | 'allowSharedSession'
          | 'defaultWorkspaceId'
          | 'defaultProviderProfileId'
          | 'defaultModelId'
          | 'defaultAgentId'
          | 'defaultPermissionMode'
          | 'defaultReasoningEffort'
        >
      >,
      'defaultWorkspaceId'
    > & {
      defaultWorkspaceId?: string | null
    },
  ): RemoteConnectionConfig {
    const connection = this.readStore().connections.find((item) => item.id === id)
    if (connection == null) throw new Error('Remote connection not found')
    const { defaultWorkspaceId, ...rest } = patch
    const next: RemoteConnectionConfig = { ...connection, ...rest }
    if (defaultWorkspaceId === null) delete next.defaultWorkspaceId
    else if (defaultWorkspaceId != null) next.defaultWorkspaceId = defaultWorkspaceId
    const store = this.readStore()
    const conflicts = remoteConnectionsForSession(store.connections, next.defaultSessionId, next.id)
    if (conflicts.length > 0 && !canShareRemoteSession(next, conflicts)) {
      throw new Error(
        `会话已绑定到远程连接“${conflicts.map((item) => item.name).join('、')}”。请选择其他会话，或先在所有相关连接中开启“跨连接共享会话”。`,
      )
    }
    return this.save(next)
  }

  async sendReply(
    connectionId: string,
    externalId: string,
    text: string,
    attachments?: SessionAttachment[],
  ): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null) throw new Error('Remote connection not found')
    await this.sendDirectMessage(connection, externalId, {
      text,
      ...(attachments != null && attachments.length > 0
        ? {
            images: attachments
              .filter((attachment) => attachment.type === 'image')
              .map((attachment) => ({ source: attachment.path, alt: '' })),
          }
        : {}),
    })
  }

  startTurnFeedback(turnId: string, connectionId: string, externalId: string): void {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection?.channel !== 'telegram') return
    this.telegramTurnFeedback.start(turnId, connectionId, externalId)
  }

  updateTurnFeedback(turnId: string, update: TelegramTurnDraftUpdate): void {
    this.telegramTurnFeedback.update(turnId, update)
  }

  async finishTurnFeedback(turnId: string, finalText?: string): Promise<boolean> {
    return this.telegramTurnFeedback.finish(turnId, finalText)
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
    await this.telegramTurnFeedback.stopAll()
    for (const connectionId of this.pollingStates.keys()) {
      this.stopTelegramPolling(connectionId)
    }
    for (const connectionId of this.feishuWsStates.keys()) {
      this.stopFeishuWs(connectionId)
    }
    for (const connectionId of this.qqGateways.keys()) {
      this.stopQqGateway(connectionId)
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
    const activeQqIds = new Set<string>()
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
      } else if (connection.channel === 'qq') {
        const appId = readString(connection.credentials.qqBotAppId)
        const clientSecret = readString(connection.credentials.qqBotSecret)
        if (appId == null || clientSecret == null) continue
        activeQqIds.add(connection.id)
        this.startQqGateway(connection, appId, clientSecret)
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
    for (const connectionId of this.qqGateways.keys()) {
      if (!activeQqIds.has(connectionId)) {
        this.stopQqGateway(connectionId)
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
      channel: 'feishu' | 'qq'
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
      longConnections: [
        ...Array.from(this.feishuWsStates.entries()).map(([connectionId, state]) => ({
          connectionId,
          channel: 'feishu' as const,
          running: state.running,
          ...(state.lastError != null ? { lastError: state.lastError } : {}),
        })),
        ...Array.from(this.qqGateways.entries()).map(([connectionId, gateway]) => ({
          connectionId,
          channel: 'qq' as const,
          running: gateway.getStatus().running,
          ...(gateway.getStatus().lastError != null
            ? { lastError: gateway.getStatus().lastError }
            : {}),
        })),
      ],
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
    const parsed = parseWebhookBody(
      connection.channel,
      connection.channel === 'telegram' ? this.expandTelegramCallback(connection, body) : body,
    )
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
      inboundImages?: TelegramInboundImageDescriptor[]
      feishuImage?: FeishuInboundImage
      qqImages?: QqInboundImage[]
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

    const bindCode = extractBindCode(text, connection.commandPrefix)
    if (bindCode != null) {
      await this.confirmInboundPairing(connection, bindCode, message.externalId, message.senderName)
      return
    }

    const latest =
      this.readStore().connections.find((item) => item.id === connection.id) ?? connection
    if (!latest.enabled) return
    if (!this.isAuthorized(latest, message.externalId)) {
      const prefix = latest.commandPrefix.trim() || '/'
      await this.sendDirectMessage(
        latest,
        message.externalId,
        `该远程会话尚未绑定。请先在 SparkWork 设置里生成配对码，然后发送 ${prefix}bind <配对码>。配对失败时请重新生成未过期的配对码。`,
      )
      return
    }

    this.markSeen(latest.id, message.externalId)
    await this.sendProcessingFeedback(latest, message.externalId, message.messageId)
    let attachments: SessionAttachment[] | undefined
    if (
      (message.inboundImages?.length ?? 0) > 0 ||
      message.feishuImage != null ||
      (message.qqImages?.length ?? 0) > 0
    ) {
      if (!latest.capabilities.transferFiles) {
        await this.sendDirectMessage(
          latest,
          message.externalId,
          '该连接未启用“传输文件”能力，无法接收图片。请在 SparkWork 的远程连接设置中开启后重试。',
        )
        return
      }
      const attachmentRoot = this.telegramAttachmentRoot
      if (attachmentRoot == null) {
        await this.sendDirectMessage(
          latest,
          message.externalId,
          '图片接收运行时尚未就绪，请稍后重试。',
        )
        return
      }
      try {
        if (latest.channel === 'telegram') {
          const token = readString(latest.credentials.botToken)
          if (token == null) throw new Error('Telegram bot token 未配置')
          attachments = await Promise.all(
            (message.inboundImages ?? []).map((descriptor) =>
              downloadTelegramInboundImage({ token, descriptor, attachmentRoot }),
            ),
          )
        } else if (latest.channel === 'feishu' && message.feishuImage != null) {
          const appId = readString(latest.credentials.appId)
          const appSecret = readString(latest.credentials.appSecret)
          if (appId == null || appSecret == null) throw new Error('飞书凭据未配置')
          const token = await this.getFeishuToken(latest.id, appId, appSecret)
          attachments = [
            await downloadFeishuImage({
              token,
              image: message.feishuImage,
              attachmentRoot: path.join(path.dirname(attachmentRoot), 'feishu'),
            }),
          ]
        } else if (latest.channel === 'qq') {
          attachments = await Promise.all(
            (message.qqImages ?? []).map((image) =>
              downloadQqImage({
                image,
                attachmentRoot: path.join(path.dirname(attachmentRoot), 'qq'),
              }),
            ),
          )
        }
      } catch (error) {
        await this.sendDirectMessage(
          latest,
          message.externalId,
          `图片接收失败：${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
    }
    if (this.inboundHandler == null) {
      const prefix = latest.commandPrefix.trim() || '/'
      await this.sendDirectMessage(
        latest,
        message.externalId,
        `远程连接运行时尚未就绪，请稍后重试；如果持续失败，请在桌面端检查远程连接状态后发送 ${prefix}status。`,
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
        ...(attachments != null ? { attachments } : {}),
      })
      if (response != null) {
        await this.sendDirectMessage(latest, message.externalId, {
          title: response.title,
          text: response.text.trim(),
          ...(response.actions != null ? { actions: response.actions } : {}),
        })
      }
    } catch (err) {
      await this.sendDirectMessage(
        latest,
        message.externalId,
        buildRemoteRuntimeErrorMessage(err, latest.commandPrefix),
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
        `已绑定 SparkWork。后续消息会进入该连接的默认会话，发送 ${latest.commandPrefix.trim() || '/'}help 查看命令。`,
      )
    } catch (err) {
      await this.sendDirectMessage(
        latest,
        externalId,
        `绑定失败：${err instanceof Error ? err.message : String(err)}\n\n建议：检查配对码是否过期；回到 SparkWork 重新生成配对码后，再发送 ${latest.commandPrefix.trim() || '/'}bind <配对码>。`,
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
          register: (handlers: Record<string, (data: unknown) => Promise<void>>) => unknown
        }
      }
      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (event) => {
          await this.handleFeishuWsEvent(connectionId, state, event as FeishuMessageReceiveEvent)
        },
        'card.action.trigger': async (event) => {
          await this.handleFeishuCardActionEvent(
            connectionId,
            event as FeishuCardActionReceiveEvent,
          )
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

    const feishuImage = extractFeishuInboundImage(message)
    const text =
      parseJsonContent(message.content) ?? (feishuImage == null ? '' : '请识别并说明这张图片。')
    const normalized = normalizeInboundText('feishu', text)
    if (normalized.length === 0 && feishuImage == null) return
    await this.handleInboundMessage(connection, {
      externalId: message.chat_id,
      senderName: event.sender?.sender_id?.open_id ?? '飞书用户',
      text: normalized,
      ...(feishuImage != null ? { feishuImage } : {}),
      ...(message.message_id != null ? { messageId: `feishu:${message.message_id}` } : {}),
    })
  }

  private async handleFeishuCardActionEvent(
    connectionId: string,
    event: FeishuCardActionReceiveEvent,
  ): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null || !connection.enabled || connection.channel !== 'feishu') return

    const value = isRecord(event.action?.value) ? event.action.value : undefined
    const command = readString(value?.command)
    const externalId = readString(event.open_chat_id) ?? readString(event.chat_id)
    if (command == null || externalId == null) return
    const operatorId = event.operator?.operator_id
    const senderName =
      readString(operatorId?.open_id) ?? readString(operatorId?.user_id) ?? '飞书用户'
    await this.handleInboundMessage(connection, {
      externalId,
      senderName,
      text: normalizeInboundText('feishu', command),
      ...(event.token != null ? { messageId: `feishu:action:${event.token}` } : {}),
    })
  }

  private startQqGateway(
    connection: RemoteConnectionConfig,
    appId: string,
    clientSecret: string,
  ): void {
    const existing = this.qqGateways.get(connection.id)
    if (existing != null && existing.matches(appId, clientSecret)) return
    existing?.stop()
    log.info(`启动 QQ 网关: connection=${connection.id} appId=${appId}`)
    const gateway = new QqBotGateway({
      appId,
      clientSecret,
      getToken: () => this.getQqToken(connection.id, appId, clientSecret),
      onMessage: (message) => {
        void this.handleQqInbound(connection.id, message)
      },
      onStatusChange: () => {
        this.emitChange({ reason: 'runtime-updated', connectionId: connection.id })
      },
    })
    this.qqGateways.set(connection.id, gateway)
    gateway.start()
  }

  private stopQqGateway(connectionId: string): void {
    const gateway = this.qqGateways.get(connectionId)
    gateway?.stop()
    this.qqGateways.delete(connectionId)
  }

  private async handleQqInbound(connectionId: string, message: QqInboundMessage): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null || !connection.enabled || connection.channel !== 'qq') {
      log.warn(`忽略 QQ 消息: 连接不存在或未启用 connection=${connectionId}`)
      return
    }
    log.info(
      `收到 QQ 消息: scene=${message.scene} from=${message.senderName ?? '(未知)'} text="${message.text.slice(0, 60)}"`,
    )
    const externalId = buildQqExternalId(message.scene, message.targetId)
    if (message.msgId != null) {
      this.qqReplyContexts.set(remoteRouteKey(connection.id, externalId), {
        msgId: message.msgId,
        sentCount: 0,
        expiresAt: Date.now() + 4.5 * 60_000,
      })
      this.pruneQqReplyContexts()
    }
    await this.handleInboundMessage(connection, {
      externalId,
      senderName: message.senderName,
      text: message.text,
      ...(message.images != null ? { qqImages: message.images } : {}),
      ...(message.msgId != null ? { messageId: `qq:${message.msgId}` } : {}),
    })
  }

  private pruneQqReplyContexts(): void {
    if (this.qqReplyContexts.size <= 200) return
    const now = Date.now()
    for (const [key, context] of this.qqReplyContexts) {
      if (context.expiresAt < now || context.sentCount >= 5) {
        this.qqReplyContexts.delete(key)
      }
    }
  }

  /**
   * 取出一次被动回复凭据：同一 msg_id 限 5 条、有效期约 5 分钟；
   * 超限后返回 null，由发送侧退化为主动消息（可能被平台限流拒绝）。
   */
  private takeQqReply(
    connectionId: string,
    externalId: string,
  ): { msgId: string; msgSeq: number } | null {
    const key = remoteRouteKey(connectionId, externalId)
    const context = this.qqReplyContexts.get(key)
    if (context == null) return null
    if (context.expiresAt < Date.now() || context.sentCount >= 5) {
      this.qqReplyContexts.delete(key)
      return null
    }
    context.sentCount += 1
    return { msgId: context.msgId, msgSeq: context.sentCount }
  }

  private async pollTelegramOnce(connectionId: string, state: TelegramPollingState): Promise<void> {
    const connection = this.readStore().connections.find((item) => item.id === connectionId)
    if (connection == null || !connection.enabled || connection.channel !== 'telegram') {
      this.stopTelegramPolling(connectionId)
      return
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(state.token)}/getUpdates?offset=${state.offset}&timeout=25&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`,
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
        result?: Array<{ update_id: number; message?: unknown; callback_query?: unknown }>
      }
      if (payload.ok === false) throw new Error('Telegram getUpdates returned ok=false')
      state.failCount = 0
      delete state.lastError
      for (const update of payload.result ?? []) {
        if (update.message != null) {
          await this.handleInboundWebhook(connection, { message: update.message })
        }
        if (update.callback_query != null) {
          const callback = isRecord(update.callback_query) ? update.callback_query : undefined
          const callbackId = readString(callback?.id)
          if (callbackId != null) void this.answerTelegramCallback(state.token, callbackId)
          await this.handleInboundWebhook(connection, { callback_query: update.callback_query })
        }
        state.offset = update.update_id + 1
      }
    } catch (err) {
      state.failCount += 1
      state.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  private async answerTelegramCallback(token: string, callbackId: string): Promise<void> {
    try {
      await this.postJson(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/answerCallbackQuery`,
        { callback_query_id: callbackId },
      )
    } catch {
      // 按钮回执失败不影响命令继续执行。
    }
  }

  private async syncTelegramCommands(
    connection: RemoteConnectionConfig,
    token: string,
  ): Promise<void> {
    const signature = JSON.stringify({
      commands: connection.telegramCommands,
      capabilities: connection.capabilities,
    })
    if (this.telegramCommandSignatures.get(connection.id) === signature) return
    const commands = buildTelegramBotCommands(connection)
    const method = commands.length > 0 ? 'setMyCommands' : 'deleteMyCommands'
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commands.length > 0 ? { commands } : {}),
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
    message: string | RemoteOutboundMessage,
  ): Promise<void> {
    const outbound: RemoteOutboundMessage =
      typeof message === 'string' ? { text: message } : message
    if (connection.channel === 'telegram') {
      await this.sendTelegramMessage(connection, externalId, outbound)
      return
    }
    if (connection.channel === 'feishu') {
      await this.sendFeishuMessage(connection, externalId, outbound)
      return
    }
    if (connection.channel === 'qq') {
      await this.sendQqMessage(connection, externalId, outbound)
      return
    }
    await this.sendClawMessage(connection, externalId, formatRemoteOutboundText(outbound))
  }

  private async sendTelegramMessage(
    connection: RemoteConnectionConfig,
    externalId: string,
    message: RemoteOutboundMessage,
  ): Promise<void> {
    const token = readString(connection.credentials.botToken)
    if (token == null) throw new Error('Telegram bot token 未配置')
    const formattedText = formatRemoteOutboundText(message)
    const media = connection.capabilities.transferFiles
      ? (() => {
          const extracted = extractTelegramOutboundMedia(formattedText)
          return {
            text: extracted.text,
            images: mergeTelegramOutboundImages(extracted.images, message.images ?? []),
          }
        })()
      : { text: formattedText, images: [] }
    const messageText =
      media.text.length > 0
        ? media.text
        : (message.actions?.length ?? 0) > 0
          ? (message.title ?? '请选择操作')
          : ''
    const chunks = messageText.length > 0 ? splitText(messageText, 3900) : []
    for (const [index, chunk] of chunks.entries()) {
      const actions = index === chunks.length - 1 ? (message.actions ?? []) : []
      await this.postTelegramFormattedText(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          chat_id: externalId,
          disable_web_page_preview: true,
          ...(actions.length > 0
            ? {
                reply_markup: {
                  inline_keyboard: chunkActions(actions).map((row) =>
                    row.map((action) => ({
                      text: action.label,
                      callback_data: this.encodeTelegramCallback(connection.id, action.command),
                    })),
                  ),
                },
              }
            : {}),
        },
        chunk,
      )
    }
    for (const image of media.images) {
      try {
        await sendTelegramOutboundImage(
          { token, chatId: externalId, image },
          {
            uploadTemporaryFile: async ({ filePath, fileName, mimeType }) => {
              const uploaded = await getAuthService().uploadFile({
                filePath,
                fileName,
                mimeType,
                purpose: 'media-transfer',
              })
              return uploaded.aiUrl
            },
          },
        )
      } catch (error) {
        log.warn(`Telegram 图片发送失败: ${error instanceof Error ? error.message : String(error)}`)
        await this.postJson(
          `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
          {
            chat_id: externalId,
            text: `图片发送失败：${image.alt || '未命名图片'}${/^https?:\/\//iu.test(image.source) ? `\n${image.source}` : ''}`,
            disable_web_page_preview: false,
          },
        )
      }
    }
  }

  private encodeTelegramCallback(connectionId: string, command: string): string {
    if (Buffer.byteLength(command, 'utf8') <= 64) return command
    const token = `spark:${crypto.randomBytes(12).toString('base64url')}`
    this.telegramCallbackActions.set(token, {
      connectionId,
      command,
      expiresAt: Date.now() + 24 * 60 * 60_000,
    })
    if (this.telegramCallbackActions.size > 2_000) {
      const now = Date.now()
      for (const [key, value] of this.telegramCallbackActions) {
        if (value.expiresAt < now || this.telegramCallbackActions.size > 1_500) {
          this.telegramCallbackActions.delete(key)
        }
      }
    }
    return token
  }

  private expandTelegramCallback(connection: RemoteConnectionConfig, body: unknown): unknown {
    if (!isRecord(body) || !isRecord(body.callback_query)) return body
    const data = readString(body.callback_query.data)
    if (data == null || !data.startsWith('spark:')) return body
    const stored = this.telegramCallbackActions.get(data)
    if (stored == null || stored.connectionId !== connection.id || stored.expiresAt < Date.now()) {
      this.telegramCallbackActions.delete(data)
      return {
        ...body,
        callback_query: {
          ...body.callback_query,
          data: `${connection.commandPrefix.trim() || '/'}expired-action`,
        },
      }
    }
    return { ...body, callback_query: { ...body.callback_query, data: stored.command } }
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
    message: RemoteOutboundMessage,
  ): Promise<void> {
    const appId = readString(connection.credentials.appId)
    const appSecret = readString(connection.credentials.appSecret)
    if (appId == null || appSecret == null) throw new Error('飞书 App ID 或 App Secret 未配置')
    const token = await this.getFeishuToken(connection.id, appId, appSecret)
    const receiveIdType = resolveFeishuReceiveIdType(externalId)
    const extracted = connection.capabilities.transferFiles
      ? extractTelegramOutboundMedia(message.text)
      : { text: message.text, images: [] }
    const images = [
      ...extracted.images,
      ...(connection.capabilities.transferFiles ? (message.images ?? []) : []),
    ]
    const messageText = extracted.text || ((message.actions?.length ?? 0) > 0 ? '请选择操作' : '')
    const chunks = messageText.length > 0 ? splitText(messageText, 10_000) : []
    for (const [index, text] of chunks.entries()) {
      const actions = index === chunks.length - 1 ? message.actions : undefined
      await this.postJson(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
        {
          receive_id: externalId,
          msg_type: 'interactive',
          content: JSON.stringify(
            buildFeishuCard({
              ...(message.title == null ? {} : { title: message.title }),
              text,
              ...(actions == null ? {} : { actions }),
            }),
          ),
        },
        { Authorization: `Bearer ${token}` },
      )
    }
    for (const image of images) {
      try {
        const imageKey = await uploadFeishuImage({ token, source: image.source })
        const result = await this.postJson(
          `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
          {
            receive_id: externalId,
            msg_type: 'image',
            content: JSON.stringify({ image_key: imageKey }),
          },
          { Authorization: `Bearer ${token}` },
        )
        if (isRecord(result) && typeof result.code === 'number' && result.code !== 0) {
          throw new Error(`飞书图片消息发送失败：${String(result.msg ?? result.code)}`)
        }
      } catch (error) {
        log.warn(`飞书图片发送失败: ${error instanceof Error ? error.message : String(error)}`)
        await this.postJson(
          `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
          {
            receive_id: externalId,
            msg_type: 'text',
            content: JSON.stringify({ text: `图片发送失败：${image.alt || '未命名图片'}` }),
          },
          { Authorization: `Bearer ${token}` },
        )
      }
    }
  }

  private async sendProcessingFeedback(
    connection: RemoteConnectionConfig,
    externalId: string,
    messageId?: string,
  ): Promise<void> {
    if (connection.channel === 'telegram') {
      const telegramMessageId = messageId?.match(/^telegram:(\d+)$/)?.[1]
      const reaction = async () => {
        if (telegramMessageId == null) return
        const token = readString(connection.credentials.botToken)
        if (token == null) return
        try {
          await this.postJson(
            `https://api.telegram.org/bot${encodeURIComponent(token)}/setMessageReaction`,
            {
              chat_id: externalId,
              message_id: Number(telegramMessageId),
              reaction: [{ type: 'emoji', emoji: '👀' }],
            },
          )
        } catch {
          // 群组可能禁用 👀，反应失败不阻断消息处理。
        }
      }
      await Promise.all([this.sendTelegramChatAction(connection, externalId, 'typing'), reaction()])
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
    message: RemoteOutboundMessage,
  ): Promise<void> {
    const appId = readString(connection.credentials.qqBotAppId)
    const clientSecret = readString(connection.credentials.qqBotSecret)
    if (appId == null || clientSecret == null)
      throw new Error('QQ 机器人 AppID 或 AppSecret 未配置')
    const target = parseQqExternalId(externalId)
    if (target == null) {
      throw new Error(
        `QQ 回复目标无法识别：${externalId}（应为 qq-group:/qq-user:/qq-channel: 前缀）`,
      )
    }
    const token = await this.getQqToken(connection.id, appId, clientSecret)
    const formatted = formatRemoteOutboundText(message)
    const extracted = extractTelegramOutboundMedia(formatted)
    const requestedImages = [...extracted.images, ...(message.images ?? [])]
    const imageTransferBlocked =
      !connection.capabilities.transferFiles && requestedImages.length > 0
    const images = imageTransferBlocked ? [] : requestedImages
    const outboundText = imageTransferBlocked
      ? '图片未发送：当前 QQ 连接未启用“传输文件”能力。请在 SparkWork 的远程连接设置中开启后重试。'
      : extracted.text
    // 群聊/单聊文本按 UTF-8 字节计上限（1024 字节，留余量）；频道文本上限更宽松。
    const maxBytes = target.scene === 'channel' ? 1900 : 1000
    const chunks = outboundText.length > 0 ? splitQqContent(plainText(outboundText), maxBytes) : []
    for (const chunk of chunks) {
      if (target.scene === 'channel') {
        const reply = this.takeQqReply(connection.id, externalId)
        await this.postJson(
          `https://api.sgroup.qq.com/channels/${encodeURIComponent(target.targetId)}/messages`,
          { content: chunk, ...(reply != null ? { msg_id: reply.msgId } : {}) },
          { Authorization: `QQBot ${token}` },
        )
        continue
      }
      // 群聊/单聊：优先被动回复（引用 msg_id + 递增 msg_seq），超窗后退化为主动消息。
      const reply = this.takeQqReply(connection.id, externalId)
      const endpointBase =
        target.scene === 'group'
          ? `https://api.sgroup.qq.com/v2/groups/${encodeURIComponent(target.targetId)}/messages`
          : `https://api.sgroup.qq.com/v2/users/${encodeURIComponent(target.targetId)}/messages`
      try {
        await this.postJson(
          endpointBase,
          {
            msg_type: 0,
            content: chunk,
            ...(reply != null ? { msg_id: reply.msgId, msg_seq: reply.msgSeq } : {}),
          },
          { Authorization: `QQBot ${token}` },
        )
      } catch (err) {
        log.error(
          `QQ 消息发送失败: scene=${target.scene} target=${target.targetId} ` +
            `被动回复=${reply != null ? `msg_seq=${reply.msgSeq}` : '否(超窗/无凭据)'} ` +
            `错误=${err instanceof Error ? err.message : String(err)}`,
        )
        throw err
      }
    }
    for (const image of images) {
      try {
        if (target.scene === 'channel') {
          const { bytes, fileName, mimeType } = await readOutboundImage(image.source)
          const form = new FormData()
          form.append('file_image', new Blob([bytes], { type: mimeType }), fileName)
          const reply = this.takeQqReply(connection.id, externalId)
          if (reply != null) form.append('msg_id', reply.msgId)
          const response = await fetch(
            `https://api.sgroup.qq.com/channels/${encodeURIComponent(target.targetId)}/messages`,
            {
              method: 'POST',
              headers: { Authorization: `QQBot ${token}` },
              body: form,
              signal: AbortSignal.timeout(30_000),
            },
          )
          if (!response.ok) throw new Error(`QQ 频道图片发送失败：HTTP ${response.status}`)
        } else {
          const endpointBase =
            target.scene === 'group'
              ? `https://api.sgroup.qq.com/v2/groups/${encodeURIComponent(target.targetId)}`
              : `https://api.sgroup.qq.com/v2/users/${encodeURIComponent(target.targetId)}`
          const fileInfo = await uploadQqImage({
            token,
            endpointBase,
            source: image.source,
            uploadTemporaryFile: async ({ filePath, fileName, mimeType }) => {
              const uploaded = await getAuthService().uploadFile({
                filePath,
                fileName,
                mimeType,
                purpose: 'media-transfer',
              })
              return uploaded.aiUrl
            },
          })
          const reply = this.takeQqReply(connection.id, externalId)
          await this.postJson(
            `${endpointBase}/messages`,
            {
              msg_type: 7,
              media: { file_info: fileInfo },
              ...(reply != null ? { msg_id: reply.msgId, msg_seq: reply.msgSeq } : {}),
            },
            { Authorization: `QQBot ${token}` },
          )
        }
      } catch (error) {
        log.warn(`QQ 图片发送失败: ${error instanceof Error ? error.message : String(error)}`)
        await this.sendQqMessage(connection, externalId, {
          text: `图片发送失败：${image.alt || '未命名图片'}`,
        })
      }
    }
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

  private async postTelegramFormattedText(
    url: string,
    body: Record<string, unknown>,
    markdown: string,
  ): Promise<unknown> {
    const html = formatTelegramMarkdown(markdown)
    try {
      return await this.postJson(url, { ...body, text: html, parse_mode: 'HTML' })
    } catch (error) {
      if (!isTelegramFormattingError(error)) throw error
      // A malformed or partially streamed Markdown construct must not suppress the reply.
      return this.postJson(url, { ...body, text: markdown })
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
