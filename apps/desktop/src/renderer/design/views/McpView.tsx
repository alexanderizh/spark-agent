/**
 * McpView — MCP 服务器管理
 *
 * 设计要点
 * ────────
 * - 与 ProvidersView 对齐，全部使用 Arco Design 组件 + `@arco-design/web-react/icon`。
 * - 顶部 Header：标题 + 计数 + 搜索 + 刷新 + 添加按钮。
 * - 工具栏：状态过滤 chip（全部 / 在线 / 需注意 / 错误 / 未启用）+ 作用域 segmented。
 * - 卡片网格：每张卡片展示 logo / 名称 / 作用域 / 传输 / 描述 / 状态 / 工具数 / 启停开关。
 * - 添加 / 编辑：使用 Arco Drawer，结构化分组（基本信息 / 启动配置 / 环境变量）。
 * - 样式落在 `McpView.less`（mv_ 前缀），不再依赖 views.css 的旧全局类。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, Tag, Switch, Drawer, Empty, Tooltip, Message,
} from '@arco-design/web-react'
import {
  IconPlus, IconRefresh, IconSearch, IconStorage, IconLink, IconCode,
  IconDelete, IconEdit, IconCheck, IconClose, IconExclamationCircle,
  IconTool,
} from '@arco-design/web-react/icon'
import type { McpServerItem } from '@spark/protocol'
import { SparkInput, SparkSelect } from '../components/FormControls'
import { MacWindowDragHeader } from '../components/MacWindowDragHeader'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useApp } from '../AppContext'
import './McpView.less'

type StatusFilter = 'all' | 'ok' | 'warn' | 'err' | 'off'
type McpTransport = 'stdio' | 'http' | 'sse'

type ParsedConfig = {
  transport?: McpTransport
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
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
  const env: Record<string, string> = {}
  for (const { key, value } of draft.env) {
    const k = key.trim()
    if (k.length > 0) env[k] = value
  }
  if (Object.keys(env).length > 0) config.env = env
  return JSON.stringify(config)
}

function deriveServer(item: McpServerItem): ServerDerived {
  const config = parseConfig(item.configJson)
  const transport: McpTransport = config.transport ?? 'stdio'
  const endpoint = transport === 'stdio' ? (config.command ?? '') : (config.url ?? '')
  const valid = endpoint.trim().length > 0
  const status: ServerDerived['status'] = !item.enabled ? 'off' : valid ? 'ok' : 'warn'
  const desc = config.description?.trim() && config.description.trim().length > 0
    ? config.description.trim()
    : transport === 'stdio'
      ? `${transport} · ${config.command ?? '未配置启动信息'}`
      : `${transport} · ${config.url ?? '未配置 URL'}`
  let statusLabel: string
  if (status === 'off') statusLabel = '未启用'
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
  }
}

function draftFromItem(item: McpServerItem | null): DraftBase {
  if (item == null) return { ...EMPTY_DRAFT, env: [] }
  const config = parseConfig(item.configJson)
  const env = Object.entries(config.env ?? {}).map(([key, value]) => ({ key, value }))
  return {
    name: item.name,
    scope: item.scope,
    transport: (config.transport ?? 'stdio') as McpTransport,
    command: config.command ?? '',
    args: (config.args ?? []).join(' '),
    url: config.url ?? '',
    description: config.description ?? '',
    env,
    enabled: item.enabled,
  }
}

export function McpView() {
  const { requestConfirm } = useApp()
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftBase>(EMPTY_DRAFT)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { invoke: listMcp, loading } = useIpcInvoke('mcp:list')
  const { invoke: createMcp } = useIpcInvoke('mcp:create')
  const { invoke: updateMcp } = useIpcInvoke('mcp:update')
  const { invoke: deleteMcp } = useIpcInvoke('mcp:delete')

  const refresh = useCallback(() => {
    listMcp(scopeFilter === 'all' ? {} : { scope: scopeFilter })
      .then((res) => setServers(res.servers ?? []))
      .catch((err) => {
        const message = err instanceof Error ? err.message : '加载 MCP 服务器失败'
        Message.error(message)
      })
  }, [listMcp, scopeFilter])

  useRefreshable(refresh)

  useEffect(() => {
    const id = window.setTimeout(refresh, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  const derived = useMemo(() => servers.map(deriveServer), [servers])

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
      return [server.name, server.scope, server.desc, server.transport, server.endpoint]
        .some((value) => value.toLowerCase().includes(keyword))
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
        Message.success('MCP 服务器已添加')
      } else {
        await updateMcp({
          id: editingId,
          name: draft.name.trim(),
          configJson,
          enabled: draft.enabled,
        })
        Message.success('已保存')
      }
      setDrawerOpen(false)
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败'
      setDraftError(message)
      Message.error(message)
    } finally {
      setSaving(false)
    }
  }, [draft, editingId, createMcp, updateMcp, refresh])

  const handleToggle = useCallback(async (item: McpServerItem, next: boolean) => {
    try {
      await updateMcp({ id: item.id, enabled: next })
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新状态失败'
      Message.error(message)
    }
  }, [updateMcp, refresh])

  const handleDelete = useCallback(async (item: McpServerItem) => {
    const confirmed = await requestConfirm({
      title: `删除 ${item.name}？`,
      description: '删除后该 MCP 配置会从本地移除，相关工具将不再可用。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteMcp({ id: item.id })
      Message.success('已删除')
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败'
      Message.error(message)
    }
  }, [requestConfirm, deleteMcp, refresh])

  return (
    <>
      <MacWindowDragHeader />
      <div className="mv_root">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mv_header">
          <div className="mv_header_left">
            <h2>MCP</h2>
            <Tag size="small" color="arcoblue">{derived.length}</Tag>
            <span className="mv_header_subtitle">· {totalTools} 个工具 · 配置保存在本地</span>
          </div>
          <div className="mv_header_right">
            <div className="mv_search_wrap">
              <SparkInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索服务器名称、传输、端点..."
                icon={<IconSearch />}
              />
            </div>
            <Tooltip content="刷新 (Ctrl+R)">
              <Button
                size="small"
                shape="circle"
                type="text"
                icon={<IconRefresh />}
                onClick={refresh}
              />
            </Tooltip>
            <Button
              type="primary"
              size="small"
              icon={<IconPlus />}
              onClick={openCreate}
            >
              添加 MCP
            </Button>
          </div>
        </div>

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
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Drawer：添加 / 编辑 ────────────────────────────────────── */}
      <Drawer
        width={520}
        title={editingId == null ? '添加 MCP 服务器' : '编辑 MCP 服务器'}
        visible={drawerOpen}
        onCancel={closeDrawer}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={closeDrawer} disabled={saving}>取消</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void handleSave()}
              icon={<IconCheck />}
            >
              {editingId == null ? '添加' : '保存'}
            </Button>
          </div>
        }
        escToExit={!saving}
        maskClosable={!saving}
      >
        <McpForm
          draft={draft}
          setDraft={setDraft}
          error={draftError}
        />
      </Drawer>
    </>
  )
}

