import type {
  ConnectorRuntimeDescriptor,
  RuntimeConnectRequest,
  RuntimeToolDefinition,
} from '@spark/protocol'
import { RuntimeError } from '../runtime-errors.js'
import type {
  ConnectorRuntimeAdapter,
  RuntimeConnectContext,
  RuntimeContext,
  RuntimeConnectResult,
} from '../runtime-types.js'

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/'
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3/'

export class GoogleWorkspaceRuntimeAdapter implements ConnectorRuntimeAdapter {
  readonly descriptor: ConnectorRuntimeDescriptor = {
    id: 'google',
    pluginId: 'spark.google',
    provider: 'google',
    displayName: 'Google Workspace',
    description: '统一管理 Gmail 与 Google Calendar 账号，能力和授权范围可以分别启用。',
    icon: 'google',
    toolNamespace: 'google',
    accountMode: 'multiple',
    execution: { type: 'builtin', adapter: 'google' },
    authMethods: ['oauth2'],
    authGuides: {
      oauth: {
        label: '配置 Google OAuth 客户端',
        url: 'https://console.cloud.google.com/apis/credentials',
        description: '先在 Google Cloud 创建桌面应用 OAuth Client ID。',
      },
    },
    capabilities: [
      {
        id: 'gmail_read',
        label: 'Gmail 读取',
        description: '搜索和读取邮件。',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        enabledByDefault: true,
      },
      {
        id: 'gmail_write',
        label: 'Gmail 写入',
        description: '创建草稿和发送邮件。',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.compose'],
        enabledByDefault: false,
      },
      {
        id: 'gmail_send',
        label: 'Gmail 发送',
        description: '发送已确认的草稿。',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
        enabledByDefault: false,
      },
      {
        id: 'gmail_manage',
        label: 'Gmail 标签管理',
        description: '修改邮件标签和已读状态。',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
        enabledByDefault: false,
      },
      {
        id: 'calendar_read',
        label: '日历读取',
        description: '读取日历、事件和忙闲。',
        requiredScopes: [
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.freebusy',
        ],
        enabledByDefault: true,
      },
      {
        id: 'calendar_write',
        label: '日历写入',
        description: '创建、修改和取消事件。',
        requiredScopes: ['https://www.googleapis.com/auth/calendar.events'],
        enabledByDefault: false,
      },
    ],
  }

