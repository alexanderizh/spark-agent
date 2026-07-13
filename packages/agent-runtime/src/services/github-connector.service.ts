import type {
  ConnectorCapabilityKind,
  GitHubConnectorConfig,
  GitHubConnectorConnection,
} from '@spark/protocol'
import { ConnectorConnectionRepository } from '@spark/storage'
import * as keystore from '@spark/shared/keystore'
import { SparkError } from '@spark/shared'

const GITHUB_CONNECTOR_ID = 'github-primary'
const GITHUB_PROVIDER = 'github'
const DEFAULT_API_BASE_URL = 'https://api.github.com'
const DEFAULT_WEB_BASE_URL = 'https://github.com'
const DEFAULT_ENABLED_CAPABILITIES: ConnectorCapabilityKind[] = [
  'identity',
  'repositories',
  'issues',
  'pull_requests',
  'mcp_tools',
]
const GITHUB_API_TIMEOUT_MS = 15_000

type GitHubUserResponse = {
  id?: number | string
  login?: string
  avatar_url?: string
  html_url?: string
  name?: string | null
}

type GitHubConnectorRuntimeContext = {
  connection: GitHubConnectorConnection
  token: string
  config: GitHubConnectorConfig
  normalizedRepoScope: Set<string>
}

type ConnectGitHubConnectorParams = {
  token: string
  name?: string
  apiBaseUrl?: string
  webBaseUrl?: string
  selectedRepos?: string[]
  enabledCapabilities?: ConnectorCapabilityKind[]
  allowWrites?: boolean
}

type UpdateGitHubConnectorParams = {
  name?: string
  apiBaseUrl?: string
  webBaseUrl?: string
  selectedRepos?: string[]
  enabledCapabilities?: ConnectorCapabilityKind[]
  allowWrites?: boolean
  enabled?: boolean
}

type GitHubIssueMutation = {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  labels?: string[]
  assignees?: string[]
}

function normalizeUrlWithTrailingSlash(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback
  const normalized = raw.endsWith('/') ? raw : `${raw}/`
  try {
    return new URL(normalized).toString()
  } catch {
    throw new SparkError('VALIDATION_FAILED', `无效的 GitHub URL：${raw}`)
  }
}

