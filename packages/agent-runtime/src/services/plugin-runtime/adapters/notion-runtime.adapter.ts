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

const NOTION_API = 'https://api.notion.com/v1/'
const NOTION_VERSION = '2026-03-11'

export class NotionRuntimeAdapter implements ConnectorRuntimeAdapter {
  readonly descriptor: ConnectorRuntimeDescriptor = {
    id: 'notion',
    pluginId: 'spark.notion',
    provider: 'notion',
    displayName: 'Notion',
    description: '在用户明确授权的页面和数据源范围内搜索、读取和整理 Notion 内容。',
    icon: 'notion',
    toolNamespace: 'notion',
    accountMode: 'multiple',
    execution: { type: 'builtin', adapter: 'notion' },
    authMethods: ['oauth2', 'api-key'],
    authGuides: {
      token: {
        label: '创建 Notion Integration',
        url: 'https://www.notion.so/my-integrations',
        description: '创建 Internal Integration 并复制 Internal Integration Secret。',
      },
      oauth: {
        label: '配置 Notion OAuth 应用',
        url: 'https://www.notion.so/my-integrations',
        description: 'OAuth 模式需要一个已配置 redirect URI 的 Notion 应用。',
      },
    },
    capabilities: [
      {
        id: 'notion_read',
        label: '读取',
        description: '搜索和读取页面、块、数据源。',
        enabledByDefault: true,
      },
      {
        id: 'notion_write',
        label: '写入',
        description: '创建和更新页面内容。',
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
      throw new RuntimeError('AUTH_REQUIRED', 'Notion integration token is required')
    const version =
      typeof request.config?.notionVersion === 'string'
        ? request.config.notionVersion
        : NOTION_VERSION
    const expiresAt = ctx.getSecret('expiresAt')
    const user = await ctx.http.requestJson<Record<string, unknown>>({
      path: `${NOTION_API}users/me`,
      headers: { Authorization: `Bearer ${token.trim()}`, 'Notion-Version': version },
    })
    const externalAccountId = String(user.id ?? '')
    if (!externalAccountId)
      throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Notion did not return a bot identifier')
    const bot = user.bot as Record<string, unknown> | undefined
    return {
      externalAccountId,
      displayName:
        typeof user.name === 'string'
          ? user.name
          : typeof bot?.workspace_name === 'string'
            ? bot.workspace_name
            : 'Notion workspace',
      ...(typeof user.avatar_url === 'string' ? { avatarUrl: user.avatar_url } : {}),
      grantedScopes: stringArray(request.config?.grantedScopes),
      config: { ...(request.config ?? {}), notionVersion: version },
      resourceScope: {
        pages: stringArray(request.resourceScope?.pages),
        dataSources: stringArray(request.resourceScope?.dataSources),
      },
      credential: {
        accessToken: token.trim(),
        tokenType: 'Bearer',
        ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
      },
      ...(typeof expiresAt === 'string' ? { tokenExpiresAt: expiresAt } : {}),
    }
  }

  async healthCheck(ctx: RuntimeContext) {
    const startedAt = performance.now()
    await this.request(ctx, 'users/me')
    return {
      status: 'healthy' as const,
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  }

  async listTools(_ctx: RuntimeContext): Promise<RuntimeToolDefinition[]> {
    return [
      notionTool(
        'search',
        '搜索 Notion',
        '搜索 Notion 工作区；搜索结果可能存在索引延迟，不能视为穷尽查询。',
        ['notion_read'],
        'read',
        'read',
        'safe',
      ),
      notionTool(
        'get_page',
        '读取页面',
        '读取 Notion 页面属性。',
        ['notion_read'],
        'read',
        'read',
        'safe',
      ),
      notionTool(
        'get_block_children',
        '读取页面内容',
        '读取页面或块的子块内容。',
        ['notion_read'],
        'read',
        'read',
        'safe',
      ),
      notionTool(
        'query_data_source',
        '查询数据源',
        '查询 Notion data source，而非旧版 database 查询。',
        ['notion_read'],
        'read',
        'read',
        'safe',
      ),
      notionTool(
        'create_page',
        '创建页面',
        '创建 Notion 页面，需要动作确认。',
        ['notion_write'],
        'high-write',
        'create',
        'keyed',
      ),
      notionTool(
        'update_page',
        '更新页面',
        '更新 Notion 页面属性，需要动作确认。',
        ['notion_write'],
        'high-write',
        'update',
        'keyed',
      ),
      notionTool(
        'append_block_children',
        '追加页面内容',
        '向页面追加内容块，需要动作确认。',
        ['notion_write'],
        'high-write',
        'update',
        'keyed',
      ),
      notionTool(
        'archive_page',
        '归档页面',
        '归档 Notion 页面，需要动作确认；运行时不提供永久删除。',
        ['notion_write'],
        'destructive',
        'delete',
        'unsafe',
      ),
    ]
  }

  async invokeTool(ctx: RuntimeContext, toolName: string, input: unknown): Promise<unknown> {
    const params = objectInput(input)
    switch (toolName) {
      case 'search':
        return filterScopedResults(
          ctx,
          await this.request(ctx, 'search', undefined, 'POST', {
            ...(optionalString(params, 'query') ? { query: optionalString(params, 'query') } : {}),
            ...(params.filter != null ? { filter: params.filter } : {}),
            ...(params.sort != null ? { sort: params.sort } : {}),
            page_size: clamp(params.pageSize, 50, 1, 100),
            ...(optionalString(params, 'startCursor')
              ? { start_cursor: optionalString(params, 'startCursor') }
              : {}),
          }),
        )
      case 'get_page':
        this.requirePage(ctx, params)
        return this.request(ctx, `pages/${encodeURIComponent(requiredString(params, 'pageId'))}`)
      case 'get_block_children':
        this.requireBlockParent(ctx, params)
        return this.request(
          ctx,
          `blocks/${encodeURIComponent(requiredString(params, 'blockId'))}/children`,
          {
            page_size: clamp(params.pageSize, 100, 1, 100),
            start_cursor: optionalString(params, 'startCursor'),
          },
        )
      case 'query_data_source':
        this.requireDataSource(ctx, params)
        return this.request(
          ctx,
          `data_sources/${encodeURIComponent(requiredString(params, 'dataSourceId'))}/query`,
          undefined,
          'POST',
          {
            ...(params.filter != null ? { filter: params.filter } : {}),
            ...(params.sorts != null ? { sorts: params.sorts } : {}),
            page_size: clamp(params.pageSize, 100, 1, 100),
            ...(optionalString(params, 'startCursor')
              ? { start_cursor: optionalString(params, 'startCursor') }
              : {}),
          },
        )
      case 'create_page':
        this.requireParent(ctx, params)
        return this.request(ctx, 'pages', undefined, 'POST', {
          parent: params.parent,
          properties: params.properties,
          ...(params.children != null ? { children: params.children } : {}),
        })
      case 'update_page':
        this.requirePage(ctx, params)
        return this.request(
          ctx,
          `pages/${encodeURIComponent(requiredString(params, 'pageId'))}`,
          undefined,
          'PATCH',
          { properties: params.properties },
        )
      case 'append_block_children':
        this.requireBlockParent(ctx, params)
        return this.request(
          ctx,
          `blocks/${encodeURIComponent(requiredString(params, 'blockId'))}/children`,
          undefined,
          'PATCH',
          { children: params.children },
        )
      case 'archive_page':
        this.requirePage(ctx, params)
        return this.request(
          ctx,
          `pages/${encodeURIComponent(requiredString(params, 'pageId'))}`,
          undefined,
          'PATCH',
          { archived: true },
        )
      default:
        throw new RuntimeError(
          'RUNTIME_UNAVAILABLE',
          `Unsupported Notion runtime tool: ${toolName}`,
        )
    }
  }

  private async request(
    ctx: RuntimeContext,
    path: string,
    query?: Record<string, string | number | undefined>,
    method = 'GET',
    json?: unknown,
  ): Promise<unknown> {
    const version =
      typeof ctx.account.config.notionVersion === 'string'
        ? ctx.account.config.notionVersion
        : NOTION_VERSION
    return ctx.http.requestJson({
      path: new URL(path, NOTION_API).toString(),
      method,
      headers: { 'Notion-Version': version },
      ...(query !== undefined ? { query } : {}),
      ...(json !== undefined ? { json } : {}),
    })
  }

  private requireParent(ctx: RuntimeContext, params: Record<string, unknown>): void {
    const parent = params.parent
    if (parent == null || typeof parent !== 'object' || Array.isArray(parent))
      throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Notion page parent is required')
    const value = parent as Record<string, unknown>
    const pageId = optionalString(value, 'page_id') ?? optionalString(value, 'database_id')
    const dataSourceId = optionalString(value, 'data_source_id')
    if (pageId != null) ctx.policy.requireResource(ctx.account, 'pages', pageId)
    if (dataSourceId != null) ctx.policy.requireResource(ctx.account, 'dataSources', dataSourceId)
    if (pageId == null && dataSourceId == null)
      throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Notion page parent is invalid')
  }

  private requireBlockParent(ctx: RuntimeContext, params: Record<string, unknown>): void {
    const pageId = optionalString(params, 'pageId') ?? optionalString(params, 'parentPageId')
    const hasExplicitScope = Object.values(ctx.account.resourceScope).some(
      (value) => Array.isArray(value) && value.length > 0,
    )
    if (pageId == null && hasExplicitScope)
      throw new RuntimeError(
        'RESOURCE_OUT_OF_SCOPE',
        'A parent page must be supplied for a scoped Notion account',
      )
    if (pageId != null) ctx.policy.requireResource(ctx.account, 'pages', pageId)
  }

  private requireDataSource(ctx: RuntimeContext, params: Record<string, unknown>): void {
    const dataSourceId = requiredString(params, 'dataSourceId')
    ctx.policy.requireResource(ctx.account, 'dataSources', dataSourceId)
  }

  private requirePage(ctx: RuntimeContext, params: Record<string, unknown>): void {
    const pageId = requiredString(params, 'pageId')
    ctx.policy.requireResource(ctx.account, 'pages', pageId)
  }
}

function notionTool(
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

function filterScopedResults(ctx: RuntimeContext, value: unknown): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
  const payload = value as Record<string, unknown>
  if (!Array.isArray(payload.results)) return value
  const allowed = [
    ...stringArray(ctx.account.resourceScope.pages),
    ...stringArray(ctx.account.resourceScope.dataSources),
  ]
  if (allowed.length === 0) return value
  const allowedIds = new Set(allowed)
  return {
    ...payload,
    results: payload.results.filter((item) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return false
      const id = (item as Record<string, unknown>).id
      return typeof id === 'string' && allowedIds.has(id)
    }),
  }
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
