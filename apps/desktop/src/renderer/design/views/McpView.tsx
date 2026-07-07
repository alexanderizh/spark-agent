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
import { Button, Tag, Tooltip, Drawer, Empty } from '@lobehub/ui'
import { Switch } from 'antd'
import { message } from 'antd'
import { Icons } from '../Icons'
import { GITHUB_CONNECTOR_MANIFEST } from '@spark/protocol'
import type {
  ConnectorAuthMethod,
  ConnectorCapabilityKind,
  ConnectorConnectionStatus,
  GitHubConnectorConnection,
  McpServerItem,
} from '@spark/protocol'
import { Input as LobeInput, Select as LobeSelect } from '@lobehub/ui'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useApp } from '../AppContext'
import './McpView.less'

type StatusFilter = 'all' | 'ok' | 'warn' | 'err' | 'off'
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
  auth?: { type?: 'none' | 'oauth2'; scope?: string; dcr?: boolean; clientId?: string; clientSecret?: string; hasClientSecret?: boolean }
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

const SCOPES = ['system', 'user', 'project', 'team', 'session'] as const

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string; color: string }> = [
  { value: 'all', label: '全部', color: 'gray' },
  { value: 'ok', label: '在线', color: 'green' },
  { value: 'warn', label: '需注意', color: 'orange' },
  { value: 'err', label: '错误', color: 'red' },
  { value: 'off', label: '未启用', color: 'gray' },
]

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
      ...(!draft.authDcr ? { clientId: draft.authClientId.trim(), hasClientSecret: draft.authClientSecret.trim().length > 0 } : {}),
      ...(!draft.authDcr && draft.authClientSecret.trim().length > 0 ? { clientSecret: draft.authClientSecret.trim() } : {}),
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
    if (explicit === 'stdio' && (config.command ?? '').trim().length === 0 && (config.url ?? '').trim().length > 0) {
      return 'http'
    }
    return explicit
  }
  if ((config.url ?? '').trim().length > 0) return 'http'
  return 'stdio'
}

