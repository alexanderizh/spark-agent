/**
 * McpView — MCP 服务器管理
 *
 * 设计要点
 * ────────
 * - Aligns with ProvidersView and uses the current `@lobehub/ui` + `antd` stack.
 * - 顶部 Header：标题 + 计数 + 搜索 + 刷新 + 添加按钮。
 * - 工具栏：状态过滤 chip（全部 / 在线 / 需注意 / 错误 / 未启用）+ 作用域 segmented。
 * - 卡片网格：每张卡片展示 logo / 名称 / 作用域 / 传输 / 描述 / 状态 / 工具数 / 启停开关。
 * - Add / edit flows use a structured drawer with grouped fields.
 * - 样式落在 `McpView.less`（mv_ 前缀），不再依赖 views.css 的旧全局类。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Tag, Tooltip, Drawer, Empty, Tabs } from '@lobehub/ui'
import { Input, message, Switch } from 'antd'
import { Icons } from '../Icons'
import { translate, useI18n } from '../i18n'
import { GITHUB_CONNECTOR_MANIFEST } from '@spark/protocol'
import type {
  ConnectorAuthMethod,
  ConnectorCapabilityKind,
  ConnectorConnectionStatus,
  GitHubConnectorConnection,
  McpServerItem,
} from '@spark/protocol'
import { Select as LobeSelect } from '@lobehub/ui'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useApp } from '../AppContext'
import './McpView.less'
import { McpFilterPopover, SCOPES, type StatusFilter } from './McpFilterPopover'
import { McpTeamPublishModal } from './McpTeamMarket'
import { PluginMarketplaceView } from './PluginMarketplaceView'
import { CustomToolsSection } from './CustomToolsSection'
import { TeamStoreView } from './TeamStoreView'
import {
  hasPendingCustomToolTrace,
  OPEN_CUSTOM_TOOL_TRACE_EVENT,
} from './customToolTraceNavigation'
type McpOAuthStatus = 'unconfigured' | 'needs-auth' | 'authorizing' | 'authorized' | 'failed'
type McpTransport = 'stdio' | 'http' | 'sse'

type ParsedConfig = {
  transport?: McpTransport
  /** 历史/agent 写入曾用 `type` 字段名，读取时与 `transport` 归一。 */
  type?: McpTransport
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  auth?: {
    type?: 'none' | 'oauth2'
    scope?: string
    dcr?: boolean
    clientId?: string
    clientSecret?: string
    hasClientSecret?: boolean
  }
  tools?: string[]
  description?: string
}

type ServerDerived = {
  id: string
  name: string
  scope: string
  transport: McpTransport
  endpoint: string
  desc: string
  status: 'ok' | 'warn' | 'err' | 'off'
  tools: number
  statusLabel: string
  authStatus: McpOAuthStatus
  authEnabled: boolean
}

type DraftBase = {
  name: string
  scope: string
  transport: McpTransport
  command: string
  args: string
  url: string
  description: string
  env: Array<{ key: string; value: string }>
  authType: 'none' | 'oauth2'
  authScope: string
  authDcr: boolean
  authClientId: string
  authClientSecret: string
  enabled: boolean
}

const EMPTY_DRAFT: DraftBase = {
  name: '',
  scope: 'user',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  description: '',
  env: [],
  authType: 'none',
  authScope: '',
  authDcr: true,
  authClientId: '',
  authClientSecret: '',
  enabled: true,
}

function parseConfig(configJson: string): ParsedConfig {
  try {
    const value = JSON.parse(configJson) as ParsedConfig
    return value ?? {}
  } catch {
    return {}
  }
}

function serializeConfig(draft: DraftBase): string {
  const config: ParsedConfig = {
    transport: draft.transport,
    tools: [],
  }
  if (draft.description.trim().length > 0) {
    config.description = draft.description.trim()
  }
  if (draft.transport === 'stdio') {
    config.command = draft.command.trim()
    const argList = draft.args
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    if (argList.length > 0) config.args = argList
  } else {
    config.url = draft.url.trim()
  }
  if (draft.transport !== 'stdio' && draft.authType === 'oauth2') {
    config.auth = {
      type: 'oauth2',
      scope: draft.authScope.trim(),
      dcr: draft.authDcr,
      ...(!draft.authDcr
        ? {
            clientId: draft.authClientId.trim(),
            hasClientSecret: draft.authClientSecret.trim().length > 0,
          }
        : {}),
      ...(!draft.authDcr && draft.authClientSecret.trim().length > 0
        ? { clientSecret: draft.authClientSecret.trim() }
        : {}),
    }
  }
  const env: Record<string, string> = {}
  for (const { key, value } of draft.env) {
    const k = key.trim()
    if (k.length > 0) env[k] = value
  }
  if (Object.keys(env).length > 0) config.env = env
  return JSON.stringify(config)
}

/**
 * 归一化传输类型：兼容 `transport`/`type` 两种历史字段名，并按可用字段兜底推断。
 * 与后端 resolveMcpConfig 保持一致，避免同一配置在页面显示成 stdio、实际却是 http。
 */
function normalizeTransport(config: ParsedConfig): McpTransport {
  const explicit = config.transport ?? config.type
  if (explicit === 'http' || explicit === 'sse' || explicit === 'stdio') {
    // 声明 stdio 但没有 command 却带 url —— 按 http 处理（修历史写反的记录）
    if (
      explicit === 'stdio' &&
      (config.command ?? '').trim().length === 0 &&
      (config.url ?? '').trim().length > 0
    ) {
      return 'http'
    }
    return explicit
  }
  if ((config.url ?? '').trim().length > 0) return 'http'
  return 'stdio'
}

