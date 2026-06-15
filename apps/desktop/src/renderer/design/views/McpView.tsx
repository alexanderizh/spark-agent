/**
 * McpView — MCP 服务器列表 + 侧拉框表单（新增 / 编辑）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { McpServerItem } from '@spark/protocol'
import { Icons } from '../Icons'
import { SparkInput, SparkSearchInput, SparkSelect, SparkTextarea, SparkCheckbox } from '../components/FormControls'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useApp } from '../AppContext'
import './McpView.less'

type ServerStatus = 'ok' | 'warn' | 'err' | 'off'

type Server = {
  id: string
  logo: string
  name: string
  scope: string
  desc: string
  tools: number
  transport: string
  status: ServerStatus
  latency?: string
  detail?: string
}

type McpConfig = {
  transport?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  tools?: string[]
  description?: string
}

type Transport = 'stdio' | 'http' | 'sse'

type DraftState = {
  id: string | null
  mode: 'create' | 'edit' | null
  name: string
  scope: string
  transport: Transport
  command: string
  argsText: string
  url: string
  headersText: string
  envText: string
  description: string
  enabled: boolean
}

const SCOPES = ['system', 'user', 'project', 'team', 'session']

const EMPTY_DRAFT: DraftState = {
  id: null,
  mode: null,
  name: '',
  scope: 'user',
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  headersText: '',
  envText: '',
  description: '',
  enabled: true,
}

function parseConfig(configJson: string): McpConfig {
  try {
    const value = JSON.parse(configJson) as McpConfig
    return value ?? {}
  } catch {
    return {}
  }
}

function toServer(item: McpServerItem): Server {
  const config = parseConfig(item.configJson)
  const transport = config.transport ?? 'stdio'
  const endpoint = transport === 'stdio' ? config.command : config.url
  const tools = config.tools?.length ?? 0
  const valid = endpoint != null && endpoint.trim().length > 0
  const status: ServerStatus = !item.enabled ? 'off' : valid ? 'ok' : 'warn'
  const scope = item.scope.slice(0, 1).toUpperCase() + item.scope.slice(1)
  return {
    id: item.id,
    logo: item.name.slice(0, 2).toUpperCase(),
    name: item.name,
    scope,
    desc: config.description?.trim() || `${transport} · ${endpoint ?? '未配置启动信息'}`,
    tools,
    transport,
    status,
    ...(status === 'ok' ? { latency: '本地配置' } : {}),
    ...(status === 'warn' ? { detail: '配置不完整' } : {}),
    ...(status === 'off' ? { detail: '未启用' } : {}),
  }
}

function kvTextFromRecord(record?: Record<string, string>): string {
  if (!record) return ''
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function recordFromKvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const idx = line.indexOf(':')
    const eq = line.indexOf('=')
    let key = ''
    let val = ''
    if (idx >= 0 && (eq < 0 || idx < eq)) {
      key = line.slice(0, idx).trim()
      val = line.slice(idx + 1).trim()
    } else if (eq >= 0) {
      key = line.slice(0, eq).trim()
      val = line.slice(eq + 1).trim()
    } else {
      key = line
      val = ''
    }
    if (key) out[key] = val
  }
  return out
}

function argsTextFromArray(args?: string[]): string {
  if (!args || args.length === 0) return ''
  return args.join('\n')
}

function arrayFromArgsText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function McpView() {
  const { requestConfirm } = useApp()
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [error, setError] = useState('')
  const [panelError, setPanelError] = useState('')
  const [saving, setSaving] = useState(false)

  const { invoke: listMcp, loading } = useIpcInvoke('mcp:list')
  const { invoke: createMcp } = useIpcInvoke('mcp:create')
  const { invoke: updateMcp } = useIpcInvoke('mcp:update')
  const { invoke: deleteMcp } = useIpcInvoke('mcp:delete')

  const refresh = useCallback(() => {
    setError('')
    listMcp(scopeFilter === 'all' ? {} : { scope: scopeFilter })
      .then((res) => setServers(res.servers))
      .catch((err) => setError(err instanceof Error ? err.message : '加载 MCP 服务器失败'))
  }, [listMcp, scopeFilter])

  useRefreshable(refresh)

  useEffect(() => {
    const id = window.setTimeout(() => {
      refresh()
    }, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  const mappedServers = useMemo(() => servers.map(toServer), [servers])
  const filteredServers = mappedServers.filter((server) => {
    const keyword = query.trim().toLowerCase()
    if (keyword.length === 0) return true
    return [server.name, server.scope, server.desc, server.transport].some((value) =>
      value.toLowerCase().includes(keyword),
    )
  })

  const onlineCount = mappedServers.filter((server) => server.status === 'ok').length
  const warnCount = mappedServers.filter((server) => server.status === 'warn').length
  const errorCount = mappedServers.filter((server) => server.status === 'err').length
  const offCount = mappedServers.filter((server) => server.status === 'off').length
  const totalTools = mappedServers.reduce((sum, server) => sum + server.tools, 0)

  const openCreate = () => {
    setPanelError('')
    setDraft({ ...EMPTY_DRAFT, mode: 'create' })
  }

  const openEdit = (item: McpServerItem) => {
    setPanelError('')
    const config = parseConfig(item.configJson)
    const transport = config.transport ?? 'stdio'
    setDraft({
      id: item.id,
      mode: 'edit',
      name: item.name,
      scope: item.scope,
      transport,
      command: config.command ?? '',
      argsText: argsTextFromArray(config.args),
      url: config.url ?? '',
      headersText: kvTextFromRecord(config.headers),
      envText: kvTextFromRecord(config.env),
      description: config.description ?? '',
      enabled: item.enabled,
    })
  }

  const closePanel = () => {
    if (saving) return
    setDraft(EMPTY_DRAFT)
    setPanelError('')
  }

  const patch = (patch: Partial<DraftState>) => setDraft((prev) => ({ ...prev, ...patch }))

  const buildConfig = (): McpConfig | null => {
    const name = draft.name.trim()
    if (name.length === 0) {
      setPanelError('名称不能为空')
      return null
    }
    if (draft.transport === 'stdio') {
      if (!draft.command.trim()) {
        setPanelError('stdio 服务器需要填写启动命令')
        return null
      }
    } else if (!draft.url.trim()) {
      setPanelError(`${draft.transport.toUpperCase()} 服务器需要填写 URL`)
      return null
    }

    const config: McpConfig = {
      transport: draft.transport,
      description: draft.description.trim(),
    }
    if (draft.transport === 'stdio') {
      config.command = draft.command.trim()
      const args = arrayFromArgsText(draft.argsText)
      if (args.length > 0) config.args = args
      const env = recordFromKvText(draft.envText)
      if (Object.keys(env).length > 0) config.env = env
    } else {
      config.url = draft.url.trim()
      const headers = recordFromKvText(draft.headersText)
      if (Object.keys(headers).length > 0) config.headers = headers
    }
    return config
  }

  const handleSave = async () => {
    const config = buildConfig()
    if (config == null) return
    setSaving(true)
    setPanelError('')
    try {
      const name = draft.name.trim()
      const configJson = JSON.stringify(config)
      if (draft.mode === 'edit' && draft.id) {
        await updateMcp({ id: draft.id, name, configJson, enabled: draft.enabled })
      } else {
        await createMcp({ name, scope: draft.scope, configJson, enabled: draft.enabled })
      }
      setDraft(EMPTY_DRAFT)
      refresh()
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : '保存 MCP 服务器失败')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (item: McpServerItem) => {
    try {
      await updateMcp({ id: item.id, enabled: !item.enabled })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换状态失败')
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await requestConfirm({
      title: '删除 MCP 服务器？',
      description: '删除后该 MCP 配置会从本地移除，相关工具将不再可用。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    await deleteMcp({ id })
    refresh()
  }

  const isPanelOpen = draft.mode !== null

  return (
    <div className="view-body">
      <div className="page">
        <div className="row section-header-row">
          <div className="flex1">
            <div className="strong header-title-lg">MCP 服务器</div>
            <div className="muted header-desc">
              {servers.length} 个服务器 · {totalTools} 个工具 · 配置保存在本地 SQLite
            </div>
          </div>
          <SparkSearchInput value={query} onChange={(v) => setQuery(v)} placeholder="搜索服务器或工具..." />
          <button className="btn" onClick={refresh}>
            <Icons.Refresh size={12} /> 刷新
          </button>
          <button className="btn primary" onClick={openCreate}>
            <Icons.Plus size={12} /> 添加 MCP
          </button>
        </div>

        <div className="row row-gap-sm mb-14">
          <span className="badge primary dot">全部 {mappedServers.length}</span>
          <span className="badge success dot">在线 {onlineCount}</span>
          <span className="badge warning dot">需注意 {warnCount}</span>
          <span className="badge danger dot">错误 {errorCount}</span>
          <span className="badge">未启用 {offCount}</span>
          <div className="flex1" />
          <div className="seg-control">
            <button className={scopeFilter === 'all' ? 'active' : ''} onClick={() => setScopeFilter('all')}>
              所有作用域
            </button>
            {SCOPES.map((scope) => (
              <button
                key={scope}
                className={scopeFilter === scope ? 'active' : ''}
                onClick={() => setScopeFilter(scope)}
              >
                {scope.slice(0, 1).toUpperCase() + scope.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="card card-error">{error}</div>}

        <div className="mcp-grid">
          {loading && <div className="card loading-card">正在加载 MCP 服务器...</div>}
          {!loading && filteredServers.length === 0 && (
            <div className="card mcp-empty">
              <Icons.Server size={28} />
              <div className="mcp-empty-title">暂无 MCP 服务器</div>
              <div className="muted">点击右上角"添加 MCP"创建第一个服务器</div>
            </div>
          )}
          {!loading &&
            filteredServers.map((server) => {
              const item = servers.find((candidate) => candidate.id === server.id)
              if (item == null) return null
              return (
                <MCPCard
                  key={server.id}
                  server={server}
                  onToggle={() => void handleToggle(item)}
                  onDelete={() => void handleDelete(server.id)}
                  onEdit={() => openEdit(item)}
                />
              )
            })}
        </div>
      </div>

      {isPanelOpen && (
        <McpEditPanel
          draft={draft}
          saving={saving}
          error={panelError}
          onPatch={patch}
          onClose={closePanel}
          onSave={() => void handleSave()}
        />
      )}
    </div>
  )
}

function MCPCard({
  server,
  onToggle,
  onDelete,
  onEdit,
}: {
  server: Server
  onToggle: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  const statMap: Record<ServerStatus, { dot: ReactNode; label?: string }> = {
    ok: { dot: <span className="dot-indicator green" />, ...(server.latency !== undefined && { label: server.latency }) },
    warn: { dot: <span className="dot-indicator yellow" />, ...(server.detail !== undefined && { label: server.detail }) },
    err: { dot: <span className="dot-indicator red" />, ...(server.detail !== undefined && { label: server.detail }) },
    off: { dot: <span className="dot-indicator" />, ...(server.detail !== undefined && { label: server.detail }) },
  }
  const stat = statMap[server.status]
  return (
    <div className="mcp-card">
      <div className="mcp-card-h">
        <div className="mcp-card-icon">{server.logo}</div>
        <div className="mcp-card-meta">
          <div className="row row-gap-xs">
            <span className="name">{server.name}</span>
            <span className="badge badge-font-sm">{server.scope}</span>
          </div>
          <div className="scope">
            {server.transport} · {server.tools} tools
          </div>
        </div>
        <div className={`switch ${server.status !== 'off' ? 'on' : ''}`} onClick={onToggle} />
      </div>
      <div className="mcp-card-desc">{server.desc}</div>
      <div className="mcp-card-foot">
        {stat.dot}
        <span className="muted truncate mcp-foot-label">{stat.label}</span>
        <span className="badge">
          <Icons.Wrench size={10} /> {server.tools}
        </span>
        <button className="icon-btn mcp-card-action" title="编辑" onClick={onEdit}>
          <Icons.Edit size={11} />
        </button>
        <button className="icon-btn delete-btn-sm" title="删除" onClick={onDelete}>
          <Icons.Trash size={11} />
        </button>
      </div>
    </div>
  )
}

function McpEditPanel({
  draft,
  saving,
  error,
  onPatch,
  onClose,
  onSave,
}: {
  draft: DraftState
  saving: boolean
  error: string
  onPatch: (patch: Partial<DraftState>) => void
  onClose: () => void
  onSave: () => void
}) {
  const isStdio = draft.transport === 'stdio'
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  return (
    <div className="slide-panel-backdrop" onClick={onClose}>
      <div className="slide-panel mcp-edit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="slide-panel-h">
          <div className="h-icon">
            <Icons.Server size={16} />
          </div>
          <div className="flex1">
            <div className="h-title">
              {draft.mode === 'edit' ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
            </div>
            <div className="h-sub">
              <span className="mcp-edit-mode-pill">{draft.transport.toUpperCase()}</span>
              <span className="dot" />
              作用域 {draft.scope}
              <span className="dot" />
              {isStdio ? '本地子进程' : '远程端点'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭" disabled={saving}>
            <Icons.X size={14} />
          </button>
        </div>

        <div className="slide-panel-body">
          {error && (
            <div className="alert-banner" role="alert">
              <span className="alert-banner-icon">
                <Icons.AlertTriangle size={14} />
              </span>
              <span className="alert-banner-content">{error}</span>
            </div>
          )}

          <div className="subsec-h subsec-h-no-mt">基础信息</div>
          <div className="form-grid">
            <label>名称</label>
            <SparkInput
              value={draft.name}
              onChange={(event) => onPatch({ name: event.target.value })}
              placeholder="例：filesystem"
              autoFocus
            />

            <label>作用域</label>
            <SparkSelect
              value={draft.scope}
              disabled={draft.mode === 'edit'}
              onChange={(event) => onPatch({ scope: event.target.value })}
            >
              {SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </SparkSelect>

            <label>传输方式</label>
            <SparkSelect
              value={draft.transport}
              onChange={(event) => onPatch({ transport: event.target.value as Transport })}
            >
              <option value="stdio">stdio · 本地子进程</option>
              <option value="http">http · 远程 HTTP</option>
              <option value="sse">sse · Server-Sent Events</option>
            </SparkSelect>

            <label>描述</label>
            <SparkInput
              value={draft.description}
              onChange={(event) => onPatch({ description: event.target.value })}
              placeholder="一句话说明这个 MCP 提供什么能力（可选）"
            />
          </div>

          <div className="subsec-h">
            <span className="icon">
              {isStdio ? <Icons.Terminal size={11} /> : <Icons.Globe size={11} />}
            </span>
            {isStdio ? '启动配置' : '端点配置'}
          </div>

          {isStdio ? (
            <>
              <div className="form-grid">
                <label>
                  启动命令 <span className="mcp-required">*</span>
                </label>
                <SparkInput
                  className="mono-sm"
                  value={draft.command}
                  onChange={(event) => onPatch({ command: event.target.value })}
                  placeholder="例：npx -y @modelcontextprotocol/server-filesystem"
                />
              </div>
              <div className="mcp-field-block">
                <label className="mcp-field-label">
                  参数
                  <span className="mcp-field-hint">每行一个，按顺序追加到启动命令后</span>
                </label>
                <SparkTextarea
                  className="mono-sm"
                  value={draft.argsText}
                  onChange={(event) => onPatch({ argsText: event.target.value })}
                  placeholder={'例：\n/Users/me/Documents\n--read-only'}
                  rows={3}
                />
              </div>
              <div className="mcp-field-block">
                <label className="mcp-field-label">
                  环境变量
                  <span className="mcp-field-hint">每行一个，格式 KEY=VALUE 或 KEY: VALUE</span>
                </label>
                <SparkTextarea
                  className="mono-sm"
                  value={draft.envText}
                  onChange={(event) => onPatch({ envText: event.target.value })}
                  placeholder={'例：\nAPI_BASE=https://api.example.com\nLOG_LEVEL=debug'}
                  rows={3}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  URL <span className="mcp-required">*</span>
                </label>
                <SparkInput
                  className="mono-sm"
                  value={draft.url}
                  onChange={(event) => onPatch({ url: event.target.value })}
                  placeholder={
                    draft.transport === 'http' ? 'https://mcp.example.com/mcp' : 'https://mcp.example.com/sse'
                  }
                />
              </div>
              <div className="mcp-field-block">
                <label className="mcp-field-label">
                  请求头
                  <span className="mcp-field-hint">每行一个，格式 Key: Value 或 Key=Value（可选）</span>
                </label>
                <SparkTextarea
                  className="mono-sm"
                  value={draft.headersText}
                  onChange={(event) => onPatch({ headersText: event.target.value })}
                  placeholder={'例：\nAuthorization: Bearer xxx\nX-Client: spark'}
                  rows={3}
                />
              </div>
            </>
          )}

          <div className="mcp-enabled-row">
            <SparkCheckbox
              checked={draft.enabled}
              onChange={(event) => onPatch({ enabled: event.target.checked })}
            />
            <div className="mcp-enabled-meta">
              <div className="strong">启用此 MCP 服务器</div>
              <div className="muted mcp-field-hint">关闭后 Agent 调用将不再加载该 MCP 的工具</div>
            </div>
          </div>
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn primary" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : draft.mode === 'edit' ? '保存修改' : '添加服务器'}
          </button>
        </div>
      </div>
    </div>
  )
}