function deriveServer(item: McpServerItem, authStatus: McpOAuthStatus = 'unconfigured'): ServerDerived {
  const config = parseConfig(item.configJson)
  const transport = normalizeTransport(config)
  const endpoint = transport === 'stdio' ? (config.command ?? '') : (config.url ?? '')
  const valid = endpoint.trim().length > 0
  const authEnabled = config.auth?.type === 'oauth2'
  const needsAuth = authEnabled && authStatus !== 'authorized'
  const status: ServerDerived['status'] = !item.enabled ? 'off' : !valid ? 'warn' : authStatus === 'failed' ? 'err' : needsAuth ? 'warn' : 'ok'
  const desc =
    config.description?.trim() && config.description.trim().length > 0
      ? config.description.trim()
      : transport === 'stdio'
        ? `${transport} · ${config.command ?? '未配置启动信息'}`
        : `${transport} · ${config.url ?? '未配置 URL'}`
  let statusLabel: string
  if (status === 'off') statusLabel = '未启用'
  else if (authStatus === 'authorized') statusLabel = '已授权'
  else if (authStatus === 'authorizing') statusLabel = '授权中'
  else if (authStatus === 'failed') statusLabel = '授权失败'
  else if (needsAuth) statusLabel = '需要授权'
  else if (status === 'warn') statusLabel = '配置不完整'
  else statusLabel = '本地配置'

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

type McpTab = 'mcp' | 'connectors'

export function McpView() {
  const { requestConfirm } = useApp()
  const [activeTab, setActiveTab] = useState<McpTab>('mcp')
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
  const { invoke: authorizeMcp } = useIpcInvoke('mcp:authorize')
  const { invoke: deauthorizeMcp } = useIpcInvoke('mcp:deauthorize')
  const { invoke: getAuthStatus } = useIpcInvoke('mcp:auth-status')

  const refresh = useCallback(() => {
    listMcp(scopeFilter === 'all' ? {} : { scope: scopeFilter })
      .then(async (res) => {
        const nextServers = res.servers ?? []
        setServers(nextServers)
        const entries = await Promise.all(nextServers.map(async (server) => {
          const config = parseConfig(server.configJson)
          if (config.auth?.type !== 'oauth2') return [server.id, 'unconfigured'] as const
          try {
            const auth = await getAuthStatus({ serverId: server.id })
            return [server.id, auth.status] as const
          } catch {
            return [server.id, 'failed'] as const
          }
        }))
        setAuthStatuses(Object.fromEntries(entries))
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : '加载 MCP 服务器失败'
        message.error(errorMsg)
      })
  }, [listMcp, getAuthStatus, scopeFilter])

  useRefreshable(refresh)

  useEffect(() => {
    const id = window.setTimeout(refresh, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  const derived = useMemo(() => servers.map((server) => deriveServer(server, authStatuses[server.id] ?? 'unconfigured')), [servers, authStatuses])

  const statusCounts = useMemo(() => {
    return {
      all: derived.length,
      ok: derived.filter((s) => s.status === 'ok').length,
      warn: derived.filter((s) => s.status === 'warn').length,
      err: derived.filter((s) => s.status === 'err').length,
      off: derived.filter((s) => s.status === 'off').length,
    }
  }, [derived])

  const totalTools = useMemo(
    () => derived.reduce((sum, server) => sum + server.tools, 0),
    [derived],
  )

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
    if (value.name.trim().length === 0) return '名称不能为空'
    if (value.transport === 'stdio') {
      if (value.command.trim().length === 0) return 'stdio 服务器需要填写启动命令'
    } else {
      if (value.url.trim().length === 0) return 'HTTP / SSE 服务器需要填写 URL'
      try {
        // 允许 ws / http / https
        const url = new URL(value.url.trim())
        if (!/^https?:$/.test(url.protocol) && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
          return 'URL 协议必须是 http / https / ws / wss'
        }
      } catch {
        return 'URL 格式不正确'
      }
    }
    if (value.transport !== 'stdio' && value.authType === 'oauth2' && !value.authDcr && value.authClientId.trim().length === 0) {
      return '关闭动态注册时需要填写 Client ID'
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
        message.success('MCP 服务器已添加')
      } else {
        await updateMcp({
          id: editingId,
          name: draft.name.trim(),
          configJson,
          enabled: draft.enabled,
        })
        message.success('已保存')
      }
      setDrawerOpen(false)
      refresh()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '保存失败'
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
        const errorMsg = err instanceof Error ? err.message : '更新状态失败'
        message.error(errorMsg)
      }
    },
    [updateMcp, refresh],
  )

  const handleDelete = useCallback(
    async (item: McpServerItem) => {
      const confirmed = await requestConfirm({
        title: `删除 ${item.name}？`,
        description: '删除后该 MCP 配置会从本地移除，相关工具将不再可用。',
        confirmText: '删除',
        danger: true,
      })
      if (!confirmed) return
      try {
        await deleteMcp({ id: item.id })
        message.success('已删除')
        refresh()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '删除失败'
        message.error(errorMsg)
      }
    },
    [requestConfirm, deleteMcp, refresh],
  )


  const handleAuthorize = useCallback(async (item: McpServerItem) => {
    setAuthorizingId(item.id)
    setAuthStatuses((prev) => ({ ...prev, [item.id]: 'authorizing' }))
    try {
      await authorizeMcp({ serverId: item.id })
      message.success('MCP 授权已完成')
      refresh()
    } catch (err) {
      setAuthStatuses((prev) => ({ ...prev, [item.id]: 'failed' }))
      message.error(err instanceof Error ? err.message : 'MCP 授权失败')
    } finally {
      setAuthorizingId(null)
    }
  }, [authorizeMcp, refresh])

  const handleDeauthorize = useCallback(async (item: McpServerItem) => {
    try {
      await deauthorizeMcp({ serverId: item.id })
      message.success('已断开授权')
      refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '断开授权失败')
    }
  }, [deauthorizeMcp, refresh])

  return (
    <>
      <div className="mv_root">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mv_header">
          <div className="mv_header_left">
            <h2>连接器与 MCP</h2>
            <Tag color="blue">{activeTab === 'mcp' ? derived.length : 1}</Tag>
            <span className="mv_header_subtitle">
              {activeTab === 'mcp'
                ? `· ${totalTools} 个工具 · 配置保存在本地`
                : '· 统一连接器协议 · GitHub 已就绪'}
            </span>
          </div>
          {activeTab === 'mcp' && (
            <div className="mv_header_right">
              <div className="mv_search_wrap">
                <LobeInput
                  size="middle"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索服务器名称、传输、端点..."
                  prefix={<Icons.Search size={14} />}
                />
              </div>
              <Tooltip title="刷新 (Ctrl+R)">
                <Button
                  size="middle"
                  shape="circle"
                  type="text"
                  icon={<Icons.Refresh size={12} />}
                  onClick={refresh}
                />
              </Tooltip>
              <Button type="primary" size="middle" icon={<Icons.Plus size={12} />} onClick={openCreate}>
                添加 MCP
              </Button>
            </div>
          )}
        </div>

        <div className="mv_tabs" role="tablist" aria-label="连接器与 MCP">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mcp'}
            className={`mv_tab ${activeTab === 'mcp' ? 'mv_tab_active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            MCP
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connectors'}
            className={`mv_tab ${activeTab === 'connectors' ? 'mv_tab_active' : ''}`}
            onClick={() => setActiveTab('connectors')}
          >
            连接器
          </button>
        </div>

        {activeTab === 'connectors' ? (
          <ConnectorsPanel />
        ) : (
          <>
            {/* ── 工具栏：状态过滤 + 作用域 ─────────────────────────────── */}
            <div className="mv_toolbar">
              <div className="mv_status_chips">
                {STATUS_OPTIONS.map((option) => {
                  const active = statusFilter === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`mv_status_chip ${active ? 'mv_chip_active' : ''}`}
                      onClick={() => setStatusFilter(option.value)}
                    >
                      <span className="mv_status_chip_dot" />
                      {option.label}
                      <span style={{ opacity: 0.6, marginLeft: 2 }}>
                        {statusCounts[option.value]}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="mv_toolbar_spacer" />
              <span className="mv_scope_label">作用域</span>
              <div className="mv_segmented">
                <button
                  type="button"
                  className={`mv_segmented_item ${scopeFilter === 'all' ? 'mv_segmented_active' : ''}`}
                  onClick={() => setScopeFilter('all')}
                >
                  全部
                </button>
                {SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={`mv_segmented_item ${scopeFilter === scope ? 'mv_segmented_active' : ''}`}
                    onClick={() => setScopeFilter(scope)}
                  >
                    {scope.charAt(0).toUpperCase() + scope.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 卡片网格 ─────────────────────────────────────────────── */}
            <div className="mv_grid_wrap">
              {loading && derived.length === 0 ? (
                <div className="mv_empty">
                  <div className="mv_empty_title">正在加载...</div>
                  <div className="mv_empty_desc">从本地 SQLite 读取 MCP 配置</div>
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
        title={editingId == null ? '添加 MCP 服务器' : '编辑 MCP 服务器'}
        open={drawerOpen}
        onClose={closeDrawer}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="text" onClick={closeDrawer} disabled={saving}>
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void handleSave()}
              icon={<Icons.Check />}
            >
              {editingId == null ? '添加' : '保存'}
            </Button>
          </div>
        }
        keyboard={!saving}
        maskClosable={!saving}
      >
        <McpForm draft={draft} setDraft={setDraft} error={draftError} />
      </Drawer>
    </>
  )
}

// ── 子组件：单张 MCP 卡片 ────────────────────────────────────────────────

function McpCard({
  server,
  onToggle,
  onEdit,
  onDelete,
  onAuthorize,
  onDeauthorize,
  authorizing,
}: {
  server: ServerDerived
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDelete: () => void
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
              {server.endpoint || '未配置端点'}
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
        {server.authEnabled && (
          server.authStatus === 'authorized' ? (
            <Button type="text" size="small" onClick={onDeauthorize}>断开授权</Button>
          ) : (
            <Button type="primary" size="small" loading={authorizing} onClick={onAuthorize}>
              {server.authStatus === 'failed' ? '重新授权' : '连接授权'}
            </Button>
          )
        )}
        <Tooltip title="编辑">
          <Button type="text" size="small" icon={<Icons.Edit />} onClick={onEdit} />
        </Tooltip>
        <Tooltip title="删除">
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
              <div className="mv_empty_title">没有匹配的 MCP 服务器</div>
              <div className="mv_empty_desc">试试调整搜索关键词或清除过滤条件</div>
            </div>
          ) : (
            <div>
              <div className="mv_empty_title">还没有配置 MCP 服务器</div>
              <div className="mv_empty_desc">
                添加一个 stdio / http / sse 协议的 MCP 服务器，Claude SDK 与本地 Codex CLI Agent
                即可调用其暴露的工具
              </div>
            </div>
          )
        }
      />
      {!isFiltered && (
        <Button type="primary" size="middle" icon={<Icons.Plus />} onClick={onAdd}>
          添加第一个 MCP
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
          <span className="mv_drawer_section_title">基本信息</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_form_grid">
            <label className="mv_form_label">
              名称
              <span className="mv_form_sub">用于在工具与列表中标识</span>
            </label>
            <div className="mv_form_field">
              <LobeInput
                value={draft.name}
                style={{
                  minWidth: 200,
                }}
                onChange={(event) => update('name', event.target.value)}
                placeholder="例：filesystem"
              />
            </div>

            <label className="mv_form_label">作用域</label>
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
                决定配置的可见范围与会话覆盖优先级；会按 Agent / Workflow 配置注入 Claude SDK 与本地
                Codex CLI
              </span>
            </div>

            <label className="mv_form_label">描述</label>
            <div className="mv_form_field">
              <LobeInput
                style={{
                  minWidth: 200,
                }}
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="可选：给该 MCP 写一句话说明"
              />
            </div>

            <label className="mv_form_label">启用</label>
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
          <span className="mv_drawer_section_title">启动配置</span>
          <span className="mv_drawer_section_hint">{isStdio ? 'stdio' : 'http / sse'}</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_form_grid">
            <label className="mv_form_label">传输</label>
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
                  启动命令
                  <span className="mv_form_sub">在用户目录执行的二进制</span>
                </label>
                <div className="mv_form_field">
                  <LobeInput
                    value={draft.command}
                    onChange={(event) => update('command', event.target.value)}
                    placeholder="npx"
                  />
                </div>

                <label className="mv_form_label">
                  参数
                  <span className="mv_form_sub">空格分隔</span>
                </label>
                <div className="mv_form_field">
                  <LobeInput
                    value={draft.args}
                    onChange={(event) => update('args', event.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem ."
                  />
                </div>
              </>
            ) : (
              <label className="mv_form_label">
                URL
                <span className="mv_form_sub">HTTP / SSE 端点</span>
              </label>
            )}
            {!isStdio && (
              <div className="mv_form_field">
                <LobeInput
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
            <span className="mv_drawer_section_title">认证方式</span>
            <span className="mv_drawer_section_hint">OAuth 2.0 / PKCE</span>
          </header>
          <div className="mv_drawer_section_body">
            <div className="mv_form_grid">
              <label className="mv_form_label">认证</label>
              <div className="mv_form_field">
                <div className="mv_segmented">
                  {(['none', 'oauth2'] as const).map((authType) => (
                    <button key={authType} type="button" className={`mv_segmented_item ${draft.authType === authType ? 'mv_segmented_active' : ''}`} onClick={() => update('authType', authType)}>
                      {authType === 'none' ? '无' : 'OAuth 2.0'}
                    </button>
                  ))}
                </div>
              </div>
              {draft.authType === 'oauth2' && (
                <>
                  <label className="mv_form_label">Scope</label>
                  <div className="mv_form_field"><LobeInput value={draft.authScope} onChange={(event) => update('authScope', event.target.value)} placeholder="可选 OAuth scope" /></div>
                  <label className="mv_form_label">动态注册</label>
                  <div className="mv_form_field mv_form_field_inline"><Switch checked={draft.authDcr} onChange={(checked) => update('authDcr', checked)} checkedChildren="ON" unCheckedChildren="OFF" /></div>
                  {!draft.authDcr && (
                    <>
                      <label className="mv_form_label">Client ID</label>
                      <div className="mv_form_field"><LobeInput value={draft.authClientId} onChange={(event) => update('authClientId', event.target.value)} placeholder="静态 client_id" /></div>
                      <label className="mv_form_label">Client Secret</label>
                      <div className="mv_form_field"><LobeInput type="password" value={draft.authClientSecret} onChange={(event) => update('authClientSecret', event.target.value)} placeholder="可选，保存到安全存储迁移前暂存配置" /></div>
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
          <span className="mv_drawer_section_title">环境变量</span>
          <span className="mv_drawer_section_hint">仅 stdio 模式生效</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_env_list">
            {draft.env.length === 0 ? (
              <div className="mv_env_empty">暂无环境变量，点击下方按钮添加</div>
            ) : (
              draft.env.map((row, idx) => (
                <div key={idx} className="mv_env_row">
                  <div className="mv_env_key">
                    <LobeInput
                      value={row.key}
                      onChange={(event) => updateEnvRow(idx, { key: event.target.value })}
                      placeholder="KEY"
                    />
                  </div>
                  <div className="mv_env_val">
                    <LobeInput
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
            添加变量
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

function readGitHubConnectorState(connection: GitHubConnectorConnection | null): ConnectorLocalState {
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
    return state.lastError != null ? { color: 'red', label: '需处理' } : { color: 'orange', label: '待认证' }
  }
  if (!state.enabled || state.status === 'disabled') return { color: 'default', label: '已禁用' }
  if (state.status === 'connected') return { color: 'green', label: '已连接' }
  if (state.status === 'syncing') return { color: 'blue', label: '同步中' }
  if (state.status === 'needs_auth') return { color: 'orange', label: '需重新认证' }
  return { color: 'red', label: '需处理' }
}

function ConnectorsPanel() {
  const [persistedConnection, setPersistedConnection] = useState<GitHubConnectorConnection | null>(null)
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
        next.lastError = err instanceof Error ? err.message : 'GitHub 连接状态读取失败'
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
        lastError: `${selectedAuth?.label ?? '该认证方式'} 需要主进程 OAuth/Device/GitHub App 接线；已打开配置入口。`,
      })
      return
    }

    const token = patToken.trim()
    if (token.length === 0) {
      message.warning('请输入 GitHub Fine-grained PAT 后再连接')
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
      message.success('GitHub 连接已保存，下次启动仍可继续使用')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub 连接验证失败'
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
        message.success('GitHub PAT 已更新并重新验证')
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
      message.success('GitHub 连接设置已保存')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub 连接保存失败'
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
      message.success('GitHub 连接已断开')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub 断开失败'
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
            <span>已连接账号：{state.accountLogin}</span>
            {state.lastCheckedAt != null && (
              <small>最近成功访问：{new Date(state.lastCheckedAt).toLocaleString()}</small>
            )}
          </div>
        )}
        {state.grantedScopes.length > 0 && (
          <div className="mv_connector_error">
            授权范围：{state.grantedScopes.join(', ')}
          </div>
        )}
        {state.lastError != null && <div className="mv_connector_error">{state.lastError}</div>}
        {bootstrapping && <div className="mv_connector_error">正在读取已保存的 GitHub 连接状态…</div>}

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
          <label className="mv_form_label">当前认证</label>
          <div className="mv_form_field">
            <span className="mv_form_hint">
              {manifest.auth.find((auth) => auth.method === state.authMethod)?.description}
            </span>
          </div>

          {state.authMethod === 'pat' && (
            <>
              <label className="mv_form_label">PAT</label>
              <div className="mv_form_field">
                <LobeInput
                  type="password"
                  value={patToken}
                  onChange={(event) => setPatToken(event.target.value)}
                  placeholder="github_pat_..."
                />
                <span className="mv_form_hint">
                  首次连接会把 PAT 保存到系统 keystore；后续如需轮换凭证，可在这里重新填写并保存。
                </span>
              </div>
            </>
          )}

          <label className="mv_form_label">仓库范围</label>
          <div className="mv_form_field">
            <LobeInput
              value={state.repos}
              onChange={(event) => setState({ ...state, repos: event.target.value })}
              placeholder="owner/repo, org/backend"
            />
            <span className="mv_form_hint">
              留空表示允许访问 PAT 授权范围内的全部仓库；多个仓库用逗号分隔。
            </span>
          </div>

          <label className="mv_form_label">连接启用</label>
          <div className="mv_form_field mv_form_field_inline">
            <Switch
              size="middle"
              checked={state.enabled}
              onChange={(checked) => setState({ ...state, enabled: checked })}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
            <span className="mv_form_hint">
              关闭后保留凭证与配置，但 agent 不再获得 GitHub 访问能力。
            </span>
          </div>

          <label className="mv_form_label">写入能力</label>
          <div className="mv_form_field mv_form_field_inline">
            <Switch
              size="middle"
              checked={state.allowWrites}
              onChange={(checked) => setState({ ...state, allowWrites: checked })}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
            <span className="mv_form_hint">
              开启后才允许提交、创建分支、PR 和写回 Issue；默认关闭。
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
                ? '更新 PAT 并重新验证'
                : '保存连接设置'
              : '验证并连接 GitHub'}
          </Button>
          {hasConnection && (
            <Button
              type="text"
              loading={checking}
              danger
              icon={<Icons.X />}
              onClick={() => void handleDisconnect()}
            >
              断开 GitHub
            </Button>
          )}
          <Button
            type="text"
            icon={<Icons.ExternalLink />}
            onClick={() =>
              window.open('https://github.com/settings/personal-access-tokens', '_blank')
            }
          >
            创建 Fine-grained PAT
          </Button>
        </div>
      </section>
    </div>
  )
}