function deriveServer(
  item: McpServerItem,
  authStatus: McpOAuthStatus = 'unconfigured',
): ServerDerived {
  const config = parseConfig(item.configJson)
  const transport = normalizeTransport(config)
  const endpoint = transport === 'stdio' ? (config.command ?? '') : (config.url ?? '')
  const valid = endpoint.trim().length > 0
  const authEnabled = config.auth?.type === 'oauth2'
  const needsAuth = authEnabled && authStatus !== 'authorized'
  const status: ServerDerived['status'] = !item.enabled
    ? 'off'
    : !valid
      ? 'warn'
      : authStatus === 'failed'
        ? 'err'
        : needsAuth
          ? 'warn'
          : 'ok'
  const desc =
    config.description?.trim() && config.description.trim().length > 0
      ? config.description.trim()
      : transport === 'stdio'
        ? `${transport} · ${config.command ?? translate('mcpView.t1')}`
        : translate('mcpView.tpl8Desc', { transport, url: config.url ?? translate('mcpView.t2') })
  let statusLabel: string
  if (status === 'off') statusLabel = translate('mcpView.t3')
  else if (authStatus === 'authorized') statusLabel = translate('mcpView.t4')
  else if (authStatus === 'authorizing') statusLabel = translate('mcpView.t5')
  else if (authStatus === 'failed') statusLabel = translate('mcpView.t6')
  else if (needsAuth) statusLabel = translate('mcpView.t7')
  else if (status === 'warn') statusLabel = translate('mcpView.t8')
  else statusLabel = translate('mcpView.t9')

  return {
    id: item.id,
    name: item.name,
    scope: item.scope,
    transport,
    endpoint: endpoint.trim(),
    desc,
    status,
    tools: config.tools?.length ?? 0,
    statusLabel,
    authStatus,
    authEnabled,
  }
}

function draftFromItem(item: McpServerItem | null): DraftBase {
  if (item == null) return { ...EMPTY_DRAFT, env: [] }
  const config = parseConfig(item.configJson)
  const env = Object.entries(config.env ?? {}).map(([key, value]) => ({ key, value }))
  return {
    name: item.name,
    scope: item.scope,
    transport: normalizeTransport(config),
    command: config.command ?? '',
    args: (config.args ?? []).join(' '),
    url: config.url ?? '',
    description: config.description ?? '',
    env,
    authType: config.auth?.type === 'oauth2' ? 'oauth2' : 'none',
    authScope: config.auth?.scope ?? '',
    authDcr: config.auth?.dcr !== false,
    authClientId: config.auth?.clientId ?? '',
    authClientSecret: '',
    enabled: item.enabled,
  }
}

type McpTab = 'mcp' | 'custom-tools' | 'plugins' | 'team-store'

const MCP_TAB_ITEMS: Array<{ key: McpTab; label: string }> = [
  { key: 'mcp', label: 'MCP' },
  { key: 'custom-tools', label: translate('mcpView.t10') },
  { key: 'plugins', label: translate('mcpView.t11') },
  { key: 'team-store', label: translate('mcpView.t12') },
]

