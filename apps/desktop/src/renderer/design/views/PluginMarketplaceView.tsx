import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input, Modal, Switch, Tag } from 'antd'
import type {
  ConnectorAccount,
  InstalledPluginItem,
  PluginInspection,
  PluginMarketplaceItem,
  PluginPermission,
  PluginRuntimeStatusItem,
  RuntimeConnectRequest,
} from '@spark/protocol'
import { Github, Google, Notion, Obsidian } from '@lobehub/icons/es/icons'
import { Button, SearchBar } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { filterMarketplaceItemsForDisplay, groupInstalledPlugins } from './plugin-marketplace-model'
import gmailBrandIconUrl from '../../assets/plugin-icons/google-gmail.svg'
import googleCalendarBrandIconUrl from '../../assets/plugin-icons/google-calendar.svg'
import './PluginMarketplaceView.less'

const PERMISSION_LABELS: Record<string, string> = {
  network: '访问网络',
  'filesystem.read': '读取本地文件',
  'filesystem.write': '写入本地文件',
  'process.spawn': '启动本地进程',
  'secrets.read': '读取凭据',
  clipboard: '访问剪贴板',
  browser: '控制浏览器',
  'mcp.connect': '连接 MCP 服务',
  'connector.account': '访问连接器账户',
}

function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission
}

function PluginIcon({
  id,
  name,
  icon,
  iconUrl,
  market = false,
}: {
  id: string
  name: string
  icon?: string | undefined
  iconUrl?: string | undefined
  market?: boolean
}) {
  const key = `${icon ?? ''} ${id} ${name}`.toLowerCase()
  if (iconUrl?.startsWith('https://')) {
    return <img className="plugin-brand-image" src={iconUrl} alt="" aria-hidden="true" />
  }
  if (key.includes('notion')) return <Notion.Avatar size={38} />
  if (key.includes('github')) return <Github.Avatar size={38} />
  if (key.includes('obsidian')) return <Obsidian.Color size={36} />
  if (key.includes('calendar')) {
    return (
      <img
        className="plugin-brand-image"
        src={googleCalendarBrandIconUrl}
        alt=""
        aria-hidden="true"
      />
    )
  }
  if (key.includes('gmail')) {
    return <img className="plugin-brand-image" src={gmailBrandIconUrl} alt="" aria-hidden="true" />
  }
  if (key.includes('google')) return <Google.Color size={36} />
  return market ? <Icons.Sparkles size={20} /> : <Icons.Plugins size={20} />
}

function ContributionChips({ plugin }: { plugin: InstalledPluginItem }) {
  const chips = [
    plugin.contributionCounts.skills > 0 ? `Skill ${plugin.contributionCounts.skills}` : null,
    plugin.contributionCounts.mcpServers > 0 ? `MCP ${plugin.contributionCounts.mcpServers}` : null,
    plugin.contributionCounts.connectors > 0
      ? `连接器 ${plugin.contributionCounts.connectors}`
      : null,
    (plugin.contributionCounts.runtimes ?? 0) > 0
      ? `运行时 ${plugin.contributionCounts.runtimes}`
      : null,
  ].filter((value): value is string => value != null)
  return chips.length > 0 ? (
    <div className="plugin-card-contributions">
      {chips.map((chip) => (
        <span key={chip}>{chip}</span>
      ))}
    </div>
  ) : (
    <span className="plugin-card-muted">未声明能力</span>
  )
}