// ── 子组件：单张 MCP 卡片 ────────────────────────────────────────────────

function McpCard({
  server, onToggle, onEdit, onDelete,
}: {
  server: ServerDerived
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const logoText = server.name.slice(0, 2).toUpperCase() || 'MCP'
  const statusClass =
    server.status === 'ok' ? 'mv_status_ok' :
    server.status === 'warn' ? 'mv_status_warn' :
    server.status === 'err' ? 'mv_status_err' : 'mv_status_off'
  const isOn = server.status !== 'off'
  return (
    <div className="mv_card">
      <div className="mv_card_top">
        <div className="mv_card_logo">{logoText}</div>
        <div className="mv_card_info">
          <div className="mv_card_name_row">
            <span className="mv_card_name" title={server.name}>{server.name}</span>
            <Tag size="small" color="gray" bordered>
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
          size="small"
          checked={isOn}
          onChange={onToggle}
          checkedText="ON"
          uncheckedText="OFF"
        />
      </div>

      <div className="mv_card_desc" title={server.desc}>{server.desc}</div>

      <div className="mv_card_foot">
        <span className={`mv_card_status ${statusClass}`}>
          <span className={`mv_status_dot ${server.status === 'ok' ? 'mv_dot_pulse' : ''}`} />
          {server.statusLabel}
        </span>
        {server.tools > 0 && (
          <span className="mv_card_tools">
            <IconTool /> {server.tools} tools
          </span>
        )}
        <div className="mv_toolbar_spacer" />
        <Tooltip content="编辑">
          <Button
            type="text"
            size="mini"
            icon={<IconEdit />}
            onClick={onEdit}
          />
        </Tooltip>
        <Tooltip content="删除">
          <Button
            type="text"
            size="mini"
            status="danger"
            icon={<IconDelete />}
            onClick={onDelete}
          />
        </Tooltip>
      </div>
    </div>
  )
}

// ── 子组件：Empty 状态 ───────────────────────────────────────────────────

function EmptyState({
  totalCount, hasQuery, onAdd,
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
                添加一个 stdio / http / sse 协议的 MCP 服务器，Agent 即可调用其暴露的工具
              </div>
            </div>
          )
        }
      />
      {!isFiltered && (
        <Button type="primary" size="small" icon={<IconPlus />} onClick={onAdd}>
          添加第一个 MCP
        </Button>
      )}
    </div>
  )
}

