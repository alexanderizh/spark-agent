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

const API_BASE_URL = 'https://api.github.com/'

export class GitHubRuntimeAdapter implements ConnectorRuntimeAdapter {
  readonly descriptor: ConnectorRuntimeDescriptor = {
    id: 'github',
    pluginId: 'spark.github',
    provider: 'github',
    displayName: 'GitHub',
    description:
      '在明确授权的仓库范围内读取代码、Issue 和 Pull Request，并执行受确认保护的写操作。',
    icon: 'github',
    toolNamespace: 'github',
    accountMode: 'multiple',
    execution: { type: 'builtin', adapter: 'github' },
    authMethods: ['pat', 'device-code', 'github-app'],
    authGuides: {
      token: {
        label: '创建 Fine-grained PAT',
        url: 'https://github.com/settings/personal-access-tokens/new',
        description: '建议只选择需要的仓库和最小权限。',
      },
    },
    capabilities: [
      {
        id: 'identity',
        label: '身份',
        description: '读取当前 GitHub 用户。',
        enabledByDefault: true,
      },
      {
        id: 'repositories',
        label: '仓库',
        description: '列出和读取授权仓库。',
        enabledByDefault: true,
      },
      {
        id: 'contents',
        label: '文件',
        description: '读取和写入仓库文件。',
        enabledByDefault: true,
      },
      { id: 'issues', label: 'Issue', description: '读取和管理 Issue。', enabledByDefault: true },
      {
        id: 'pull_requests',
        label: 'Pull Request',
        description: '读取和创建 Pull Request。',
        enabledByDefault: true,
      },
    ],
  }

  async connect(
    ctx: RuntimeConnectContext,
    request: RuntimeConnectRequest,
  ): Promise<RuntimeConnectResult> {
    const token = ctx.getSecret('token') ?? ctx.getSecret('accessToken')
    if (token == null || token.trim().length === 0)
      throw new RuntimeError('AUTH_REQUIRED', 'GitHub token is required')
    const config = normalizeConfig(request.config)
    const response = await ctx.http.request({
      path: new URL('user', config.apiBaseUrl).toString(),
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json' },
    })
    const user = (await response.json()) as Record<string, unknown>
    const externalAccountId = String(user.id ?? user.login ?? '')
    if (!externalAccountId)
      throw new RuntimeError(
        'INVALID_PROVIDER_RESPONSE',
        'GitHub did not return an account identifier',
      )
    const selectedRepos = stringArray(config.selectedRepos)
    return {
      externalAccountId,
      displayName: typeof user.login === 'string' ? user.login : 'GitHub',
      ...(typeof user.avatar_url === 'string' ? { avatarUrl: user.avatar_url } : {}),
      grantedScopes: parseScopes(response.headers.get('x-oauth-scopes')),
      config: { ...config, selectedRepos },
      resourceScope: { repos: selectedRepos },
      credential: { accessToken: token.trim(), tokenType: 'Bearer' },
    }
  }

