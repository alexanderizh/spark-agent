/**
 * Unified Connector Protocol
 *
 * Connectors describe authenticated third-party platform integrations that can
 * later expose capabilities to agents, workflows, MCP servers, or UI features.
 * The protocol is intentionally provider-neutral; provider-specific details live
 * under `config`, `auth`, and `capabilities`.
 */

export type ConnectorProviderId =
  | 'github'
  | 'gitlab'
  | 'jira'
  | 'linear'
  | 'slack'
  | 'notion'
  | (string & {})

export type ConnectorAuthMethod =
  | 'oauth2'
  | 'device-code'
  | 'pat'
  | 'api-key'
  | 'github-app'
  | 'app-installation'
  | 'mcp-oauth2.1'
  | 'none'

export type ConnectorAuthFlow =
  | 'authorization-code-pkce'
  | 'device-code'
  | 'personal-access-token'
  | 'app-installation-token'
  | 'mcp-oauth2.1'
  | 'none'

export type ConnectorSecretStorage = 'keystore' | 'vault' | 'memory-only' | 'not-stored'

export type ConnectorConnectionStatus =
  | 'not_configured'
  | 'needs_auth'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'disabled'

export type ConnectorCapabilityKind =
  | 'identity'
  | 'repositories'
  | 'issues'
  | 'pull_requests'
  | 'commits'
  | 'contents'
  | 'actions'
  | 'webhooks'
  | 'mcp_tools'
  | (string & {})

export interface ConnectorAuthDescriptor {
  method: ConnectorAuthMethod
  flow: ConnectorAuthFlow
  /** User-facing label, e.g. "OAuth 登录" or "Fine-grained PAT". */
  label: string
  description?: string
  recommendedFor: Array<'desktop' | 'headless' | 'team' | 'development' | 'mcp'>
  /** Secret field names are references only; values must be stored in keystore/vault. */
  secretFields?: string[]
  secretStorage: ConnectorSecretStorage
  scopes?: string[]
  authorizationUrl?: string
  tokenUrl?: string
  deviceAuthorizationUrl?: string
  installationUrl?: string
  callbackPath?: string
  docsUrl?: string
}

export interface ConnectorCapabilityDescriptor {
  id: ConnectorCapabilityKind
  label: string
  description: string
  requiredScopes?: string[]
  risk: 'low' | 'medium' | 'high'
  enabledByDefault: boolean
}

export interface ConnectorProviderManifest {
  protocolVersion: '2026-06-25'
  provider: ConnectorProviderId
  displayName: string
  description: string
  icon: 'github' | 'generic' | string
  auth: ConnectorAuthDescriptor[]
  capabilities: ConnectorCapabilityDescriptor[]
  endpoints?: {
    apiBaseUrl?: string
    webBaseUrl?: string
    mcpServerUrl?: string
  }
  security: {
    preferredAuthFlow: ConnectorAuthFlow
    tokenStorage: ConnectorSecretStorage
    supportsPkce: boolean
    supportsDeviceFlow: boolean
    supportsInstallationTokens: boolean
    notes: string[]
  }
}

export interface ConnectorConnection<TConfig extends object = Record<string, unknown>> {
  id: string
  provider: ConnectorProviderId
  name: string
  authMethod: ConnectorAuthMethod
  status: ConnectorConnectionStatus
  enabled: boolean
  config: TConfig
  grantedScopes: string[]
  account?: {
    id: string
    login: string
    displayName?: string
    avatarUrl?: string
    htmlUrl?: string
  }
  lastSyncAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface GitHubConnectorConfig {
  apiBaseUrl: string
  webBaseUrl: string
  selectedRepos: string[]
  enabledCapabilities: ConnectorCapabilityKind[]
  syncIssues: boolean
  syncPullRequests: boolean
  allowWrites: boolean
}

export type GitHubConnectorConnection = ConnectorConnection<GitHubConnectorConfig>

export interface ExternalSource {
  provider: 'github'
  objectType: 'issue' | 'pull_request' | 'repository' | 'commit'
  connectorId: string
  remoteId: string
  displayId: string
  owner: string
  repo: string
  number?: number
  htmlUrl: string
  syncedAt: number
  lastRemoteUpdateAt: string
  syncState?: 'synced' | 'stale' | 'error' | 'detached'
  externalMeta?: Record<string, unknown>
}

export const GITHUB_CONNECTOR_MANIFEST: ConnectorProviderManifest = {
  protocolVersion: '2026-06-25',
  provider: 'github',
  displayName: 'GitHub',
  description:
    '连接 GitHub 账号后，Agent 可在授权范围内读取仓库、管理 Issue / PR、拉取与提交代码。',
  icon: 'github',
  auth: [
    {
      method: 'pat',
      flow: 'personal-access-token',
      label: 'Fine-grained Personal Access Token',
      description: '使用 Fine-grained PAT 建立并持久化 GitHub 连接，凭证由系统 keystore 保存。',
      recommendedFor: ['development'],
      secretFields: ['token'],
      secretStorage: 'keystore',
      scopes: ['metadata:read', 'contents:read', 'issues:read', 'pull_requests:read'],
      docsUrl:
        'https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens',
    },
  ],
  capabilities: [
    {
      id: 'identity',
      label: '身份识别',
      description: '读取当前登录用户、组织与授权范围，用于连接状态展示。',
      requiredScopes: ['read:user'],
      risk: 'low',
      enabledByDefault: true,
    },
    {
      id: 'repositories',
      label: '仓库管理',
      description: '列出、筛选、克隆和同步授权仓库。',
      requiredScopes: ['metadata:read', 'contents:read'],
      risk: 'medium',
      enabledByDefault: true,
    },
    {
      id: 'issues',
      label: 'Issue',
      description: '读取和同步 Issue，后续可写回状态、标签与评论。',
      requiredScopes: ['issues:read'],
      risk: 'medium',
      enabledByDefault: true,
    },
    {
      id: 'pull_requests',
      label: 'Pull Request',
      description: '读取 PR、创建分支、提交变更并发起 Pull Request。',
      requiredScopes: ['pull_requests:read', 'contents:write'],
      risk: 'high',
      enabledByDefault: true,
    },
    {
      id: 'mcp_tools',
      label: 'MCP 工具桥接',
      description: '把 GitHub 能力以 MCP 工具集形式注入 Agent 运行时。',
      risk: 'high',
      enabledByDefault: true,
    },
  ],
  endpoints: {
    apiBaseUrl: 'https://api.github.com',
    webBaseUrl: 'https://github.com',
    mcpServerUrl: 'https://api.githubcopilot.com/mcp/',
  },
  security: {
    preferredAuthFlow: 'personal-access-token',
    tokenStorage: 'keystore',
    supportsPkce: false,
    supportsDeviceFlow: false,
    supportsInstallationTokens: false,
    notes: [
      'PAT 仅用于开发期或手动接入，界面不持久化明文 token。',
      '远程 MCP 连接器应对齐 OAuth 2.1 授权模型。',
    ],
  },
}