function PluginCard({
  plugin,
  duplicateCount = 1,
  canUninstall,
  onToggle,
  onUninstall,
  runtime,
  runtimeAccounts,
  onRuntimeAction,
}: {
  plugin: InstalledPluginItem
  duplicateCount?: number
  canUninstall: boolean
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
  runtime?: PluginRuntimeStatusItem
  runtimeAccounts?: ConnectorAccount[]
  onRuntimeAction?: (runtime: PluginRuntimeStatusItem) => void
}) {
  const granted = plugin.permissions.filter((permission) => permission.state === 'granted').length
  const pending = plugin.permissions.filter((permission) => permission.state !== 'granted')
  const hasConnector = plugin.contributionCounts.connectors > 0
  const hasRuntime = runtime != null
  const connectedAccount = runtimeAccounts?.find(
    (account) => account.status === 'connected' && account.enabled,
  )
  const source =
    plugin.trust === 'verified'
      ? { label: '已验证', tone: 'verified' }
      : plugin.trust === 'bundled'
        ? { label: '内置', tone: 'bundled' }
        : { label: '本地', tone: 'local' }
  return (
    <article className={`plugin-card${plugin.enabled ? '' : ' is-disabled'}`}>
      <div className={`plugin-card-icon${hasConnector ? ' is-connector' : ''}`}>
        <PluginIcon id={plugin.id} name={plugin.displayName} icon={plugin.icon} />
      </div>
      <div className="plugin-card-content">
        <header className="plugin-card-head">
          <div className="plugin-card-heading">
            <div className="plugin-card-title">{plugin.displayName}</div>
            <div className="plugin-card-subtitle">
              {plugin.author} · v{plugin.version}
            </div>
          </div>
          <div className="plugin-card-actions">
            <span className={`plugin-card-state${plugin.enabled ? ' is-enabled' : ''}`}>
              {plugin.enabled ? '已启用' : '已停用'}
            </span>
            <Switch
              size="small"
              checked={plugin.enabled}
              onChange={onToggle}
              aria-label={`${plugin.enabled ? '停用' : '启用'} ${plugin.displayName}`}
            />
            {canUninstall && (
              <button
                type="button"
                className="plugin-card-remove"
                onClick={onUninstall}
                aria-label={`移除 ${plugin.displayName}`}
                title="移除非内置连接器"
              >
                <Icons.Trash size={14} />
              </button>
            )}
          </div>
        </header>
        <p className="plugin-card-description">{plugin.description}</p>
        <div className="plugin-card-meta">
          <span className={`plugin-source-badge is-${source.tone}`}>{source.label}</span>
          {duplicateCount > 1 && (
            <span className="plugin-card-merged-badge">已合并 {duplicateCount} 个来源</span>
          )}
          <ContributionChips plugin={plugin} />
          <span className="plugin-card-permissions" title="已授权权限">
            <Icons.Shield size={12} />
            权限 {granted}/{plugin.permissions.length}
          </span>
        </div>
        {hasRuntime ? (
          <div
            className={`plugin-card-availability${connectedAccount ? ' is-connected' : ''}${runtime.enabled ? '' : ' is-disabled'}`}
          >
            <span className="plugin-availability-dot" />
            <div className="plugin-card-availability-copy">
              <strong>
                {connectedAccount
                  ? `${runtime.runtime.displayName} · ${connectedAccount.displayName}`
                  : runtime.enabled
                    ? '等待连接账号'
                    : '连接器已停用'}
              </strong>
              <span>
                {connectedAccount
                  ? `${runtime.accountCount} 个账号可供 Agent 使用`
                  : runtime.enabled
                    ? '连接后 Agent 才会获得这个运行时的工具。'
                    : '启用连接器后才能连接账号和使用工具。'}
              </span>
            </div>
            {onRuntimeAction && runtime.enabled && (
              <button
                type="button"
                className="plugin-runtime-action"
                onClick={() => onRuntimeAction(runtime)}
              >
                {connectedAccount ? '账号设置' : '连接账号'}
                <Icons.ChevronRight size={12} />
              </button>
            )}
          </div>
        ) : hasConnector ? (
          <div className="plugin-card-availability">
            <span className="plugin-availability-dot" />
            <div className="plugin-card-availability-copy">
              <strong>尚未连接</strong>
              <span>需要完成 OAuth 或 API 适配后，Agent 才能调用。</span>
            </div>
          </div>
        ) : null}
        {pending.length > 0 && (
          <div className="plugin-pending-permissions">
            <Icons.Shield size={13} />
            待授权：{pending.map((permission) => permissionLabel(permission.permission)).join('、')}
          </div>
        )}
      </div>
    </article>
  )
}

function oauthEndpoints(runtimeId: string): {
  authorizationUrl: string
  tokenUrl: string
} {
  if (runtimeId === 'notion') {
    return {
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
    }
  }
  return {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  }
}

function accountDisplayName(account: ConnectorAccount, runtimeName: string): string {
  const displayName = account.displayName?.trim()
  if (displayName) return displayName
  const externalId = account.externalAccountId?.trim()
  return externalId ? `${runtimeName} · ${externalId}` : `${runtimeName} 账号`
}