  async connect(
    ctx: RuntimeConnectContext,
    request: RuntimeConnectRequest,
  ): Promise<RuntimeConnectResult> {
    const token = ctx.getSecret('accessToken') ?? ctx.getSecret('token')
    if (token == null || token.trim().length === 0)
      throw new RuntimeError('AUTH_REQUIRED', 'Google OAuth access token is required')
    const user = await ctx.http.requestJson<Record<string, unknown>>({
      path: USERINFO_URL,
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    const externalAccountId = String(user.sub ?? user.email ?? '')
    if (!externalAccountId)
      throw new RuntimeError(
        'INVALID_PROVIDER_RESPONSE',
        'Google did not return an account identifier',
      )
    const config = request.config ?? {}
    const expiresAt = ctx.getSecret('expiresAt')
    const refreshToken = ctx.getSecret('refreshToken')
    return {
      externalAccountId,
      displayName: typeof user.email === 'string' ? user.email : 'Google account',
      ...(typeof user.picture === 'string' ? { avatarUrl: user.picture } : {}),
      grantedScopes: stringArray(config.grantedScopes),
      config: {
        ...config,
        ...(typeof user.email === 'string' ? { accountEmail: user.email } : {}),
      },
      resourceScope: { calendars: stringArray(config.calendars) },
      credential: {
        accessToken: token.trim(),
        tokenType: 'Bearer',
        ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
        ...(refreshToken != null ? { refreshToken } : {}),
      },
      ...(typeof expiresAt === 'string' ? { tokenExpiresAt: expiresAt } : {}),
    }
  }

  async healthCheck(ctx: RuntimeContext) {
    const startedAt = performance.now()
    await ctx.http.requestJson<Record<string, unknown>>({ path: USERINFO_URL })
    return {
      status: 'healthy' as const,
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  }

  async listTools(_ctx: RuntimeContext): Promise<RuntimeToolDefinition[]> {
    return [
      googleTool(
        'gmail_search_messages',
        '搜索 Gmail',
        '按 Gmail 查询语法搜索邮件。',
        ['gmail_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'gmail_get_message',
        '读取 Gmail 邮件',
        '读取指定 Gmail 邮件的元数据和正文。',
        ['gmail_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'gmail_get_thread',
        '读取 Gmail 会话',
        '读取指定 Gmail 会话。',
        ['gmail_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'gmail_get_attachment',
        '读取 Gmail 附件',
        '读取指定 Gmail 附件的内容元数据和 base64 数据。',
        ['gmail_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'gmail_list_labels',
        '列出 Gmail 标签',
        '列出当前 Gmail 标签。',
        ['gmail_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'gmail_create_draft',
        '创建 Gmail 草稿',
        '创建草稿；发送必须另行确认。',
        ['gmail_write'],
        'low-write',
        'create',
        'keyed',
      ),
      googleTool(
        'gmail_update_draft',
        '更新 Gmail 草稿',
        '替换已有草稿内容，需要写入能力。',
        ['gmail_write'],
        'low-write',
        'update',
        'keyed',
      ),
      googleTool(
        'gmail_send_draft',
        '发送 Gmail 草稿',
        '发送已有草稿，需要动作确认。',
        ['gmail_send'],
        'high-write',
        'send',
        'unsafe',
      ),
      googleTool(
        'gmail_modify_labels',
        '修改 Gmail 标签',
        '修改邮件标签，需要写入能力。',
        ['gmail_manage'],
        'low-write',
        'update',
        'keyed',
      ),
      googleTool(
        'calendar_list_calendars',
        '列出日历',
        '列出 Google Calendar 日历。',
        ['calendar_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'calendar_list_events',
        '列出日历事件',
        '按时间范围列出日历事件。',
        ['calendar_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'calendar_get_event',
        '读取日历事件',
        '读取指定日历事件。',
        ['calendar_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'calendar_query_freebusy',
        '查询忙闲',
        '查询一个或多个日历的忙闲信息。',
        ['calendar_read'],
        'read',
        'read',
        'safe',
      ),
      googleTool(
        'calendar_create_event',
        '创建日历事件',
        '创建日历事件，需要动作确认。',
        ['calendar_write'],
        'high-write',
        'create',
        'keyed',
      ),
      googleTool(
        'calendar_update_event',
        '修改日历事件',
        '修改日历事件，需要动作确认。',
        ['calendar_write'],
        'high-write',
        'update',
        'keyed',
      ),
      googleTool(
        'calendar_cancel_event',
        '取消日历事件',
        '取消日历事件，需要动作确认。',
        ['calendar_write'],
        'destructive',
        'delete',
        'unsafe',
      ),
    ]
  }

  async invokeTool(ctx: RuntimeContext, toolName: string, input: unknown): Promise<unknown> {
    const params = objectInput(input)
    switch (toolName) {
      case 'gmail_search_messages':
        return this.request(ctx, 'gmail', 'messages', {
          q: requiredString(params, 'query'),
          maxResults: clamp(params.maxResults, 50, 1, 100),
          pageToken: optionalString(params, 'pageToken'),
        })
      case 'gmail_get_message':
        return this.request(
          ctx,
          'gmail',
          `messages/${encodeURIComponent(requiredString(params, 'messageId'))}`,
          { format: normalizeGmailFormat(params) },
        )
      case 'gmail_get_thread':
        return this.request(
          ctx,
          'gmail',
          `threads/${encodeURIComponent(requiredString(params, 'threadId'))}`,
          { format: normalizeGmailFormat(params) },
        )
      case 'gmail_get_attachment':
        return this.request(
          ctx,
          'gmail',
          `messages/${encodeURIComponent(requiredString(params, 'messageId'))}/attachments/${encodeURIComponent(requiredString(params, 'attachmentId'))}`,
        )
      case 'gmail_list_labels':
        return this.request(ctx, 'gmail', 'labels')
      case 'gmail_create_draft': {
        const raw = buildRawMessage(params)
        return this.request(ctx, 'gmail', 'drafts', undefined, 'POST', { message: { raw } })
      }
      case 'gmail_update_draft': {
        const raw = buildRawMessage(params)
        return this.request(
          ctx,
          'gmail',
          `drafts/${encodeURIComponent(requiredString(params, 'draftId'))}`,
          undefined,
          'PUT',
          { message: { raw } },
        )
      }
      case 'gmail_send_draft':
        return this.request(ctx, 'gmail', 'drafts/send', undefined, 'POST', {
          id: requiredString(params, 'draftId'),
        })
      case 'gmail_modify_labels':
        return this.request(
          ctx,
          'gmail',
          `messages/${encodeURIComponent(requiredString(params, 'messageId'))}/modify`,
          undefined,
          'POST',
          {
            ...(Array.isArray(params.addLabelIds)
              ? { addLabelIds: stringArray(params.addLabelIds) }
              : {}),
            ...(Array.isArray(params.removeLabelIds)
              ? { removeLabelIds: stringArray(params.removeLabelIds) }
              : {}),
          },
        )
      case 'calendar_list_calendars': {
        const result = await this.request(ctx, 'calendar', 'users/me/calendarList', {
          maxResults: clamp(params.maxResults, 100, 1, 250),
        })
        return filterCalendarList(ctx, result)
      }
      case 'calendar_list_events': {
        const calendarId = optionalString(params, 'calendarId') ?? 'primary'
        ctx.policy.requireResource(ctx.account, 'calendars', calendarId)
        return this.request(ctx, 'calendar', `calendars/${encodeURIComponent(calendarId)}/events`, {
          timeMin: optionalString(params, 'timeMin'),
          timeMax: optionalString(params, 'timeMax'),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: clamp(params.maxResults, 100, 1, 250),
          pageToken: optionalString(params, 'pageToken'),
        })
      }
      case 'calendar_get_event': {
        const calendarId = optionalString(params, 'calendarId') ?? 'primary'
        ctx.policy.requireResource(ctx.account, 'calendars', calendarId)
        return this.request(
          ctx,
          'calendar',
          `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(requiredString(params, 'eventId'))}`,
        )
      }
      case 'calendar_query_freebusy': {
        const calendarIds = Array.isArray(params.calendarIds)
          ? stringArray(params.calendarIds)
          : ['primary']
        for (const calendarId of calendarIds)
          ctx.policy.requireResource(ctx.account, 'calendars', calendarId)
        return this.request(ctx, 'calendar', 'freeBusy', undefined, 'POST', {
          timeMin: requiredString(params, 'timeMin'),
          timeMax: requiredString(params, 'timeMax'),
          items: calendarIds.map((id) => ({ id })),
        })
      }
      case 'calendar_create_event': {
        const calendarId = optionalString(params, 'calendarId') ?? 'primary'
        ctx.policy.requireResource(ctx.account, 'calendars', calendarId)
        return this.request(
          ctx,
          'calendar',
          `calendars/${encodeURIComponent(calendarId)}/events`,
          undefined,
          'POST',
          eventBody(params),
        )
      }
      case 'calendar_update_event': {
        const calendarId = optionalString(params, 'calendarId') ?? 'primary'
        ctx.policy.requireResource(ctx.account, 'calendars', calendarId)
        return this.request(
          ctx,
          'calendar',
          `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(requiredString(params, 'eventId'))}`,
          undefined,
          'PATCH',
          eventBody(params),
        )
      }
      case 'calendar_cancel_event': {
        const calendarId = optionalString(params, 'calendarId') ?? 'primary'
        ctx.policy.requireResource(ctx.account, 'calendars', calendarId)
        return this.request(
          ctx,
          'calendar',
          `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(requiredString(params, 'eventId'))}`,
          undefined,
          'DELETE',
        )
      }
      default:
        throw new RuntimeError(
          'RUNTIME_UNAVAILABLE',
          `Unsupported Google runtime tool: ${toolName}`,
        )
    }
  }

  private async request(
    ctx: RuntimeContext,
    service: 'gmail' | 'calendar',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    method = 'GET',
    json?: unknown,
  ): Promise<unknown> {
    const base = service === 'gmail' ? GMAIL_BASE : CALENDAR_BASE
    return ctx.http.requestJson({
      path: new URL(path, base).toString(),
      method,
      ...(query !== undefined ? { query } : {}),
      ...(json !== undefined ? { json } : {}),
    })
  }
}

function googleTool(
  name: string,
  title: string,
  description: string,
  requiredCapabilities: string[],
  risk: RuntimeToolDefinition['risk'],
  effect: RuntimeToolDefinition['effect'],
  idempotency: RuntimeToolDefinition['idempotency'],
): RuntimeToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: { type: 'object', additionalProperties: true },
    requiredCapabilities,
    risk,
    effect,
    idempotency,
  }
}
function objectInput(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Tool input must be an object')
  return value as Record<string, unknown>
}
function requiredString(value: Record<string, unknown>, key: string): string {
  const result = typeof value[key] === 'string' ? value[key].trim() : ''
  if (!result) throw new RuntimeError('INVALID_PROVIDER_RESPONSE', `Missing parameter: ${key}`)
  return result
}
function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' && value[key].trim().length > 0
    ? value[key].trim()
    : undefined
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : []
}
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback
}
function buildRawMessage(params: Record<string, unknown>): string {
  const to = safeHeaderValue(requiredString(params, 'to'), 'to')
  const subject = safeHeaderValue(requiredString(params, 'subject'), 'subject')
  const body = requiredString(params, 'body')
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
  return Buffer.from(raw, 'utf8').toString('base64url')
}

function safeHeaderValue(value: string, name: string): string {
  if (/[\r\n]/.test(value))
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', `Invalid Gmail ${name} header`)
  return value
}

function normalizeGmailFormat(params: Record<string, unknown>): string {
  const format = optionalString(params, 'format') ?? 'full'
  if (!['full', 'metadata', 'minimal'].includes(format))
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Unsupported Gmail response format')
  return format
}

function filterCalendarList(ctx: RuntimeContext, value: unknown): unknown {
  const allowed = stringArray(ctx.account.resourceScope.calendars)
  if (allowed.length === 0 || value == null || typeof value !== 'object' || Array.isArray(value))
    return value
  const payload = value as Record<string, unknown>
  if (!Array.isArray(payload.items)) return value
  return {
    ...payload,
    items: payload.items.filter(
      (item) =>
        item != null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        allowed.includes((item as Record<string, unknown>).id as string),
    ),
  }
}

function eventBody(params: Record<string, unknown>): Record<string, unknown> {
  const start = requiredString(params, 'start')
  const end = requiredString(params, 'end')
  const timeZone = optionalString(params, 'timeZone') ?? 'UTC'
  return {
    summary: requiredString(params, 'summary'),
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    ...(optionalString(params, 'description')
      ? { description: optionalString(params, 'description') }
      : {}),
    ...(Array.isArray(params.attendees)
      ? {
          attendees: params.attendees
            .filter((item): item is string => typeof item === 'string')
            .map((email) => ({ email })),
        }
      : {}),
  }
}