// ── 子组件：MCP 表单（Drawer body） ──────────────────────────────────────

function McpForm({
  draft, setDraft, error,
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
          <IconExclamationCircle />
          {error}
        </div>
      )}

      {/* ── 基本信息 ── */}
      <section className="mv_drawer_section">
        <header className="mv_drawer_section_head">
          <span className="mv_drawer_section_icon"><IconStorage /></span>
          <span className="mv_drawer_section_title">基本信息</span>
        </header>
        <div className="mv_drawer_section_body">
          <div className="mv_form_grid">
            <label className="mv_form_label">
              名称
              <span className="mv_form_sub">用于在工具与列表中标识</span>
            </label>
            <div className="mv_form_field">
              <SparkInput
                value={draft.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="例：filesystem"
              />
            </div>

            <label className="mv_form_label">作用域</label>
            <div className="mv_form_field">
              <SparkSelect
                value={draft.scope}
                onChange={(event) => update('scope', event.target.value)}
              >
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>{scope}</option>
                ))}
              </SparkSelect>
              <span className="mv_form_hint">决定配置的可见范围与会话覆盖优先级</span>
            </div>

            <label className="mv_form_label">描述</label>
            <div className="mv_form_field">
              <SparkInput
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="可选：给该 MCP 写一句话说明"
              />
            </div>

            <label className="mv_form_label">启用</label>
            <div className="mv_form_field mv_form_field_inline">
              <Switch
                size="small"
                checked={draft.enabled}
                onChange={(checked) => update('enabled', checked)}
                checkedText="ON"
                uncheckedText="OFF"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 启动配置 ── */}
      <section className="mv_drawer_section">
        <header className="mv_drawer_section_head">
          <span className="mv_drawer_section_icon">
            {isStdio ? <IconCode /> : <IconLink />}
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
                  <SparkInput
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
                  <SparkInput
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
                <SparkInput
                  value={draft.url}
                  onChange={(event) => update('url', event.target.value)}
                  placeholder="https://mcp.example.com/sse"
                />
              </div>
            )}
          </div>
        </div>
      </section>

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
                    <SparkInput
                      value={row.key}
                      onChange={(event) => updateEnvRow(idx, { key: event.target.value })}
                      placeholder="KEY"
                    />
                  </div>
                  <div className="mv_env_val">
                    <SparkInput
                      value={row.value}
                      onChange={(event) => updateEnvRow(idx, { value: event.target.value })}
                      placeholder="value"
                    />
                  </div>
                  <Button
                    type="text"
                    size="mini"
                    status="danger"
                    icon={<IconClose />}
                    onClick={() => removeEnvRow(idx)}
                  />
                </div>
              ))
            )}
          </div>
          <Button
            className="mv_env_add"
            type="outline"
            size="mini"
            icon={<IconPlus />}
            onClick={addEnvRow}
          >
            添加变量
          </Button>
        </div>
      </section>
    </div>
  )
}