function accountStatusLabel(account: ConnectorAccount): string {
  if (account.status === 'connected' && account.enabled) return 'Agent 可用'
  if (account.status === 'needs_auth') return '需要重新授权'
  if (account.status === 'syncing') return '同步中'
  if (account.status === 'disabled' || !account.enabled) return '已停用'
  if (account.status === 'error') return '连接异常'
  return '尚未连接'
}

function manualRuntimeRequest(
  status: PluginRuntimeStatusItem,
  secret: string,
  vaultPath: string,
  enabledCapabilities: string[],
): RuntimeConnectRequest {
  const runtimeId = status.runtime.id
  if (runtimeId === 'obsidian') {
    return {
      authMethod: 'none',
      config: { vaultPath: vaultPath.trim() },
      enabledCapabilities,
    }
  }
  const authMethod = runtimeId === 'github' ? 'pat' : runtimeId === 'notion' ? 'api-key' : 'oauth2'
  const config =
    runtimeId === 'google'
      ? {
          grantedScopes: status.runtime.capabilities
            .filter((capability) => capability.enabledByDefault)
            .flatMap((capability) => capability.requiredScopes ?? []),
        }
      : {}
  return {
    authMethod,
    secrets: { ...(runtimeId === 'google' ? { accessToken: secret } : { token: secret }) },
    ...(Object.keys(config).length > 0 ? { config } : {}),
    enabledCapabilities,
  }
}