function normalizeRepoScope(repos: string[] | undefined): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const repo of repos ?? []) {
    const trimmed = repo.trim()
    if (trimmed.length === 0) continue

    let candidate = trimmed.replace(/\.git$/i, '').replace(/\/+$/g, '')
    if (/^https?:\/\//i.test(candidate)) {
      try {
        const url = new URL(candidate)
        candidate = url.pathname.replace(/^\/+/, '').replace(/\/+$/g, '')
      } catch {
        continue
      }
    }

    const segments = candidate.split('/').filter(Boolean)
    if (segments.length !== 2 || segments.some((segment) => /\s/.test(segment))) continue
    const key = `${segments[0]}/${segments[1]}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(key)
  }
  return normalized
}

function normalizeCapabilities(
  capabilities: ConnectorCapabilityKind[] | undefined,
): ConnectorCapabilityKind[] {
  const seen = new Set<string>()
  const normalized: ConnectorCapabilityKind[] = []
  for (const capability of capabilities ?? DEFAULT_ENABLED_CAPABILITIES) {
    const key = String(capability).trim()
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    normalized.push(key as ConnectorCapabilityKind)
  }
  return normalized
}

function normalizeConfig(
  partial: Partial<GitHubConnectorConfig> | undefined,
): GitHubConnectorConfig {
  return {
    apiBaseUrl: normalizeUrlWithTrailingSlash(partial?.apiBaseUrl, DEFAULT_API_BASE_URL),
    webBaseUrl: normalizeUrlWithTrailingSlash(partial?.webBaseUrl, DEFAULT_WEB_BASE_URL),
    selectedRepos: normalizeRepoScope(partial?.selectedRepos),
    enabledCapabilities: normalizeCapabilities(partial?.enabledCapabilities),
    syncIssues: partial?.syncIssues ?? true,
    syncPullRequests: partial?.syncPullRequests ?? true,
    allowWrites: partial?.allowWrites === true,
  }
}

function parseJsonObject<T>(value: string | null, fallback: T): T {
  if (value == null || value.trim().length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseGrantedScopes(header: string | null): string[] {
  if (header == null || header.trim().length === 0) return []
  return header
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function buildAccount(user: GitHubUserResponse): NonNullable<GitHubConnectorConnection['account']> {
  const login =
    typeof user.login === 'string' && user.login.trim().length > 0 ? user.login.trim() : 'github-user'
  return {
    id: typeof user.id === 'string' || typeof user.id === 'number' ? String(user.id) : login,
    login,
    ...(typeof user.name === 'string' && user.name.trim().length > 0
      ? { displayName: user.name.trim() }
      : {}),
    ...(typeof user.avatar_url === 'string' && user.avatar_url.trim().length > 0
      ? { avatarUrl: user.avatar_url }
      : {}),
    ...(typeof user.html_url === 'string' && user.html_url.trim().length > 0
      ? { htmlUrl: user.html_url }
      : {}),
  }
}

function toStoredConfig(config: GitHubConnectorConfig): Record<string, unknown> {
  return config as unknown as Record<string, unknown>
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function extractGitHubErrorMessage(responseText: string): string | null {
  const trimmed = responseText.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown }
    return typeof parsed.message === 'string' && parsed.message.trim().length > 0
      ? parsed.message.trim()
      : null
  } catch {
    return trimmed.slice(0, 240)
  }
}

export class GitHubConnectorService {
  constructor(private readonly repo: ConnectorConnectionRepository) {}

  getConnection(): GitHubConnectorConnection | null {
    const row = this.repo.getByProvider(GITHUB_PROVIDER)
    return row != null ? this.rowToConnection(row) : null
  }

  async verifyConnection(params: {
    token: string
    apiBaseUrl?: string
  }): Promise<{
    account: NonNullable<GitHubConnectorConnection['account']>
    grantedScopes: string[]
  }> {
    const token = params.token.trim()
    if (token.length === 0) {
      throw new SparkError('VALIDATION_FAILED', 'GitHub PAT 不能为空')
    }
    const apiBaseUrl = normalizeUrlWithTrailingSlash(params.apiBaseUrl, DEFAULT_API_BASE_URL)
    const response = await this.githubRequest('GET', apiBaseUrl, 'user', token)
    const user = (await response.json()) as GitHubUserResponse
    return {
      account: buildAccount(user),
      grantedScopes: parseGrantedScopes(response.headers.get('x-oauth-scopes')),
    }
  }

  async connect(params: ConnectGitHubConnectorParams): Promise<GitHubConnectorConnection> {
    const existing = this.repo.getByProvider(GITHUB_PROVIDER)
    const config = normalizeConfig({
      ...(params.apiBaseUrl !== undefined ? { apiBaseUrl: params.apiBaseUrl } : {}),
      ...(params.webBaseUrl !== undefined ? { webBaseUrl: params.webBaseUrl } : {}),
      ...(params.selectedRepos !== undefined ? { selectedRepos: params.selectedRepos } : {}),
      ...(params.enabledCapabilities !== undefined
        ? { enabledCapabilities: params.enabledCapabilities }
        : {}),
      ...(params.allowWrites !== undefined ? { allowWrites: params.allowWrites } : {}),
      syncIssues: true,
      syncPullRequests: true,
    })
    const { account, grantedScopes } = await this.verifyConnection({
      token: params.token,
      apiBaseUrl: config.apiBaseUrl,
    })

    const id = existing?.id ?? GITHUB_CONNECTOR_ID
    const name = params.name?.trim() || existing?.name || 'GitHub'
    const keystoreRef =
      existing?.keystore_ref != null && existing.keystore_ref.length > 0
        ? (existing.keystore_ref as keystore.KeystoreRef)
        : keystore.makeKeystoreRef('github-connector', id)

    await this.storeSecret(keystoreRef, params.token.trim())

    if (existing == null) {
      this.repo.create({
        id,
        provider: GITHUB_PROVIDER,
        name,
        authMethod: 'pat',
        status: 'connected',
        enabled: true,
        config: toStoredConfig(config),
        keystoreRef,
        grantedScopes,
        account,
        lastError: null,
      })
    } else {
      this.repo.update(existing.id, {
        name,
        authMethod: 'pat',
        status: 'connected',
        enabled: true,
        config: toStoredConfig(config),
        keystoreRef,
        grantedScopes,
        account,
        lastError: null,
      })
    }

    const connection = this.getConnection()
    if (connection == null) {
      throw new SparkError('UNKNOWN', 'GitHub 连接保存失败')
    }
    return connection
  }

  async updateConnection(params: UpdateGitHubConnectorParams): Promise<GitHubConnectorConnection> {
    const existing = this.repo.getByProvider(GITHUB_PROVIDER)
    if (existing == null) {
      throw new SparkError('NOT_FOUND', 'GitHub 连接尚未建立')
    }
    const current = this.rowToConnection(existing)
    const config = normalizeConfig({
      ...current.config,
      ...(params.apiBaseUrl !== undefined ? { apiBaseUrl: params.apiBaseUrl } : {}),
      ...(params.webBaseUrl !== undefined ? { webBaseUrl: params.webBaseUrl } : {}),
      ...(params.selectedRepos !== undefined ? { selectedRepos: params.selectedRepos } : {}),
      ...(params.enabledCapabilities !== undefined
        ? { enabledCapabilities: params.enabledCapabilities }
        : {}),
      ...(params.allowWrites !== undefined ? { allowWrites: params.allowWrites } : {}),
    })

    this.repo.update(existing.id, {
      ...(params.name !== undefined ? { name: params.name.trim() || 'GitHub' } : {}),
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      config: toStoredConfig(config),
      ...(existing.status === 'needs_auth' ? { status: 'needs_auth' } : {}),
    })

    const connection = this.getConnection()
    if (connection == null) {
      throw new SparkError('UNKNOWN', 'GitHub 连接更新失败')
    }
    return connection
  }

  async disconnect(): Promise<void> {
    const existing = this.repo.getByProvider(GITHUB_PROVIDER)
    if (existing == null) return
    if (existing.keystore_ref != null && existing.keystore_ref.length > 0) {
      await this.deleteSecret(existing.keystore_ref as keystore.KeystoreRef)
    }
    this.repo.delete(existing.id)
  }

  getStatusForTools(): {
    connection: GitHubConnectorConnection | null
    selectedRepos: string[]
    mcpToolsEnabled: boolean
  } {
    const connection = this.getConnection()
    return {
      connection,
      selectedRepos: connection?.config.selectedRepos ?? [],
      mcpToolsEnabled: connection?.config.enabledCapabilities.includes('mcp_tools') === true,
    }
  }

  async listRepositories(params: { query?: string }): Promise<unknown[]> {
    const ctx = await this.getRuntimeContext(['repositories', 'mcp_tools'])
    if (ctx.config.selectedRepos.length > 0) {
      const repos = await Promise.all(
        ctx.config.selectedRepos.map((fullName) =>
          this.requestJson<unknown>(
            ctx,
            'GET',
            `repos/${fullName}`,
          ),
        ),
      )
      return this.filterRepos(repos, params.query)
    }

    const repos = await this.requestJson<unknown[]>(
      ctx,
      'GET',
      'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    )
    return this.filterRepos(repos, params.query)
  }

  async getRepository(owner: string, repo: string): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['repositories', 'mcp_tools'], { repo: `${owner}/${repo}` })
    return await this.requestJson(ctx, 'GET', `repos/${owner}/${repo}`)
  }

  async readRepositoryFile(owner: string, repo: string, filePath: string, ref?: string): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['repositories', 'mcp_tools'], { repo: `${owner}/${repo}` })
    const encodedPath = filePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    const suffix = ref != null && ref.trim().length > 0 ? `?ref=${encodeURIComponent(ref.trim())}` : ''
    const result = (await this.requestJson<Record<string, unknown>>(
      ctx,
      'GET',
      `repos/${owner}/${repo}/contents/${encodedPath}${suffix}`,
    ))
    const content = typeof result.content === 'string' ? result.content.replace(/\n/g, '') : ''
    return {
      ...result,
      decodedContent:
        content.length > 0 && result.encoding === 'base64'
          ? Buffer.from(content, 'base64').toString('utf-8')
          : null,
    }
  }

  async createBranch(params: {
    owner: string
    repo: string
    branch: string
    sourceBranch?: string
    sourceSha?: string
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['repositories', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    const branch = params.branch.trim()
    if (branch.length === 0) throw new SparkError('VALIDATION_FAILED', '分支名不能为空')

    let sourceSha = params.sourceSha?.trim() || ''
    if (sourceSha.length === 0) {
      const repoInfo = (await this.requestJson<Record<string, unknown>>(
        ctx,
        'GET',
        `repos/${params.owner}/${params.repo}`,
      ))
      const sourceBranch =
        params.sourceBranch?.trim() ||
        (typeof repoInfo.default_branch === 'string' && repoInfo.default_branch.trim().length > 0
          ? repoInfo.default_branch
          : 'main')
      const refInfo = (await this.requestJson<{ object?: { sha?: string } }>(
        ctx,
        'GET',
        `repos/${params.owner}/${params.repo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`,
      ))
      sourceSha = refInfo.object?.sha?.trim() ?? ''
    }
    if (sourceSha.length === 0) {
      throw new SparkError('VALIDATION_FAILED', '无法解析源分支的 commit SHA')
    }

    return await this.requestJson(
      ctx,
      'POST',
      `repos/${params.owner}/${params.repo}/git/refs`,
      {
        ref: `refs/heads/${branch}`,
        sha: sourceSha,
      },
    )
  }

  async upsertRepositoryFile(params: {
    owner: string
    repo: string
    path: string
    content: string
    message: string
    branch?: string
    sha?: string
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['repositories', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    const encodedPath = params.path
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    const body: Record<string, unknown> = {
      message: params.message,
      content: Buffer.from(params.content, 'utf-8').toString('base64'),
    }
    if (params.branch != null && params.branch.trim().length > 0) body.branch = params.branch.trim()
    if (params.sha != null && params.sha.trim().length > 0) body.sha = params.sha.trim()
    return await this.requestJson(
      ctx,
      'PUT',
      `repos/${params.owner}/${params.repo}/contents/${encodedPath}`,
      body,
    )
  }

  async listIssues(params: {
    owner: string
    repo: string
    state?: 'open' | 'closed' | 'all'
    labels?: string[]
    assignee?: string
    page?: number
    perPage?: number
  }): Promise<unknown[]> {
    const ctx = await this.getRuntimeContext(['issues', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
    })
    const search = new URLSearchParams()
    if (params.state != null) search.set('state', params.state)
    if (params.assignee != null && params.assignee.trim().length > 0) search.set('assignee', params.assignee.trim())
    if (params.labels != null && params.labels.length > 0) search.set('labels', params.labels.join(','))
    search.set('page', String(params.page ?? 1))
    search.set('per_page', String(params.perPage ?? 50))
    const issues = await this.requestJson<Array<Record<string, unknown>>>(
      ctx,
      'GET',
      `repos/${params.owner}/${params.repo}/issues?${search.toString()}`,
    )
    return issues.filter((issue) => issue.pull_request == null)
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['issues', 'mcp_tools'], { repo: `${owner}/${repo}` })
    return await this.requestJson(ctx, 'GET', `repos/${owner}/${repo}/issues/${issueNumber}`)
  }

  async createIssue(params: {
    owner: string
    repo: string
    title: string
    body?: string
    labels?: string[]
    assignees?: string[]
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['issues', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    return await this.requestJson(
      ctx,
      'POST',
      `repos/${params.owner}/${params.repo}/issues`,
      {
        title: params.title,
        ...(params.body != null ? { body: params.body } : {}),
        ...(params.labels != null ? { labels: params.labels } : {}),
        ...(params.assignees != null ? { assignees: params.assignees } : {}),
      },
    )
  }

  async updateIssue(params: {
    owner: string
    repo: string
    issueNumber: number
    patch: GitHubIssueMutation
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['issues', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    return await this.requestJson(
      ctx,
      'PATCH',
      `repos/${params.owner}/${params.repo}/issues/${params.issueNumber}`,
      params.patch,
    )
  }

  async commentOnIssue(params: {
    owner: string
    repo: string
    issueNumber: number
    body: string
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['issues', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    return await this.requestJson(
      ctx,
      'POST',
      `repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/comments`,
      { body: params.body },
    )
  }

  async listPullRequests(params: {
    owner: string
    repo: string
    state?: 'open' | 'closed' | 'all'
    head?: string
    base?: string
    page?: number
    perPage?: number
  }): Promise<unknown[]> {
    const ctx = await this.getRuntimeContext(['pull_requests', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
    })
    const search = new URLSearchParams()
    if (params.state != null) search.set('state', params.state)
    if (params.head != null && params.head.trim().length > 0) search.set('head', params.head.trim())
    if (params.base != null && params.base.trim().length > 0) search.set('base', params.base.trim())
    search.set('page', String(params.page ?? 1))
    search.set('per_page', String(params.perPage ?? 50))
    return await this.requestJson(
      ctx,
      'GET',
      `repos/${params.owner}/${params.repo}/pulls?${search.toString()}`,
    )
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['pull_requests', 'mcp_tools'], {
      repo: `${owner}/${repo}`,
    })
    return await this.requestJson(ctx, 'GET', `repos/${owner}/${repo}/pulls/${pullNumber}`)
  }

  async createPullRequest(params: {
    owner: string
    repo: string
    title: string
    body?: string
    head: string
    base: string
    draft?: boolean
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['pull_requests', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    return await this.requestJson(
      ctx,
      'POST',
      `repos/${params.owner}/${params.repo}/pulls`,
      {
        title: params.title,
        head: params.head,
        base: params.base,
        ...(params.body != null ? { body: params.body } : {}),
        ...(params.draft !== undefined ? { draft: params.draft } : {}),
      },
    )
  }

  async commentOnPullRequest(params: {
    owner: string
    repo: string
    pullNumber: number
    body: string
  }): Promise<unknown> {
    const ctx = await this.getRuntimeContext(['pull_requests', 'mcp_tools'], {
      repo: `${params.owner}/${params.repo}`,
      write: true,
    })
    return await this.requestJson(
      ctx,
      'POST',
      `repos/${params.owner}/${params.repo}/issues/${params.pullNumber}/comments`,
      { body: params.body },
    )
  }

  private rowToConnection(row: {
    id: string
    provider: string
    name: string
    auth_method: string
    status: string
    enabled: number
    config_json: string
    granted_scopes_json: string
    account_json: string | null
    last_sync_at: string | null
    last_error: string | null
    created_at: string
    updated_at: string
  }): GitHubConnectorConnection {
    const config = normalizeConfig(parseJsonObject<Partial<GitHubConnectorConfig>>(row.config_json, {}))
    const account = parseJsonObject<Record<string, unknown> | null>(row.account_json, null)
    const connection: GitHubConnectorConnection = {
      id: row.id,
      provider: row.provider,
      name: row.name,
      authMethod: row.auth_method as GitHubConnectorConnection['authMethod'],
      status: row.status as GitHubConnectorConnection['status'],
      enabled: row.enabled === 1,
      config,
      grantedScopes: parseJsonObject<string[]>(row.granted_scopes_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    if (account != null) {
      connection.account = account as NonNullable<GitHubConnectorConnection['account']>
    }
    if (row.last_sync_at != null) {
      connection.lastSyncAt = row.last_sync_at
    }
    if (row.last_error != null) {
      connection.lastError = row.last_error
    }
    return connection
  }

  private async getRuntimeContext(
    requiredCapabilities: ConnectorCapabilityKind[],
    options?: { repo?: string; write?: boolean },
  ): Promise<GitHubConnectorRuntimeContext> {
    const row = this.repo.getByProvider(GITHUB_PROVIDER)
    if (row == null) {
      throw new SparkError('NOT_FOUND', 'GitHub 连接尚未建立')
    }
    if (row.enabled !== 1) {
      throw new SparkError('PERMISSION_DENIED', 'GitHub 连接已禁用')
    }
    const connection = this.rowToConnection(row)
    const config = connection.config
    const ref = row.keystore_ref
    if (ref == null || ref.length === 0) {
      throw new SparkError('KEYSTORE_KEY_NOT_FOUND', 'GitHub 连接缺少凭证引用')
    }

    let token: string | null
    try {
      token = await keystore.getSecret(ref as keystore.KeystoreRef)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new SparkError(
        'KEYSTORE_UNAVAILABLE',
        `系统凭证库不可用，无法读取 GitHub PAT：${message}`,
      )
    }
    if (token == null || token.trim().length === 0) {
      throw new SparkError('KEYSTORE_KEY_NOT_FOUND', 'GitHub PAT 不存在，请重新连接 GitHub')
    }

    for (const capability of requiredCapabilities) {
      if (!config.enabledCapabilities.includes(capability)) {
        throw new SparkError(
          'PERMISSION_DENIED',
          `GitHub 连接未启用能力：${capability}`,
        )
      }
    }
    if (options?.write === true && !config.allowWrites) {
      throw new SparkError('PERMISSION_DENIED', 'GitHub 连接当前未开启写入权限')
    }

    const normalizedRepoScope = new Set(config.selectedRepos.map((item) => item.toLowerCase()))
    if (options?.repo != null && normalizedRepoScope.size > 0) {
      const repoKey = options.repo.trim().toLowerCase()
      if (!normalizedRepoScope.has(repoKey)) {
        throw new SparkError(
          'PERMISSION_DENIED',
          `仓库 ${options.repo} 不在当前 GitHub 连接的授权范围内`,
        )
      }
    }

    return {
      connection,
      token: token.trim(),
      config,
      normalizedRepoScope,
    }
  }

  private async requestJson<T>(
    ctx: GitHubConnectorRuntimeContext,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.githubRequest(
      method,
      ctx.config.apiBaseUrl,
      path,
      ctx.token,
      body,
    )
    const json = (await response.json()) as T
    this.markConnectionHealthy(ctx.connection.id)
    return json
  }

  private async githubRequest(
    method: string,
    apiBaseUrl: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<Response> {
    const url = new URL(path.replace(/^\//, ''), apiBaseUrl).toString()
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new SparkError('PROVIDER_UNAVAILABLE', `GitHub API 请求失败：${message}`)
    }

    if (response.ok) return response

    const responseText = await readResponseText(response)
    const detail = extractGitHubErrorMessage(responseText)
    const message =
      response.status === 401 || response.status === 403
        ? `GitHub 认证失败：${detail ?? `HTTP ${response.status}`}`
        : response.status === 404
          ? `GitHub 资源不存在：${detail ?? 'HTTP 404'}`
          : response.status === 422
            ? `GitHub 请求参数无效：${detail ?? 'HTTP 422'}`
            : response.status === 429
              ? 'GitHub API 请求过于频繁，请稍后重试'
              : `GitHub API 错误：HTTP ${response.status}${detail != null ? ` - ${detail}` : ''}`

    const row = this.repo.getByProvider(GITHUB_PROVIDER)
    if (row != null) {
      this.repo.update(row.id, {
        status: response.status === 401 || response.status === 403 ? 'error' : row.status,
        lastError: message,
      })
    }
    if (response.status === 401 || response.status === 403) {
      throw new SparkError('PROVIDER_AUTH_FAILED', message)
    }
    if (response.status === 429) {
      throw new SparkError('PROVIDER_RATE_LIMITED', message)
    }
    throw new SparkError('PROVIDER_UNAVAILABLE', message)
  }

  private filterRepos(repos: unknown[], query: string | undefined): unknown[] {
    const trimmed = query?.trim().toLowerCase() ?? ''
    if (trimmed.length === 0) return repos
    return repos.filter((repo) => {
      if (repo == null || typeof repo !== 'object') return false
      const name = typeof (repo as { full_name?: unknown }).full_name === 'string'
        ? (repo as { full_name: string }).full_name.toLowerCase()
        : ''
      const description = typeof (repo as { description?: unknown }).description === 'string'
        ? (repo as { description: string }).description.toLowerCase()
        : ''
      return name.includes(trimmed) || description.includes(trimmed)
    })
  }

  private markConnectionHealthy(id: string): void {
    this.repo.update(id, {
      status: 'connected',
      lastError: null,
      lastSyncAt: new Date().toISOString(),
    })
  }

  private async storeSecret(ref: keystore.KeystoreRef, token: string): Promise<void> {
    try {
      await keystore.setSecret(ref, token)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new SparkError(
        'KEYSTORE_UNAVAILABLE',
        `系统凭证库不可用，无法保存 GitHub PAT：${message}`,
      )
    }
  }

  private async deleteSecret(ref: keystore.KeystoreRef): Promise<void> {
    try {
      await keystore.deleteSecret(ref)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new SparkError(
        'KEYSTORE_UNAVAILABLE',
        `系统凭证库不可用，无法删除 GitHub PAT：${message}`,
      )
    }
  }
}