export function McpView({ initialTab = 'mcp' }: { initialTab?: McpTab } = {}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const { requestConfirm } = useApp()
  const [activeTab, setActiveTab] = useState<McpTab>(() =>
    hasPendingCustomToolTrace() ? 'custom-tools' : initialTab,
  )
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftBase>(EMPTY_DRAFT)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [authStatuses, setAuthStatuses] = useState<Record<string, McpOAuthStatus>>({})
  const [authorizingId, setAuthorizingId] = useState<string | null>(null)

  const { invoke: listMcp, loading } = useIpcInvoke('mcp:list')
  const { invoke: createMcp } = useIpcInvoke('mcp:create')
  const { invoke: updateMcp } = useIpcInvoke('mcp:update')
  const { invoke: deleteMcp } = useIpcInvoke('mcp:delete')
  const [teamPublishTarget, setTeamPublishTarget] = useState<McpServerItem | null>(null)
  const { invoke: authorizeMcp } = useIpcInvoke('mcp:authorize')
  const { invoke: deauthorizeMcp } = useIpcInvoke('mcp:deauthorize')
  const { invoke: getAuthStatus } = useIpcInvoke('mcp:auth-status')

  useEffect(() => {
    const openCustomTools = () => setActiveTab('custom-tools')
    window.addEventListener(OPEN_CUSTOM_TOOL_TRACE_EVENT, openCustomTools)
    return () => window.removeEventListener(OPEN_CUSTOM_TOOL_TRACE_EVENT, openCustomTools)
  }, [])

  const refresh = useCallback(() => {
    listMcp(scopeFilter === 'all' ? {} : { scope: scopeFilter })
      .then(async (res) => {
        const nextServers = res.servers ?? []
        setServers(nextServers)
        const entries = await Promise.all(
          nextServers.map(async (server) => {
            const config = parseConfig(server.configJson)
            if (config.auth?.type !== 'oauth2') return [server.id, 'unconfigured'] as const
            try {
              const auth = await getAuthStatus({ serverId: server.id })
              return [server.id, auth.status] as const
            } catch {
              return [server.id, 'failed'] as const
            }
          }),
        )
        setAuthStatuses(Object.fromEntries(entries))
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : translate('mcpView.t13')
        message.error(errorMsg)
      })
  }, [listMcp, getAuthStatus, scopeFilter])

  useRefreshable(refresh)

  useEffect(() => {
    const id = window.setTimeout(refresh, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  const derived = useMemo(
    () => servers.map((server) => deriveServer(server, authStatuses[server.id] ?? 'unconfigured')),
    [servers, authStatuses],
  )

  const statusCounts = useMemo(() => {
    return {
      all: derived.length,
      ok: derived.filter((s) => s.status === 'ok').length,
      warn: derived.filter((s) => s.status === 'warn').length,
      err: derived.filter((s) => s.status === 'err').length,
      off: derived.filter((s) => s.status === 'off').length,
    }
  }, [derived])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return derived.filter((server) => {
      if (statusFilter !== 'all' && server.status !== statusFilter) return false
      if (keyword.length === 0) return true
      return [server.name, server.scope, server.desc, server.transport, server.endpoint].some(
        (value) => value.toLowerCase().includes(keyword),
      )
    })
  }, [derived, query, statusFilter])

  const openCreate = useCallback(() => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setDraftError(null)
    setDrawerOpen(true)
  }, [])

  const openEdit = useCallback((item: McpServerItem) => {
    setEditingId(item.id)
    setDraft(draftFromItem(item))
    setDraftError(null)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    if (saving) return
    setDrawerOpen(false)
    setDraftError(null)
  }, [saving])

  const validateDraft = (value: DraftBase): string | null => {
    if (value.name.trim().length === 0) return translate('mcpView.t14')
    if (value.transport === 'stdio') {
      if (value.command.trim().length === 0) return translate('mcpView.t15Desc')
    } else {
      if (value.url.trim().length === 0) return translate('mcpView.t16Desc')
      try {
        // 允许 ws / http / https
        const url = new URL(value.url.trim())
        if (!/^https?:$/.test(url.protocol) && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
          return translate('mcpView.t17Desc')
        }
      } catch {
        return translate('mcpView.t18')
      }
    }
    if (
      value.transport !== 'stdio' &&
      value.authType === 'oauth2' &&
      !value.authDcr &&
      value.authClientId.trim().length === 0
    ) {
      return translate('mcpView.t19Desc')
    }
    return null
  }

  const handleSave = useCallback(async () => {
    const error = validateDraft(draft)
    if (error != null) {
      setDraftError(error)
      return
    }
    setDraftError(null)
    setSaving(true)
    try {
      const configJson = serializeConfig(draft)
      if (editingId == null) {
        await createMcp({
          name: draft.name.trim(),
          scope: draft.scope,
          configJson,
          enabled: draft.enabled,
        })
        message.success(translate('mcpView.t20'))
      } else {
        await updateMcp({
          id: editingId,
          name: draft.name.trim(),
          configJson,
          enabled: draft.enabled,
        })
        message.success(translate('mcpView.t21'))
      }
      setDrawerOpen(false)
      refresh()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : translate('mcpView.t22')
      setDraftError(errorMsg)
      message.error(errorMsg)
    } finally {
      setSaving(false)
    }
  }, [draft, editingId, createMcp, updateMcp, refresh])

  const handleToggle = useCallback(
    async (item: McpServerItem, next: boolean) => {
      try {
        await updateMcp({ id: item.id, enabled: next })
        refresh()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : translate('mcpView.t23')
        message.error(errorMsg)
      }
    },
    [updateMcp, refresh],
  )

  const handleDelete = useCallback(
    async (item: McpServerItem) => {
      const confirmed = await requestConfirm({
        title: translate('mcpView.tpl1Desc', { name: item.name }),
        description: translate('mcpView.t24Desc'),
        confirmText: translate('mcpView.t25'),
        danger: true,
      })
      if (!confirmed) return
      try {
        await deleteMcp({ id: item.id })
        message.success(translate('mcpView.t26'))
        refresh()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : translate('mcpView.t27')
        message.error(errorMsg)
      }
    },
    [requestConfirm, deleteMcp, refresh],
  )

  const handleAuthorize = useCallback(
    async (item: McpServerItem) => {
      setAuthorizingId(item.id)
      setAuthStatuses((prev) => ({ ...prev, [item.id]: 'authorizing' }))
      try {
        await authorizeMcp({ serverId: item.id })
        message.success(translate('mcpView.t28'))
        refresh()
      } catch (err) {
        setAuthStatuses((prev) => ({ ...prev, [item.id]: 'failed' }))
        message.error(err instanceof Error ? err.message : translate('mcpView.t29'))
      } finally {
        setAuthorizingId(null)
      }
    },
    [authorizeMcp, refresh],
  )

  const handleDeauthorize = useCallback(
    async (item: McpServerItem) => {
      try {
        await deauthorizeMcp({ serverId: item.id })
        message.success(translate('mcpView.t30'))
        refresh()
      } catch (err) {
        message.error(err instanceof Error ? err.message : translate('mcpView.t31'))
      }
    },
    [deauthorizeMcp, refresh],
  )

  return (
    <>
      <div className="mv_root">
        <Tabs
          activeKey={activeTab}
          className="mv_extension_tabs"
          items={MCP_TAB_ITEMS}
          size="small"
          tabBarExtraContent={
            activeTab === 'mcp' ? (
              <div className="mv_header_right">
                <McpFilterPopover
                  statusFilter={statusFilter}
                  scopeFilter={scopeFilter}
                  statusCounts={statusCounts}
                  onStatusChange={setStatusFilter}
                  onScopeChange={setScopeFilter}
                  onReset={() => {
                    setStatusFilter('all')
                    setScopeFilter('all')
                  }}
                />
                <div className="mv_search_wrap">
                  <Input
                    size="middle"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={translate('mcpView.t59Desc')}
                    prefix={<Icons.Search size={14} />}
                  />
                </div>
                <Tooltip title={translate('mcpView.t60')}>
                  <Button
                    size="middle"
                    shape="circle"
                    type="text"
                    icon={<Icons.Refresh size={12} />}
                    onClick={refresh}
                  />
                </Tooltip>
                <Button
                  type="primary"
                  size="middle"
                  icon={<Icons.Plus size={12} />}
                  onClick={openCreate}
                >
                  {translate('mcpView.t68')}
                </Button>
              </div>
            ) : null
          }
          onChange={(key) => {
            const nextTab = MCP_TAB_ITEMS.find((item) => item.key === key)?.key
            if (nextTab) setActiveTab(nextTab)
          }}
        />

        {activeTab === 'plugins' ? (
          <PluginMarketplaceView embedded />
        ) : activeTab === 'team-store' ? (
          <TeamStoreView embedded />
        ) : activeTab === 'custom-tools' ? (
          <CustomToolsSection />
        ) : (
          <>
            {/* ── 卡片网格 ─────────────────────────────────────────────── */}
            <div className="mv_grid_wrap">
              {loading && derived.length === 0 ? (
                <div className="mv_empty">
                  <div className="mv_empty_title">{translate('mcpView.t69')}</div>
                  <div className="mv_empty_desc">{translate('mcpView.t70Desc')}</div>
                </div>
              ) : !loading && filtered.length === 0 ? (
                <EmptyState
                  totalCount={derived.length}
                  hasQuery={query.trim().length > 0 || statusFilter !== 'all'}
                  onAdd={openCreate}
                />
              ) : (
                <div className="mv_grid">
                  {filtered.map((server) => {
                    const item = servers.find((s) => s.id === server.id)
                    if (item == null) return null
                    return (
                      <McpCard
                        key={server.id}
                        server={server}
                        onToggle={(next) => void handleToggle(item, next)}
                        onEdit={() => openEdit(item)}
                        onDelete={() => void handleDelete(item)}
                        onPublishTeam={
                          item.scope === 'user' ? () => setTeamPublishTarget(item) : undefined
                        }
                        onAuthorize={() => void handleAuthorize(item)}
                        onDeauthorize={() => void handleDeauthorize(item)}
                        authorizing={authorizingId === item.id}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Drawer：添加 / 编辑 ────────────────────────────────────── */}
      <Drawer
        width={520}
        title={editingId == null ? translate('mcpView.t32') : translate('mcpView.t33')}
        open={drawerOpen}
        onClose={closeDrawer}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="text" onClick={closeDrawer} disabled={saving}>
              {translate('mcpView.t71')}
            </Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void handleSave()}
              icon={<Icons.Check />}
            >
              {editingId == null ? translate('mcpView.t34') : translate('mcpView.t35')}
            </Button>
          </div>
        }
        keyboard={!saving}
        maskClosable={!saving}
      >
        <McpForm draft={draft} setDraft={setDraft} error={draftError} />
      </Drawer>

      <McpTeamPublishModal
        open={teamPublishTarget != null}
        server={teamPublishTarget}
        onClose={() => setTeamPublishTarget(null)}
        onPublished={refresh}
      />
    </>
  )
}

// ── 子组件：单张 MCP 卡片 ────────────────────────────────────────────────

function McpCard({
  server,
  onToggle,
  onEdit,
  onDelete,
  onPublishTeam,
  onAuthorize,
  onDeauthorize,
  authorizing,
}: {
  server: ServerDerived
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onPublishTeam: (() => void) | undefined
  onAuthorize: () => void
  onDeauthorize: () => void
  authorizing: boolean
}) {
  const logoText = server.name.slice(0, 2).toUpperCase() || 'MCP'
  const statusClass =
    server.status === 'ok'
      ? 'mv_status_ok'
      : server.status === 'warn'
        ? 'mv_status_warn'
        : server.status === 'err'
          ? 'mv_status_err'
          : 'mv_status_off'
  const isOn = server.status !== 'off'
  return (
    <div className="mv_card">
      <div className="mv_card_top">
        <div className="mv_card_logo">{logoText}</div>
        <div className="mv_card_info">
          <div className="mv_card_name_row">
            <span className="mv_card_name" title={server.name}>
              {server.name}
            </span>
            <Tag color="default" bordered>
              {server.scope}
            </Tag>
          </div>
          <div className="mv_card_sub">
            <span className="mv_card_sub_text">{server.transport}</span>
            <span className="mv_card_sub_dot" />
            <span className="mv_card_sub_text" title={server.endpoint}>
              {server.endpoint || translate('mcpView.t36')}
            </span>
          </div>
        </div>
        <Switch
          size="middle"
          checked={isOn}
          onChange={onToggle}
          checkedChildren="ON"
          unCheckedChildren="OFF"
        />
      </div>

      <div className="mv_card_desc" title={server.desc}>
        {server.desc}
      </div>

      <div className="mv_card_foot">
        <span className={`mv_card_status ${statusClass}`}>
          <span className={`mv_status_dot ${server.status === 'ok' ? 'mv_dot_pulse' : ''}`} />
          {server.statusLabel}
        </span>
        {server.tools > 0 && (
          <span className="mv_card_tools">
            <Icons.Wrench /> {server.tools} tools
          </span>
        )}
        <div className="mv_toolbar_spacer" />
        {server.authEnabled &&
          (server.authStatus === 'authorized' ? (
            <Button type="text" size="small" onClick={onDeauthorize}>
              {translate('mcpView.t72')}
            </Button>
          ) : (
            <Button type="primary" size="small" loading={authorizing} onClick={onAuthorize}>
              {server.authStatus === 'failed' ? translate('mcpView.t37') : translate('mcpView.t38')}
            </Button>
          ))}
        {onPublishTeam != null && (
          <Tooltip title={translate('mcpView.t61')}>
            <Button type="text" size="small" icon={<Icons.Upload />} onClick={onPublishTeam} />
          </Tooltip>
        )}
        <Tooltip title={translate('mcpView.t62')}>
          <Button type="text" size="small" icon={<Icons.Edit />} onClick={onEdit} />
        </Tooltip>
        <Tooltip title={translate('mcpView.t25')}>
          <Button type="text" size="small" danger icon={<Icons.Trash />} onClick={onDelete} />
        </Tooltip>
      </div>
    </div>
  )
}

// ── 子组件：Empty 状态 ───────────────────────────────────────────────────

function EmptyState({
  totalCount,
  hasQuery,
  onAdd,
}: {
  totalCount: number
  hasQuery: boolean
  onAdd: () => void
}) {
  const isFiltered = hasQuery && totalCount > 0
  return (
    <div className="mv_empty">
      <Empty
        description={
          isFiltered ? (
            <div>
              <div className="mv_empty_title">{translate('mcpView.t73Desc')}</div>
              <div className="mv_empty_desc">{translate('mcpView.t74Desc')}</div>
            </div>
          ) : (
            <div>
              <div className="mv_empty_title">{translate('mcpView.t75Desc')}</div>
              <div className="mv_empty_desc">
                {translate('mcpView.tpl2LongDesc')}
              </div>
            </div>
          )
        }
      />
      {!isFiltered && (
        <Button type="primary" size="middle" icon={<Icons.Plus />} onClick={onAdd}>
          {translate('mcpView.t76')}
        </Button>
      )}
    </div>
  )
}

// ── 子组件：MCP 表单（Drawer body） ──────────────────────────────────────

function McpForm({
  draft,
  setDraft,
  error,
}: {
  draft: DraftBase
  setDraft: (updater: (prev: DraftBase) => DraftBase) => void
  error: string | null
}) {
  const isStdio = draft.transport === 'stdio'
  const update = <K extends keyof DraftBase>(key: K, value: DraftBase[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const updateEnvRow = (idx: number, patch: Partial<{ key: string; value: string }>) => {
    setDraft((prev) => ({
      ...prev,
      env: prev.env.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }))
  }

  const removeEnvRow = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      env: prev.env.filter((_, i) => i !== idx),
    }))
  }

  const addEnvRow = () => {
    setDraft((prev) => ({ ...prev, env: [...prev.env, { key: '', value: '' }] }))
  }

  return (
    <div className="mv_drawer_body">
      {error != null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            background: 'var(--color-danger-light-1, #ffece8)',
            color: 'var(--color-danger-6, #f53f3f)',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          <Icons.AlertTriangle />
          {error}
        </div>
      )}

      {/* ── 基本信息 ── */}
      <section className="mv_drawer_section">
        <header className="mv_drawer_section_head">
          <span className="mv_drawer_section_icon">
            <Icons.Database />
          </span>
          <span className="mv_drawer_section_title">{translate('mcpView.t77')}</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_form_grid">
            <label className="mv_form_label">
              {translate('mcpView.t78')}
              <span className="mv_form_sub">{translate('mcpView.t79')}</span>
            </label>
            <div className="mv_form_field">
              <Input
                value={draft.name}
                style={{
                  minWidth: 200,
                }}
                onChange={(event) => update('name', event.target.value)}
                placeholder={translate('mcpView.t63')}
              />
            </div>

            <label className="mv_form_label">{translate('mcpView.t80')}</label>
            <div className="mv_form_field">
              <LobeSelect
                value={draft.scope}
                style={{
                  minWidth: 200,
                }}
                onChange={(value) => update('scope', value as string)}
                options={SCOPES.map((scope) => ({ label: scope, value: scope }))}
              />
              <span className="mv_form_hint">
                {translate('mcpView.tpl3LongDesc')}
                Codex CLI
              </span>
            </div>

            <label className="mv_form_label">{translate('mcpView.t81')}</label>
            <div className="mv_form_field">
              <Input
                style={{
                  minWidth: 200,
                }}
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder={translate('mcpView.t64Desc')}
              />
            </div>

            <label className="mv_form_label">{translate('mcpView.t82')}</label>
            <div className="mv_form_field mv_form_field_inline">
              <Switch
                size="middle"
                checked={draft.enabled}
                onChange={(checked) => update('enabled', checked)}
                checkedChildren="ON"
                unCheckedChildren="OFF"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 启动配置 ── */}
      <section className="mv_drawer_section">
        <header className="mv_drawer_section_head">
          <span className="mv_drawer_section_icon">
            {isStdio ? <Icons.Code /> : <Icons.Link />}
          </span>
          <span className="mv_drawer_section_title">{translate('mcpView.t83')}</span>
          <span className="mv_drawer_section_hint">{isStdio ? 'stdio' : 'http / sse'}</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_form_grid">
            <label className="mv_form_label">{translate('mcpView.t84')}</label>
            <div className="mv_form_field">
              <div className="mv_segmented">
                {(['stdio', 'http', 'sse'] as McpTransport[]).map((transport) => (
                  <button
                    key={transport}
                    type="button"
                    className={`mv_segmented_item ${draft.transport === transport ? 'mv_segmented_active' : ''}`}
                    onClick={() => update('transport', transport)}
                  >
                    {transport}
                  </button>
                ))}
              </div>
            </div>

            {isStdio ? (
              <>
                <label className="mv_form_label">
                  {translate('mcpView.t85')}
                  <span className="mv_form_sub">{translate('mcpView.t86')}</span>
                </label>
                <div className="mv_form_field">
                  <Input
                    value={draft.command}
                    onChange={(event) => update('command', event.target.value)}
                    placeholder="npx"
                  />
                </div>

                <label className="mv_form_label">
                  {translate('mcpView.t87')}
                  <span className="mv_form_sub">{translate('mcpView.t88')}</span>
                </label>
                <div className="mv_form_field">
                  <Input
                    value={draft.args}
                    onChange={(event) => update('args', event.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem ."
                  />
                </div>
              </>
            ) : (
              <label className="mv_form_label">
                URL
                <span className="mv_form_sub">{translate('mcpView.t89Desc')}</span>
              </label>
            )}
            {!isStdio && (
              <div className="mv_form_field">
                <Input
                  value={draft.url}
                  onChange={(event) => update('url', event.target.value)}
                  placeholder="https://mcp.example.com/sse"
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {!isStdio && (
        <section className="mv_drawer_section">
          <header className="mv_drawer_section_head">
            <span className="mv_drawer_section_icon">🔐</span>
            <span className="mv_drawer_section_title">{translate('mcpView.t90')}</span>
            <span className="mv_drawer_section_hint">OAuth 2.0 / PKCE</span>
          </header>
          <div className="mv_drawer_section_body">
            <div className="mv_form_grid">
              <label className="mv_form_label">{translate('mcpView.t91')}</label>
              <div className="mv_form_field">
                <div className="mv_segmented">
                  {(['none', 'oauth2'] as const).map((authType) => (
                    <button
                      key={authType}
                      type="button"
                      className={`mv_segmented_item ${draft.authType === authType ? 'mv_segmented_active' : ''}`}
                      onClick={() => update('authType', authType)}
                    >
                      {authType === 'none' ? translate('mcpView.t39') : 'OAuth 2.0'}
                    </button>
                  ))}
                </div>
              </div>
              {draft.authType === 'oauth2' && (
                <>
                  <label className="mv_form_label">Scope</label>
                  <div className="mv_form_field">
                    <Input
                      value={draft.authScope}
                      onChange={(event) => update('authScope', event.target.value)}
                      placeholder={translate('mcpView.t65Desc')}
                    />
                  </div>
                  <label className="mv_form_label">{translate('mcpView.t92')}</label>
                  <div className="mv_form_field mv_form_field_inline">
                    <Switch
                      checked={draft.authDcr}
                      onChange={(checked) => update('authDcr', checked)}
                      checkedChildren="ON"
                      unCheckedChildren="OFF"
                    />
                  </div>
                  {!draft.authDcr && (
                    <>
                      <label className="mv_form_label">Client ID</label>
                      <div className="mv_form_field">
                        <Input
                          value={draft.authClientId}
                          onChange={(event) => update('authClientId', event.target.value)}
                          placeholder={translate('mcpView.t66')}
                        />
                      </div>
                      <label className="mv_form_label">Client Secret</label>
                      <div className="mv_form_field">
                        <Input
                          type="password"
                          value={draft.authClientSecret}
                          onChange={(event) => update('authClientSecret', event.target.value)}
                          placeholder={translate('mcpView.t67Desc')}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── 环境变量 ── */}
      <section className="mv_drawer_section">
        <header className="mv_drawer_section_head">
          <span className="mv_drawer_section_icon">⚙</span>
          <span className="mv_drawer_section_title">{translate('mcpView.t93')}</span>
          <span className="mv_drawer_section_hint">{translate('mcpView.t94')}</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_env_list">
            {draft.env.length === 0 ? (
              <div className="mv_env_empty">{translate('mcpView.t95Desc')}</div>
            ) : (
              draft.env.map((row, idx) => (
                <div key={idx} className="mv_env_row">
                  <div className="mv_env_key">
                    <Input
                      value={row.key}
                      onChange={(event) => updateEnvRow(idx, { key: event.target.value })}
                      placeholder="KEY"
                    />
                  </div>
                  <div className="mv_env_val">
                    <Input
                      value={row.value}
                      onChange={(event) => updateEnvRow(idx, { value: event.target.value })}
                      placeholder="value"
                    />
                  </div>
                  <Button
                    type="text"
                    size="middle"
                    danger
                    icon={<Icons.X />}
                    onClick={() => removeEnvRow(idx)}
                  />
                </div>
              ))
            )}
          </div>
          <Button
            className="mv_env_add"
            type="text"
            size="middle"
            icon={<Icons.Plus />}
            onClick={addEnvRow}
          >
            {translate('mcpView.t96')}
          </Button>
        </div>
      </section>
    </div>
  )
}

type ConnectorLocalState = {
  status: ConnectorConnectionStatus
  authMethod: ConnectorAuthMethod
  repos: string
  allowWrites: boolean
  enabledCapabilities: ConnectorCapabilityKind[]
  enabled: boolean
  grantedScopes: string[]
  accountLogin?: string | undefined
  accountAvatarUrl?: string | undefined
  lastCheckedAt?: string | undefined
  lastError?: string | undefined
}

const GITHUB_SUPPORTED_AUTH_METHODS: ConnectorAuthMethod[] = ['pat']
const DEFAULT_GITHUB_CAPABILITIES = GITHUB_CONNECTOR_MANIFEST.capabilities
  .filter((capability) => capability.enabledByDefault)
  .map((capability) => capability.id)

function isGitHubAuthMethod(value: unknown): value is ConnectorAuthMethod {
  return (
    typeof value === 'string' &&
    GITHUB_SUPPORTED_AUTH_METHODS.includes(value as ConnectorAuthMethod)
  )
}

export function normalizeConnectorCapabilities(
  value: ConnectorCapabilityKind[] | undefined,
): ConnectorCapabilityKind[] {
  const seen = new Set<string>()
  const normalized: ConnectorCapabilityKind[] = []
  for (const capability of value ?? DEFAULT_GITHUB_CAPABILITIES) {
    const key = String(capability).trim()
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    normalized.push(key as ConnectorCapabilityKind)
  }
  return normalized
}

function createDefaultGitHubConnectorState(): ConnectorLocalState {
  return {
    status: 'needs_auth',
    authMethod: 'pat',
    repos: '',
    allowWrites: false,
    enabledCapabilities: normalizeConnectorCapabilities(DEFAULT_GITHUB_CAPABILITIES),
    enabled: true,
    grantedScopes: [],
  }
}

function readGitHubConnectorState(
  connection: GitHubConnectorConnection | null,
): ConnectorLocalState {
  if (connection == null) return createDefaultGitHubConnectorState()
  return {
    status: connection.status,
    authMethod: isGitHubAuthMethod(connection.authMethod) ? connection.authMethod : 'pat',
    repos: connection.config.selectedRepos.join(', '),
    allowWrites: connection.config.allowWrites === true,
    enabledCapabilities: normalizeConnectorCapabilities(connection.config.enabledCapabilities),
    enabled: connection.enabled,
    grantedScopes: connection.grantedScopes,
    accountLogin: connection.account?.login,
    accountAvatarUrl: connection.account?.avatarUrl,
    lastCheckedAt: connection.lastSyncAt ?? connection.updatedAt,
    lastError: connection.lastError,
  }
}

function normalizeGitHubRepoScopeInput(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  let candidate = trimmed.replace(/\.git$/i, '').replace(/\/+$/g, '')
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate)
      candidate = url.pathname.replace(/^\/+/, '').replace(/\/+$/g, '')
    } catch {
      return null
    }
  }

  const segments = candidate.split('/').filter(Boolean)
  if (segments.length !== 2 || segments.some((segment) => /\s/.test(segment))) {
    return null
  }
  return `${segments[0]}/${segments[1]}`.toLowerCase()
}

export function parseSelectedRepos(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/[,\n]/)
    .map((item) => normalizeGitHubRepoScopeInput(item))
    .filter((item): item is string => item != null)
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function sameStringList(a: string[], b: string[]): boolean {
  const left = [...a].sort()
  const right = [...b].sort()
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function hasGitHubConnectorDraftChanges(
  state: ConnectorLocalState,
  connection: GitHubConnectorConnection | null,
): boolean {
  if (connection == null) return false
  return !(
    connection.enabled === state.enabled &&
    connection.config.allowWrites === state.allowWrites &&
    sameStringList(connection.config.selectedRepos, parseSelectedRepos(state.repos)) &&
    sameStringList(
      connection.config.enabledCapabilities.map(String),
      normalizeConnectorCapabilities(state.enabledCapabilities).map(String),
    )
  )
}

function getConnectorStatusMeta(
  state: ConnectorLocalState,
  hasConnection: boolean,
): { color: string; label: string } {
  if (!hasConnection) {
    return state.lastError != null
      ? { color: 'red', label: translate('mcpView.t40') }
      : { color: 'orange', label: translate('mcpView.t41') }
  }
  if (!state.enabled || state.status === 'disabled') return { color: 'default', label: translate('mcpView.t42') }
  if (state.status === 'connected') return { color: 'green', label: translate('mcpView.t43') }
  if (state.status === 'syncing') return { color: 'blue', label: translate('mcpView.t44') }
  if (state.status === 'needs_auth') return { color: 'orange', label: translate('mcpView.t45') }
  return { color: 'red', label: translate('mcpView.t40') }
}

function ConnectorsPanel() {
  const [persistedConnection, setPersistedConnection] = useState<GitHubConnectorConnection | null>(
    null,
  )
  const [state, setState] = useState<ConnectorLocalState>(createDefaultGitHubConnectorState)
  const [patToken, setPatToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(true)
  const { invoke: getGitHubConnector } = useIpcInvoke('github-connector:get')
  const { invoke: connectGitHubConnector } = useIpcInvoke('github-connector:connect')
  const { invoke: updateGitHubConnector } = useIpcInvoke('github-connector:update')
  const { invoke: disconnectGitHubConnector } = useIpcInvoke('github-connector:disconnect')
  const manifest = GITHUB_CONNECTOR_MANIFEST
  const hasConnection = persistedConnection != null
  const draftDirty =
    patToken.trim().length > 0 || hasGitHubConnectorDraftChanges(state, persistedConnection)
  const statusMeta = getConnectorStatusMeta(state, hasConnection)

  useEffect(() => {
    let cancelled = false
    const loadConnection = async () => {
      setBootstrapping(true)
      try {
        const { connection } = await getGitHubConnector({})
        if (cancelled) return
        setPersistedConnection(connection)
        setState(readGitHubConnectorState(connection))
      } catch (err) {
        if (cancelled) return
        const next = createDefaultGitHubConnectorState()
        next.lastError = err instanceof Error ? err.message : translate('mcpView.t46Desc')
        setPersistedConnection(null)
        setState(next)
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }
    void loadConnection()
    return () => {
      cancelled = true
    }
  }, [getGitHubConnector])

  const applyConnection = (connection: GitHubConnectorConnection | null) => {
    setPersistedConnection(connection)
    setState(readGitHubConnectorState(connection))
  }

  const selectAuthMethod = (authMethod: ConnectorAuthMethod) => {
    if (authMethod === state.authMethod) return
    setState({
      ...state,
      authMethod,
      status: 'needs_auth',
      accountLogin: undefined,
      accountAvatarUrl: undefined,
      lastCheckedAt: undefined,
      lastError: undefined,
    })
    setPatToken('')
  }

  const handleConnect = async () => {
    const selectedAuth = manifest.auth.find((auth) => auth.method === state.authMethod)
    if (state.authMethod !== 'pat') {
      const targetUrl =
        selectedAuth?.authorizationUrl ?? selectedAuth?.installationUrl ?? selectedAuth?.docsUrl
      if (targetUrl != null) window.open(targetUrl, '_blank')
      setState({
        ...state,
        status: 'needs_auth',
        lastError: translate('mcpView.tpl4LongDesc', { label: selectedAuth?.label ?? translate('mcpView.t47') }),
      })
      return
    }

    const token = patToken.trim()
    if (token.length === 0) {
      message.warning(translate('mcpView.t48Desc'))
      return
    }

    setChecking(true)
    try {
      const { connection } = await connectGitHubConnector({
        token,
        ...(manifest.endpoints?.apiBaseUrl != null
          ? { apiBaseUrl: manifest.endpoints.apiBaseUrl }
          : {}),
        ...(manifest.endpoints?.webBaseUrl != null
          ? { webBaseUrl: manifest.endpoints.webBaseUrl }
          : {}),
        selectedRepos: parseSelectedRepos(state.repos),
        enabledCapabilities: normalizeConnectorCapabilities(state.enabledCapabilities),
        allowWrites: state.allowWrites,
      })
      applyConnection(connection)
      setPatToken('')
      message.success(translate('mcpView.t49Desc'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : translate('mcpView.t50Desc')
      setState((current) => ({ ...current, status: 'needs_auth', lastError: msg }))
      message.error(msg)
    } finally {
      setChecking(false)
    }
  }

  const handleSave = async () => {
    if (!hasConnection) {
      await handleConnect()
      return
    }
    setChecking(true)
    try {
      if (patToken.trim().length > 0) {
        const { connection } = await connectGitHubConnector({
          token: patToken.trim(),
          ...(manifest.endpoints?.apiBaseUrl != null
            ? { apiBaseUrl: manifest.endpoints.apiBaseUrl }
            : {}),
          ...(manifest.endpoints?.webBaseUrl != null
            ? { webBaseUrl: manifest.endpoints.webBaseUrl }
            : {}),
          selectedRepos: parseSelectedRepos(state.repos),
          enabledCapabilities: normalizeConnectorCapabilities(state.enabledCapabilities),
          allowWrites: state.allowWrites,
        })
        applyConnection(connection)
        setPatToken('')
        message.success(translate('mcpView.t51Desc'))
        return
      }

      const { connection } = await updateGitHubConnector({
        authMethod: state.authMethod,
        selectedRepos: parseSelectedRepos(state.repos),
        enabledCapabilities: normalizeConnectorCapabilities(state.enabledCapabilities),
        allowWrites: state.allowWrites,
        enabled: state.enabled,
      })
      applyConnection(connection)
      message.success(translate('mcpView.t52Desc'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : translate('mcpView.t53Desc')
      setState((current) => ({ ...current, lastError: msg }))
      message.error(msg)
    } finally {
      setChecking(false)
    }
  }

  const handleDisconnect = async () => {
    setChecking(true)
    try {
      await disconnectGitHubConnector({})
      applyConnection(null)
      setPatToken('')
      message.success(translate('mcpView.t54'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : translate('mcpView.t55')
      setState((current) => ({ ...current, lastError: msg }))
      message.error(msg)
    } finally {
      setChecking(false)
    }
  }

  const toggleCapability = (id: ConnectorCapabilityKind) => {
    const enabled = state.enabledCapabilities.includes(id)
    setState({
      ...state,
      enabledCapabilities: enabled
        ? state.enabledCapabilities.filter((item) => item !== id)
        : [...state.enabledCapabilities, id],
    })
  }

  return (
    <div className="mv_connectors">
      <section className="mv_connector_card">
        <div className="mv_connector_top">
          <div className="mv_connector_logo">
            <Icons.GitHub size={22} />
          </div>
          <div className="mv_connector_info">
            <div className="mv_connector_name">GitHub</div>
            <div className="mv_connector_desc">{manifest.description}</div>
          </div>
          <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
        </div>

        {hasConnection && state.accountLogin != null && (
          <div className="mv_connector_account">
            {state.accountAvatarUrl != null && (
              <img src={state.accountAvatarUrl} alt="" aria-hidden="true" />
            )}
            <span>{translate('mcpView.tpl5Desc', { account: state.accountLogin })}</span>
            {state.lastCheckedAt != null && (
              <small>{translate('mcpView.tpl6Desc', { time: new Date(state.lastCheckedAt).toLocaleString() })}</small>
            )}
          </div>
        )}
        {state.grantedScopes.length > 0 && (
          <div className="mv_connector_error">{translate('mcpView.tpl7Desc', { scopes: state.grantedScopes.join(', ') })}</div>
        )}
        {state.lastError != null && <div className="mv_connector_error">{state.lastError}</div>}
        {bootstrapping && (
          <div className="mv_connector_error">{translate('mcpView.t97Desc')}</div>
        )}

        <div className="mv_auth_strategy_grid">
          {manifest.auth.map((auth) => {
            const active = state.authMethod === auth.method
            return (
              <button
                key={auth.method}
                type="button"
                className={`mv_auth_strategy ${active ? 'mv_auth_strategy_active' : ''}`}
                onClick={() => selectAuthMethod(auth.method)}
              >
                <span>{auth.label}</span>
                <small>{auth.description}</small>
                <em>{auth.flow}</em>
              </button>
            )
          })}
        </div>

        <div className="mv_connector_form">
          <label className="mv_form_label">{translate('mcpView.t98')}</label>
          <div className="mv_form_field">
            <span className="mv_form_hint">
              {manifest.auth.find((auth) => auth.method === state.authMethod)?.description}
            </span>
          </div>

          {state.authMethod === 'pat' && (
            <>
              <label className="mv_form_label">PAT</label>
              <div className="mv_form_field">
                <Input
                  type="password"
                  value={patToken}
                  onChange={(event) => setPatToken(event.target.value)}
                  placeholder="github_pat_..."
                />
                <span className="mv_form_hint">
                  {translate('mcpView.t99LongDesc')}
                </span>
              </div>
            </>
          )}

          <label className="mv_form_label">{translate('mcpView.t100')}</label>
          <div className="mv_form_field">
            <Input
              value={state.repos}
              onChange={(event) => setState({ ...state, repos: event.target.value })}
              placeholder="owner/repo, org/backend"
            />
            <span className="mv_form_hint">
              {translate('mcpView.t101Desc')}
            </span>
          </div>

          <label className="mv_form_label">{translate('mcpView.t102')}</label>
          <div className="mv_form_field mv_form_field_inline">
            <Switch
              size="middle"
              checked={state.enabled}
              onChange={(checked) => setState({ ...state, enabled: checked })}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
            <span className="mv_form_hint">
              {translate('mcpView.t103Desc')}
            </span>
          </div>

          <label className="mv_form_label">{translate('mcpView.t104')}</label>
          <div className="mv_form_field mv_form_field_inline">
            <Switch
              size="middle"
              checked={state.allowWrites}
              onChange={(checked) => setState({ ...state, allowWrites: checked })}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
            <span className="mv_form_hint">
              {translate('mcpView.t105Desc')}
            </span>
          </div>
        </div>

        <div className="mv_capability_grid">
          {manifest.capabilities.map((capability) => {
            const enabled = state.enabledCapabilities.includes(capability.id)
            return (
              <button
                key={capability.id}
                type="button"
                className={`mv_capability ${enabled ? 'mv_capability_on' : ''}`}
                onClick={() => toggleCapability(capability.id)}
              >
                <span>{capability.label}</span>
                <small>{capability.description}</small>
                <Tag
                  color={
                    capability.risk === 'high'
                      ? 'red'
                      : capability.risk === 'medium'
                        ? 'orange'
                        : 'green'
                  }
                >
                  {capability.risk}
                </Tag>
              </button>
            )
          })}
        </div>

        <div className="mv_connector_actions">
          <Button
            type="primary"
            loading={checking || bootstrapping}
            icon={hasConnection ? <Icons.Check /> : <Icons.Link />}
            disabled={bootstrapping || (hasConnection && !draftDirty)}
            onClick={() => void (hasConnection ? handleSave() : handleConnect())}
          >
            {hasConnection
              ? patToken.trim().length > 0
                ? translate('mcpView.t56')
                : translate('mcpView.t57')
              : translate('mcpView.t58')}
          </Button>
          {hasConnection && (
            <Button
              type="text"
              loading={checking}
              danger
              icon={<Icons.X />}
              onClick={() => void handleDisconnect()}
            >
              {translate('mcpView.t106')}
            </Button>
          )}
          <Button
            type="text"
            icon={<Icons.ExternalLink />}
            onClick={() =>
              window.open('https://github.com/settings/personal-access-tokens', '_blank')
            }
          >
            {translate('mcpView.t107Desc')}
          </Button>
        </div>
      </section>
    </div>
  )
}