  async healthCheck(ctx: RuntimeContext) {
    const startedAt = performance.now()
    await ctx.http.requestJson<Record<string, unknown>>({
      path: new URL('user', normalizeConfig(ctx.account.config).apiBaseUrl).toString(),
    })
    return {
      status: 'healthy' as const,
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  }

  async listTools(_ctx: RuntimeContext): Promise<RuntimeToolDefinition[]> {
    return [
      tool(
        'get_status',
        'GitHub 状态',
        '读取当前已连接的 GitHub 身份。',
        ['identity'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'list_repositories',
        '列出仓库',
        '列出当前账号可访问的 GitHub 仓库。',
        ['repositories'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'get_repository',
        '读取仓库',
        '读取一个授权 GitHub 仓库的元数据。',
        ['repositories'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'read_file',
        '读取文件',
        '读取授权仓库中指定分支的文件。',
        ['contents'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'list_issues',
        '列出 Issue',
        '列出一个授权仓库的 Issue。',
        ['issues'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'get_issue',
        '读取 Issue',
        '读取一个授权仓库的 Issue。',
        ['issues'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'list_pull_requests',
        '列出 Pull Request',
        '列出一个授权仓库的 Pull Request。',
        ['pull_requests'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'get_pull_request',
        '读取 Pull Request',
        '读取一个授权仓库的 Pull Request。',
        ['pull_requests'],
        'read',
        'read',
        'safe',
      ),
      tool(
        'create_issue',
        '创建 Issue',
        '创建 GitHub Issue，需要动作确认并开启写权限。',
        ['issues'],
        'high-write',
        'create',
        'keyed',
      ),
      tool(
        'comment_issue',
        '评论 Issue',
        '向 GitHub Issue 添加评论，需要动作确认并开启写权限。',
        ['issues'],
        'high-write',
        'create',
        'keyed',
      ),
      tool(
        'update_issue',
        '更新 Issue',
        '更新 GitHub Issue，需要动作确认并开启写权限。',
        ['issues'],
        'high-write',
        'update',
        'keyed',
      ),
      tool(
        'comment_pull_request',
        '评论 Pull Request',
        '向 GitHub Pull Request 添加评论，需要动作确认并开启写权限。',
        ['pull_requests'],
        'high-write',
        'create',
        'keyed',
      ),
      tool(
        'create_branch',
        '创建分支',
        '从指定提交创建 GitHub 分支，需要动作确认并开启写权限。',
        ['contents'],
        'high-write',
        'create',
        'keyed',
      ),
      tool(
        'create_pull_request',
        '创建 Pull Request',
        '创建 Pull Request，需要动作确认并开启写权限。',
        ['pull_requests'],
        'high-write',
        'create',
        'keyed',
      ),
      tool(
        'upsert_file',
        '写入文件',
        '创建或更新 GitHub 仓库文件，需要动作确认并开启写权限。',
        ['contents'],
        'high-write',
        'update',
        'keyed',
      ),
    ]
  }

  async invokeTool(ctx: RuntimeContext, toolName: string, input: unknown): Promise<unknown> {
    const params = objectInput(input)
    switch (toolName) {
      case 'status':
        return this.request(ctx, 'user')
      case 'get_status':
        return this.request(ctx, 'user')
      case 'list_repositories': {
        const repositories = await this.request<Record<string, unknown>[]>(
          ctx,
          'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
        )
        const selected = stringArray(ctx.account.resourceScope.repos)
        return selected.length === 0
          ? repositories
          : repositories.filter(
              (repository) =>
                typeof repository.full_name === 'string' && selected.includes(repository.full_name),
            )
      }
      case 'get_repository': {
        const repo = repoName(ctx, params)
        return this.request(ctx, `repos/${repo}`)
      }
      case 'read_file': {
        const repo = repoName(ctx, params)
        const path = safeRepositoryPath(requiredString(params, 'path'))
        const ref = optionalString(params, 'ref')
        const encodedPath = path
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/')
        const response = await this.request<Record<string, unknown>>(
          ctx,
          `repos/${repo}/contents/${encodedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
        )
        const content =
          typeof response.content === 'string' && response.encoding === 'base64'
            ? Buffer.from(response.content.replace(/\n/g, ''), 'base64').toString('utf8')
            : null
        return { ...response, decodedContent: content }
      }
      case 'list_issues':
        return this.request(ctx, `repos/${repoName(ctx, params)}/issues`, {
          state: optionalString(params, 'state') ?? 'open',
          per_page: clampNumber(params.perPage, 50, 1, 100),
        })
      case 'get_issue':
        return this.request(
          ctx,
          `repos/${repoName(ctx, params)}/issues/${positiveNumber(params, 'issueNumber')}`,
        )
      case 'list_pull_requests':
        return this.request(ctx, `repos/${repoName(ctx, params)}/pulls`, {
          state: optionalString(params, 'state') ?? 'open',
          per_page: clampNumber(params.perPage, 50, 1, 100),
        })
      case 'get_pull_request':
        return this.request(
          ctx,
          `repos/${repoName(ctx, params)}/pulls/${positiveNumber(params, 'pullNumber')}`,
        )
      case 'create_issue':
        this.requireWrite(ctx)
        return this.request(ctx, `repos/${repoName(ctx, params)}/issues`, undefined, 'POST', {
          title: requiredString(params, 'title'),
          ...(optionalString(params, 'body') ? { body: optionalString(params, 'body') } : {}),
          ...(stringArray(params.labels).length > 0 ? { labels: stringArray(params.labels) } : {}),
        })
      case 'comment_issue':
        this.requireWrite(ctx)
        return this.request(
          ctx,
          `repos/${repoName(ctx, params)}/issues/${positiveNumber(params, 'issueNumber')}/comments`,
          undefined,
          'POST',
          { body: requiredString(params, 'body') },
        )
      case 'update_issue':
        this.requireWrite(ctx)
        return this.request(
          ctx,
          `repos/${repoName(ctx, params)}/issues/${positiveNumber(params, 'issueNumber')}`,
          undefined,
          'PATCH',
          {
            ...(optionalString(params, 'title') ? { title: optionalString(params, 'title') } : {}),
            ...(optionalString(params, 'body') ? { body: optionalString(params, 'body') } : {}),
            ...(optionalString(params, 'state') ? { state: optionalString(params, 'state') } : {}),
          },
        )
      case 'comment_pull_request':
        this.requireWrite(ctx)
        return this.request(
          ctx,
          `repos/${repoName(ctx, params)}/issues/${positiveNumber(params, 'pullNumber')}/comments`,
          undefined,
          'POST',
          { body: requiredString(params, 'body') },
        )
      case 'create_branch': {
        this.requireWrite(ctx)
        const repo = repoName(ctx, params)
        const branch = validateBranchName(requiredString(params, 'branch'))
        let sha = optionalString(params, 'fromSha')
        if (sha == null) {
          const repository = await this.request<Record<string, unknown>>(ctx, `repos/${repo}`)
          const defaultBranch =
            typeof repository.default_branch === 'string' ? repository.default_branch : 'main'
          const reference = await this.request<Record<string, unknown>>(
            ctx,
            `repos/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
          )
          const object = reference.object
          sha =
            object != null &&
            typeof object === 'object' &&
            'sha' in object &&
            typeof object.sha === 'string'
              ? object.sha
              : undefined
        }
        if (sha == null || !/^[a-f0-9]{7,64}$/i.test(sha))
          throw new RuntimeError(
            'INVALID_PROVIDER_RESPONSE',
            'GitHub did not return a valid branch SHA',
          )
        return this.request(ctx, `repos/${repo}/git/refs`, undefined, 'POST', {
          ref: `refs/heads/${branch}`,
          sha,
        })
      }
      case 'create_pull_request':
        this.requireWrite(ctx)
        return this.request(ctx, `repos/${repoName(ctx, params)}/pulls`, undefined, 'POST', {
          title: requiredString(params, 'title'),
          head: requiredString(params, 'head'),
          base: requiredString(params, 'base'),
          ...(optionalString(params, 'body') ? { body: optionalString(params, 'body') } : {}),
          ...(typeof params.draft === 'boolean' ? { draft: params.draft } : {}),
        })
      case 'upsert_file':
        this.requireWrite(ctx)
        {
          const path = safeRepositoryPath(requiredString(params, 'path'))
          return this.request(
            ctx,
            `repos/${repoName(ctx, params)}/contents/${path
              .split('/')
              .map((part) => encodeURIComponent(part))
              .join('/')}`,
            undefined,
            'PUT',
            {
              message: requiredString(params, 'message'),
              content: Buffer.from(requiredString(params, 'content'), 'utf8').toString('base64'),
              ...(optionalString(params, 'branch')
                ? { branch: optionalString(params, 'branch') }
                : {}),
              ...(optionalString(params, 'sha') ? { sha: optionalString(params, 'sha') } : {}),
            },
          )
        }
      default:
        throw new RuntimeError(
          'RUNTIME_UNAVAILABLE',
          `Unsupported GitHub runtime tool: ${toolName}`,
        )
    }
  }

  private async request<T = Record<string, unknown> | Record<string, unknown>[]>(
    ctx: RuntimeContext,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    method = 'GET',
    json?: unknown,
  ): Promise<T> {
    const result = await ctx.http.requestJson<T>({
      path: new URL(path, normalizeConfig(ctx.account.config).apiBaseUrl).toString(),
      method,
      headers: { Accept: 'application/vnd.github+json' },
      ...(query !== undefined ? { query } : {}),
      ...(json !== undefined ? { json } : {}),
    })
    return result
  }

  private requireWrite(ctx: RuntimeContext): void {
    if (ctx.account.config.allowWrites !== true)
      throw new RuntimeError(
        'CAPABILITY_DISABLED',
        'GitHub write operations are disabled for this account',
      )
  }
}

function tool(
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

function normalizeConfig(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> & { apiBaseUrl: string; selectedRepos: string[]; allowWrites: boolean } {
  const configuredUrl =
    typeof value?.apiBaseUrl === 'string' && value.apiBaseUrl.trim().length > 0
      ? value.apiBaseUrl.trim()
      : API_BASE_URL
  let apiBaseUrl: string
  try {
    const parsed = new URL(configuredUrl)
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1')
      throw new Error('GitHub API base URL must use HTTPS')
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error('GitHub API base URL cannot contain credentials or query parameters')
    apiBaseUrl = `${parsed.toString().replace(/\/$/, '')}/`
  } catch {
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Invalid GitHub API base URL')
  }
  return {
    ...(value ?? {}),
    apiBaseUrl,
    selectedRepos: stringArray(value?.selectedRepos),
    allowWrites: value?.allowWrites === true,
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
function positiveNumber(value: Record<string, unknown>, key: string): number {
  const number = typeof value[key] === 'number' ? value[key] : Number(value[key])
  if (!Number.isInteger(number) || number <= 0)
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', `Invalid parameter: ${key}`)
  return number
}
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : []
}
function parseScopes(value: string | null): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  )
}
function repoName(ctx: RuntimeContext, params: Record<string, unknown>): string {
  const owner = requiredString(params, 'owner')
  const repo = requiredString(params, 'repo')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(owner))
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Invalid GitHub repository owner')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo))
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Invalid GitHub repository name')
  const name = `${owner}/${repo}`
  ctx.policy.requireResource(ctx.account, 'repos', name)
  return name
}

function safeRepositoryPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').some((part) => part === '..' || part.length === 0)
  )
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Invalid GitHub repository file path')
  return normalized
}

function validateBranchName(value: string): string {
  if (
    value.length > 240 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('\\') ||
    value.includes('@{') ||
    /(^|[/.])\.(?:$|[/.])/.test(value)
  )
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Invalid GitHub branch name')
  return value
}