function RuntimeAccountModal({
  runtime,
  accounts,
  mode,
  secret,
  vaultPath,
  clientId,
  onModeChange,
  onSecretChange,
  onClientIdChange,
  onChooseVault,
  onDisconnect,
  onToggleCapability,
  onOpenAuthGuide,
}: {
  runtime: PluginRuntimeStatusItem
  accounts: ConnectorAccount[]
  mode: 'token' | 'oauth'
  secret: string
  vaultPath: string
  clientId: string
  onModeChange: (mode: 'token' | 'oauth') => void
  onSecretChange: (value: string) => void
  onClientIdChange: (value: string) => void
  onChooseVault: () => void
  onDisconnect: (account: ConnectorAccount) => void
  onToggleCapability: (account: ConnectorAccount, capability: string) => void
  onOpenAuthGuide: (url: string) => void
}) {
  const runtimeId = runtime.runtime.id
  const canOAuth = runtime.runtime.authMethods.includes('oauth2')
  const canToken = runtime.runtime.authMethods.some((method) =>
    ['pat', 'api-key', 'oauth2'].includes(method),
  )
  return (
    <div className="plugin-runtime-modal">
      <p>{runtime.runtime.description}</p>
      {accounts.length > 0 && (
        <div className="plugin-runtime-accounts">
          <div className="plugin-runtime-subtitle">已连接账号</div>
          {accounts.map((account) => (
            <div className="plugin-runtime-account" key={account.id}>
              <div className="plugin-runtime-account-icon">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt="" aria-hidden="true" />
                ) : (
                  <PluginIcon
                    id={runtime.runtime.id}
                    name={runtime.runtime.displayName}
                    icon={runtime.runtime.icon}
                  />
                )}
              </div>
              <div className="plugin-runtime-account-copy">
                <strong>{accountDisplayName(account, runtime.runtime.displayName)}</strong>
                <span className={`plugin-runtime-account-status is-${account.status}`}>
                  {accountStatusLabel(account)}
                </span>
                {account.status === 'error' && account.lastError && (
                  <small>{account.lastError}</small>
                )}
              </div>
              <Button type="text" danger onClick={() => onDisconnect(account)}>
                断开
              </Button>
            </div>
          ))}
        </div>
      )}
      {canOAuth && canToken && (
        <div className="plugin-runtime-mode-switch" role="tablist" aria-label="授权方式">
          <button
            type="button"
            className={mode === 'oauth' ? 'is-active' : ''}
            onClick={() => onModeChange('oauth')}
          >
            OAuth 授权
          </button>
          <button
            type="button"
            className={mode === 'token' ? 'is-active' : ''}
            onClick={() => onModeChange('token')}
          >
            手动令牌
          </button>
        </div>
      )}
      {runtimeId === 'obsidian' ? (
        <>
          <label className="plugin-runtime-field">
            <span>Vault 目录</span>
            <div className="plugin-runtime-path-field">
              <Input value={vaultPath} readOnly placeholder="选择一个本地 Vault 目录" />
              <Button icon={<Icons.FolderOpen size={14} />} onClick={onChooseVault}>
                选择
              </Button>
            </div>
          </label>
          <div className="plugin-runtime-note">只允许访问这个目录内的 Markdown 文件。</div>
        </>
      ) : mode === 'oauth' && canOAuth ? (
        <>
          <label className="plugin-runtime-field">
            <span>OAuth Client ID</span>
            <Input
              value={clientId}
              onChange={(event) => onClientIdChange(event.target.value)}
              placeholder="桌面应用的 public client id"
              autoComplete="off"
            />
          </label>
          {runtime.runtime.authGuides?.oauth && (
            <AuthGuideLink guide={runtime.runtime.authGuides.oauth} onOpen={onOpenAuthGuide} />
          )}
          <div className="plugin-runtime-note">
            Spark 会通过本机 loopback + PKCE 打开授权页；不会把 Provider access token
            放入插件包、SQLite 或 Agent 上下文。
          </div>
        </>
      ) : (
        <>
          <label className="plugin-runtime-field">
            <span className="plugin-runtime-field-heading">
              <span>{runtimeId === 'github' ? 'Fine-grained PAT' : '访问令牌'}</span>
              {runtime.runtime.authGuides?.token && (
                <AuthGuideLink guide={runtime.runtime.authGuides.token} onOpen={onOpenAuthGuide} />
              )}
            </span>
            <Input.Password
              value={secret}
              onChange={(event) => onSecretChange(event.target.value)}
              placeholder={runtimeId === 'github' ? 'github_pat_…' : '只在本次连接请求中使用'}
              autoComplete="off"
            />
          </label>
          <div className="plugin-runtime-note">
            令牌只通过主进程保存到系统 keystore；连接完成后输入框会立即清空。
          </div>
        </>
      )}
      <div className="plugin-runtime-capabilities">
        <div className="plugin-runtime-subtitle">默认能力</div>
        <div className="plugin-runtime-capability-list">
          {runtime.runtime.capabilities.map((capability) => {
            const account = accounts[0]
            const enabled =
              account?.enabledCapabilities.includes(capability.id) ?? capability.enabledByDefault
            return (
              <button
                type="button"
                className={`plugin-runtime-capability${enabled ? ' is-enabled' : ''}`}
                key={capability.id}
                disabled={account == null}
                onClick={() => {
                  if (account) onToggleCapability(account, capability.id)
                }}
                title={capability.description}
              >
                {capability.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AuthGuideLink({
  guide,
  onOpen,
}: {
  guide: { label: string; url: string; description?: string }
  onOpen: (url: string) => void
}) {
  return (
    <span className="plugin-runtime-auth-guide">
      <button type="button" onClick={() => onOpen(guide.url)}>
        {guide.label}
        <Icons.ExternalLink size={12} />
      </button>
      {guide.description && <small>{guide.description}</small>}
    </span>
  )
}

function MarketplaceCard({
  item,
  onInstall,
}: {
  item: PluginMarketplaceItem
  onInstall: () => void
}) {
  return (
    <article className="plugin-market-card">
      <div className="plugin-card-icon market">
        <PluginIcon id={item.id} name={item.displayName} iconUrl={item.iconUrl} market />
      </div>
      <div className="plugin-card-content">
        <header className="plugin-card-head">
          <div className="plugin-market-card-heading">
            <div className="plugin-card-title">{item.displayName}</div>
            <div className="plugin-card-subtitle">
              {item.author} · v{item.version} · {item.marketplaceId}
            </div>
          </div>
          <Button
            size="small"
            type="primary"
            disabled={item.installed || item.trust !== 'verified'}
            onClick={onInstall}
          >
            {item.installed ? '已安装' : item.trust !== 'verified' ? '未验证' : '安装'}
          </Button>
        </header>
        <p className="plugin-card-description">{item.description || '这个连接器没有提供描述。'}</p>
        <div className="plugin-card-meta">
          <Tag color={item.trust === 'verified' ? 'green' : 'orange'}>
            {item.trust === 'verified' ? '来源已验证' : '暂不可安装'}
          </Tag>
          {item.categories.slice(0, 3).map((category) => (
            <Tag key={category}>{category}</Tag>
          ))}
          {item.requiredPermissions.length > 0 && (
            <span>需要 {item.requiredPermissions.length} 项权限</span>
          )}
        </div>
      </div>
    </article>
  )
}

export function PluginMarketplaceView({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast()
  const [installed, setInstalled] = useState<InstalledPluginItem[]>([])
  const [marketItems, setMarketItems] = useState<PluginMarketplaceItem[]>([])
  const [query, setQuery] = useState('')
  const [marketConfigured, setMarketConfigured] = useState(false)
  const [loadingMarket, setLoadingMarket] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [inspection, setInspection] = useState<PluginInspection | null>(null)
  const [localSource, setLocalSource] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<PluginRuntimeStatusItem[]>([])
  const [runtimeAccounts, setRuntimeAccounts] = useState<Record<string, ConnectorAccount[]>>({})
  const [selectedRuntime, setSelectedRuntime] = useState<PluginRuntimeStatusItem | null>(null)
  const [runtimeSecret, setRuntimeSecret] = useState('')
  const [runtimeVaultPath, setRuntimeVaultPath] = useState('')
  const [runtimeClientId, setRuntimeClientId] = useState('')
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [runtimeMode, setRuntimeMode] = useState<'token' | 'oauth'>('token')
  const { invoke: listPlugins } = useIpcInvoke('plugin:list')
  const { invoke: inspectLocal } = useIpcInvoke('plugin:inspect-local')
  const { invoke: installLocal } = useIpcInvoke('plugin:install-local')
  const { invoke: installMarket } = useIpcInvoke('plugin-marketplace:install')
  const { invoke: listMarketplaces } = useIpcInvoke('plugin-marketplace:list')
  const { invoke: togglePlugin } = useIpcInvoke('plugin:set-enabled')
  const { invoke: uninstallPlugin } = useIpcInvoke('plugin:uninstall')
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const { invoke: listRuntimes } = useIpcInvoke('plugin-runtime:list')
  const { invoke: listRuntimeAccounts } = useIpcInvoke('plugin-runtime:accounts:list')
  const { invoke: connectRuntime } = useIpcInvoke('plugin-runtime:accounts:connect')
  const { invoke: authorizeRuntime } = useIpcInvoke('plugin-runtime:accounts:authorize')
  const { invoke: disconnectRuntime } = useIpcInvoke('plugin-runtime:accounts:disconnect')
  const { invoke: updateRuntimeAccount } = useIpcInvoke('plugin-runtime:accounts:update')
  const { invoke: openExternal } = useIpcInvoke('browser:open-external')

  const refreshInstalled = useCallback(async () => {
    const result = await listPlugins({ includeDisabled: true })
    setInstalled(result.plugins)
  }, [listPlugins])

  const refreshRuntimeState = useCallback(async () => {
    try {
      const result = await listRuntimes({})
      const accountEntries = await Promise.all(
        result.runtimes.map(async (item) => {
          const accounts = await listRuntimeAccounts({ runtimeId: item.runtime.id })
          return [item.runtime.id, accounts.accounts] as const
        }),
      )
      const accounts = Object.fromEntries(accountEntries)
      setRuntimeStatus(result.runtimes)
      setRuntimeAccounts(accounts)
      return { runtimes: result.runtimes, accounts }
    } catch {
      setRuntimeStatus([])
      setRuntimeAccounts({})
      return { runtimes: [], accounts: {} }
    }
  }, [listRuntimes, listRuntimeAccounts])

  const openRuntime = (runtime: PluginRuntimeStatusItem) => {
    setSelectedRuntime(runtime)
    setRuntimeSecret('')
    setRuntimeVaultPath('')
    setRuntimeClientId('')
    setRuntimeMode(runtime.runtime.id === 'google' ? 'oauth' : 'token')
  }

  const inferredScopes = (runtime: PluginRuntimeStatusItem): string[] =>
    Array.from(
      new Set(
        runtime.runtime.capabilities
          .filter((capability) => capability.enabledByDefault)
          .flatMap((capability) => capability.requiredScopes ?? []),
      ),
    )

  const connectSelectedRuntime = async () => {
    if (!selectedRuntime) return
    const runtime = selectedRuntime.runtime
    const enabledCapabilities = runtime.capabilities
      .filter((capability) => capability.enabledByDefault)
      .map((capability) => capability.id)
    setRuntimeBusy(true)
    try {
      if (runtimeMode === 'oauth') {
        const clientId = runtimeClientId.trim()
        if (!clientId) throw new Error('请填写 OAuth Client ID')
        const urls = oauthEndpoints(runtime.id)
        const result = await authorizeRuntime({
          runtimeId: runtime.id,
          clientId,
          authorizationUrl: urls.authorizationUrl,
          tokenUrl: urls.tokenUrl,
          scopes: inferredScopes(selectedRuntime),
          ...(runtime.id === 'google'
            ? { extraAuthorizationParams: { access_type: 'offline' } }
            : {}),
          config: { grantedScopes: inferredScopes(selectedRuntime) },
          enabledCapabilities,
        })
        toast.success(`${runtime.displayName} 已连接 ${result.account.displayName}`)
      } else {
        const request = manualRuntimeRequest(
          selectedRuntime,
          runtimeSecret,
          runtimeVaultPath,
          enabledCapabilities,
        )
        const result = await connectRuntime({ runtimeId: runtime.id, request })
        toast.success(`${runtime.displayName} 已连接 ${result.account.displayName}`)
      }
      setRuntimeSecret('')
      setRuntimeVaultPath('')
      setSelectedRuntime(null)
      await refreshRuntimeState()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接账号失败')
    } finally {
      setRuntimeBusy(false)
    }
  }

  const disconnectSelectedAccount = async (account: ConnectorAccount) => {
    if (!selectedRuntime) return
    try {
      await disconnectRuntime({ runtimeId: selectedRuntime.runtime.id, accountId: account.id })
      const snapshot = await refreshRuntimeState()
      const nextAccounts = snapshot.accounts[selectedRuntime.runtime.id] ?? []
      const nextRuntime = snapshot.runtimes.find(
        (item) => item.runtime.id === selectedRuntime.runtime.id,
      )
      if (nextAccounts.length === 0) setSelectedRuntime(null)
      else if (nextRuntime) setSelectedRuntime(nextRuntime)
      toast.success(`已断开 ${accountDisplayName(account, selectedRuntime.runtime.displayName)}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '断开账号失败')
    }
  }

  const toggleRuntimeCapability = async (account: ConnectorAccount, capability: string) => {
    if (!selectedRuntime) return
    const knownCapabilities = new Set(selectedRuntime.runtime.capabilities.map((item) => item.id))
    const capabilities = new Set(
      account.enabledCapabilities.filter((item) => knownCapabilities.has(item)),
    )
    if (capabilities.has(capability)) capabilities.delete(capability)
    else capabilities.add(capability)
    try {
      await updateRuntimeAccount({
        runtimeId: selectedRuntime.runtime.id,
        accountId: account.id,
        request: { enabledCapabilities: Array.from(capabilities) },
      })
      await refreshRuntimeState()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '能力开关更新失败')
    }
  }

  const openRuntimeAuthGuide = async (url: string) => {
    try {
      await openExternal({ url })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开官方配置页面')
    }
  }

  const searchMarket = useCallback(
    async (nextQuery = query) => {
      setLoadingMarket(true)
      setMarketError(null)
      try {
        const { marketplaces } = await listMarketplaces({})
        const hasConfiguredMarket = marketplaces.some((marketplace) => marketplace.configured)
        setMarketConfigured(hasConfiguredMarket)
        if (!hasConfiguredMarket) {
          setMarketItems([])
          return
        }
        const result = await window.spark.invoke('plugin-marketplace:search', {
          query: nextQuery,
          limit: 24,
          offset: 0,
        })
        setMarketItems(result.plugins)
      } catch {
        setMarketItems([])
        setMarketError('已配置的市场来源暂时无法连接，请检查网络或来源设置。')
      } finally {
        setLoadingMarket(false)
      }
    },
    [listMarketplaces, query],
  )

  useEffect(() => {
    let disposed = false
    queueMicrotask(() => {
      if (disposed) return
      void refreshInstalled()
      void searchMarket('')
      void refreshRuntimeState()
    })
    return () => {
      disposed = true
    }
  }, [refreshInstalled, refreshRuntimeState, searchMarket])

  const installedGroups = useMemo(() => groupInstalledPlugins(installed), [installed])
  const visibleMarketItems = useMemo(
    () => filterMarketplaceItemsForDisplay(marketItems, installedGroups),
    [installedGroups, marketItems],
  )

  const installLocalPlugin = async () => {
    const selected = await openDirectory({ title: '选择连接器目录' })
    if (selected.canceled || !selected.filePath) return
    try {
      const result = await inspectLocal({ sourcePath: selected.filePath })
      setLocalSource(selected.filePath)
      setInspection(result.inspection)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接器校验失败')
    }
  }

  const confirmLocalInstall = async () => {
    if (!inspection || !localSource) return
    try {
      await installLocal({
        sourcePath: localSource,
        approvedPermissions: inspection.requiredPermissions.map((item) => item.permission),
        enable: true,
      })
      setInspection(null)
      setLocalSource(null)
      await refreshInstalled()
      toast.success('连接器已安装并启用')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接器安装失败')
    }
  }

  const confirmMarketInstall = async (item: PluginMarketplaceItem) => {
    const permissions = item.requiredPermissions
    const approved = await new Promise<boolean>((resolve) => {
      if (permissions.length === 0) return resolve(true)
      Modal.confirm({
        title: `授权「${item.displayName}」`,
        content: (
          <div className="plugin-permission-confirm">
            该连接器请求：{permissions.map(permissionLabel).join('、')}
            。授权后连接器才能访问对应能力。
          </div>
        ),
        okText: '授权并安装',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
    if (!approved) return
    try {
      await installMarket({
        pluginId: item.id,
        marketplaceId: item.marketplaceId,
        approvedPermissions: permissions as PluginPermission[],
        enable: true,
      })
      await refreshInstalled()
      toast.success('连接器已安装并启用')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接器安装失败')
    }
  }

  return (
    <div className={`plugin-marketplace-view${embedded ? ' is-embedded' : ''}`}>
      <div className="plugin-marketplace-header">
        <p>安装、连接并控制 Agent 可以使用的外部服务。</p>
        <Button
          size="small"
          type="text"
          icon={<Icons.Plus size={14} />}
          onClick={installLocalPlugin}
        >
          导入本地连接器
        </Button>
      </div>

      <section className="plugin-section">
        <div className="plugin-section-heading is-installed">
          <div>
            <h2>已安装连接器</h2>
            <span>{installedGroups.length} 个连接器</span>
          </div>
        </div>
        {installedGroups.length === 0 ? (
          <div className="plugin-empty">
            <div className="plugin-empty-icon">
              <Icons.Plugins size={22} />
            </div>
            <strong>还没有连接器</strong>
            <span>从本地导入，或从已验证的市场来源安装。</span>
            <button type="button" onClick={installLocalPlugin}>
              导入本地连接器 <Icons.ChevronRight size={13} />
            </button>
          </div>
        ) : (
          <div className="plugin-list">
            {installedGroups.map((group) => {
              const plugin = group.plugin
              const runtime = runtimeStatus.find(
                (item) =>
                  group.memberIds.includes(item.runtime.pluginId) ||
                  item.runtime.id === plugin.runtimeId,
              )
              return (
                <PluginCard
                  key={group.memberIds.join(':')}
                  plugin={plugin}
                  duplicateCount={group.memberIds.length}
                  canUninstall={group.uninstallIds.length > 0}
                  {...(runtime
                    ? {
                        runtime,
                        runtimeAccounts: runtimeAccounts[runtime.runtime.id] ?? [],
                      }
                    : {})}
                  onToggle={async (enabled) => {
                    try {
                      const results = await Promise.all(
                        group.memberIds.map((id) => togglePlugin({ id, enabled })),
                      )
                      setInstalled((current) =>
                        current.map((item) => {
                          const result = results.find((entry) => entry.plugin.id === item.id)
                          return result?.plugin ?? item
                        }),
                      )
                      await refreshRuntimeState()
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : '连接器状态更新失败')
                    }
                  }}
                  onUninstall={() => {
                    Modal.confirm({
                      title: `移除「${plugin.displayName}」？`,
                      content:
                        group.uninstallIds.length > 1
                          ? `将移除该名称下的 ${group.uninstallIds.length} 个非内置连接器；内置运行时会保留。`
                          : '移除非内置连接器后，它提供的 Skill、MCP 和账号配置将不再可用。',
                      okText: '移除',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          await Promise.all(group.uninstallIds.map((id) => uninstallPlugin({ id })))
                          await refreshInstalled()
                          toast.success('连接器已移除')
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : '连接器移除失败')
                          throw error
                        }
                      },
                    })
                  }}
                  onRuntimeAction={openRuntime}
                />
              )
            })}
          </div>
        )}
      </section>

      {marketConfigured && (
        <section className="plugin-section">
          <div className="plugin-section-heading">
            <div>
              <h2>连接器市场</h2>
              <span>来自已配置的可信市场源</span>
            </div>
            <div className="plugin-market-search">
              <SearchBar
                value={query}
                onInputChange={setQuery}
                onPressEnter={() => void searchMarket()}
                placeholder="搜索名称或能力"
              />
            </div>
          </div>
          {loadingMarket ? (
            <div className="plugin-market-status">
              <span className="plugin-status-dot loading" />
              正在同步市场目录…
            </div>
          ) : marketError ? (
            <div className="plugin-market-status error">
              <span className="plugin-status-dot" />
              <div>
                <strong>无法连接连接器市场</strong>
                <span className="plugin-market-error-detail">{marketError}</span>
              </div>
              <button onClick={() => void searchMarket()}>重新加载</button>
            </div>
          ) : visibleMarketItems.length === 0 ? (
            <div className="plugin-market-status">当前来源没有匹配的连接器。</div>
          ) : (
            <div className="plugin-market-grid">
              {visibleMarketItems.map((item) => (
                <MarketplaceCard
                  key={`${item.id}:${item.version}`}
                  item={item}
                  onInstall={() => void confirmMarketInstall(item)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <Modal
        open={inspection != null}
        title="安装前检查"
        okText="授权并安装"
        cancelText="取消"
        onOk={() => void confirmLocalInstall()}
        onCancel={() => {
          setInspection(null)
          setLocalSource(null)
        }}
      >
        {inspection && (
          <div className="plugin-inspection">
            <h3>
              {inspection.manifest.displayName} <span>v{inspection.manifest.version}</span>
            </h3>
            <p>{inspection.manifest.description}</p>
            <div className="plugin-inspection-row">
              <span>作者</span>
              <strong>{inspection.manifest.author.name}</strong>
            </div>
            <div className="plugin-inspection-row">
              <span>内容</span>
              <strong>
                {inspection.files} 个文件 · SHA-256 {inspection.packageSha256.slice(0, 16)}…
              </strong>
            </div>
            <div className="plugin-inspection-permissions">
              <b>必需权限</b>
              {inspection.requiredPermissions.length === 0 ? (
                <span>无</span>
              ) : (
                inspection.requiredPermissions.map((item) => (
                  <Tag
                    key={item.permission}
                    color={
                      item.risk === 'critical' ? 'red' : item.risk === 'high' ? 'orange' : 'blue'
                    }
                  >
                    {permissionLabel(item.permission)}
                  </Tag>
                ))
              )}
            </div>
            {inspection.warnings.map((warning) => (
              <div className="plugin-inspection-warning" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={selectedRuntime != null}
        title={selectedRuntime ? `连接 ${selectedRuntime.runtime.displayName}` : undefined}
        okText={runtimeMode === 'oauth' ? '打开授权页' : '验证并连接'}
        cancelText="取消"
        confirmLoading={runtimeBusy}
        onOk={() => void connectSelectedRuntime()}
        onCancel={() => {
          setSelectedRuntime(null)
          setRuntimeSecret('')
          setRuntimeVaultPath('')
        }}
        okButtonProps={{
          disabled:
            runtimeMode === 'oauth'
              ? runtimeClientId.trim().length === 0
              : selectedRuntime?.runtime.id === 'obsidian'
                ? runtimeVaultPath.trim().length === 0
                : runtimeSecret.trim().length === 0,
        }}
      >
        {selectedRuntime && (
          <RuntimeAccountModal
            runtime={selectedRuntime}
            accounts={runtimeAccounts[selectedRuntime.runtime.id] ?? []}
            mode={runtimeMode}
            secret={runtimeSecret}
            vaultPath={runtimeVaultPath}
            clientId={runtimeClientId}
            onModeChange={setRuntimeMode}
            onSecretChange={setRuntimeSecret}
            onClientIdChange={setRuntimeClientId}
            onChooseVault={async () => {
              const selected = await openDirectory({ title: '选择 Obsidian Vault' })
              if (!selected.canceled && selected.filePath) setRuntimeVaultPath(selected.filePath)
            }}
            onDisconnect={disconnectSelectedAccount}
            onToggleCapability={toggleRuntimeCapability}
            onOpenAuthGuide={(url) => void openRuntimeAuthGuide(url)}
          />
        )}
      </Modal>
    </div>
  )
}
