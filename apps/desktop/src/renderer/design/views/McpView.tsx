/**
 * McpView — MCP 服务器列表
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { McpServerItem } from '@spark/protocol'
import { Icons } from '../Icons'
import { SparkInput, SparkSelect } from '../components/FormControls'
import { useIpcInvoke } from '../hooks/useIpc'
import { useApp } from '../AppContext'

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

type McpDraft = {
  name: string
  scope: string
  transport: 'stdio' | 'http' | 'sse'
  command: string
  url: string
}

const SCOPES = ['system', 'user', 'project', 'team', 'session']

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
    desc: config.description ?? `${transport} · ${endpoint ?? '未配置启动信息'}`,
    tools,
    transport,
    status,
    ...(status === 'ok' ? { latency: '本地配置' } : {}),
    ...(status === 'warn' ? { detail: '配置不完整' } : {}),
    ...(status === 'off' ? { detail: '未启用' } : {}),
  }
}

export function McpView() {
  const { requestConfirm } = useApp()
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<McpDraft>({ name: '', scope: 'user', transport: 'stdio', command: '', url: '' })
  const [error, setError] = useState('')

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
    return [server.name, server.scope, server.desc, server.transport].some((value) => value.toLowerCase().includes(keyword))
  })

  const onlineCount = mappedServers.filter((server) => server.status === 'ok').length
  const warnCount = mappedServers.filter((server) => server.status === 'warn').length
  const errorCount = mappedServers.filter((server) => server.status === 'err').length
  const offCount = mappedServers.filter((server) => server.status === 'off').length
  const totalTools = mappedServers.reduce((sum, server) => sum + server.tools, 0)

  const resetDraft = () => {
    setDraft({ name: '', scope: 'user', transport: 'stdio', command: '', url: '' })
    setShowForm(false)
  }

  const handleCreate = async () => {
    const name = draft.name.trim()
    const command = draft.command.trim()
    const url = draft.url.trim()
    if (name.length === 0) {
      setError('名称不能为空')
      return
    }
    if (draft.transport === 'stdio' && command.length === 0) {
      setError('stdio 服务器需要填写启动命令')
      return
    }
    if (draft.transport !== 'stdio' && url.length === 0) {
      setError('HTTP/SSE 服务器需要填写 URL')
      return
    }

    const config: McpConfig = {
      transport: draft.transport,
      tools: [],
      ...(draft.transport === 'stdio' ? { command } : { url }),
    }
    await createMcp({
      name,
      scope: draft.scope,
      configJson: JSON.stringify(config),
      enabled: true,
    })
    resetDraft()
    refresh()
  }

  const handleToggle = async (item: McpServerItem) => {
    await updateMcp({ id: item.id, enabled: !item.enabled })
    refresh()
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

  return (
    <div className="view-body">
    <div className="page">
      <div className="row section-header-row">
        <div className="flex1">
          <div className="strong header-title-lg">MCP 服务器</div>
          <div className="muted header-desc">{servers.length} 个服务器 · {totalTools} 个工具 · 配置保存在本地 SQLite</div>
        </div>
        <div className="search-input"><Icons.Search /><SparkInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索服务器或工具..." /></div>
        <button className="btn" onClick={refresh}><Icons.Refresh size={12} /> 刷新</button>
        <button className="btn primary" onClick={() => setShowForm(true)}><Icons.Plus size={12} /> 添加 MCP</button>
      </div>

      <div className="row row-gap-sm mb-14">
        <span className="badge primary dot">全部 {mappedServers.length}</span>
        <span className="badge success dot">在线 {onlineCount}</span>
        <span className="badge warning dot">需注意 {warnCount}</span>
        <span className="badge danger dot">错误 {errorCount}</span>
        <span className="badge">未启用 {offCount}</span>
        <div className="flex1" />
        <div className="seg-control">
          <button className={scopeFilter === 'all' ? 'active' : ''} onClick={() => setScopeFilter('all')}>所有作用域</button>
          {SCOPES.map((scope) => (
            <button key={scope} className={scopeFilter === scope ? 'active' : ''} onClick={() => setScopeFilter(scope)}>
              {scope.slice(0, 1).toUpperCase() + scope.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card card-error">
          {error}
        </div>
      )}

      {showForm && (
        <div className="card mcp-add-card">
          <div className="subsec-h subsec-h-no-mt">添加 MCP 服务器</div>
          <div className="form-grid">
            <label>名称</label>
            <SparkInput value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="例：filesystem" />

            <label>作用域</label>
            <SparkSelect value={draft.scope} onChange={(event) => setDraft((prev) => ({ ...prev, scope: event.target.value }))}>
              {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </SparkSelect>

            <label>传输</label>
            <SparkSelect value={draft.transport} onChange={(event) => setDraft((prev) => ({ ...prev, transport: event.target.value as McpDraft['transport'] }))}>
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </SparkSelect>

            <label>{draft.transport === 'stdio' ? '启动命令' : 'URL'}</label>
            <SparkInput
              className="mono-sm"
              value={draft.transport === 'stdio' ? draft.command : draft.url}
              onChange={(event) => {
                const value = event.target.value
                setDraft((prev) => draft.transport === 'stdio' ? { ...prev, command: value } : { ...prev, url: value })
              }}
              placeholder={draft.transport === 'stdio' ? 'npx -y @modelcontextprotocol/server-filesystem .' : 'https://mcp.example.com/sse'}
            />
          </div>
          <div className="row form-row-mt">
            <button className="btn primary sm" onClick={() => void handleCreate()}><Icons.Plus size={11} /> 添加</button>
            <button className="btn ghost sm" onClick={resetDraft}>取消</button>
          </div>
        </div>
      )}

      <div className="mcp-grid">
        {loading && <div className="card loading-card">正在加载 MCP 服务器...</div>}
        {!loading && filteredServers.length === 0 && (
          <div className="card empty-state">
            暂无 MCP 服务器
          </div>
        )}
        {!loading && filteredServers.map((server) => {
          const item = servers.find((candidate) => candidate.id === server.id)
          if (item == null) return null
          return (
            <MCPCard
              key={server.id}
              server={server}
              onToggle={() => void handleToggle(item)}
              onDelete={() => void handleDelete(server.id)}
            />
          )
        })}
      </div>
    </div>
    </div>
  )
}

function MCPCard({ server, onToggle, onDelete }: { server: Server; onToggle: () => void; onDelete: () => void }) {
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
          <div className="scope">{server.transport} · {server.tools} tools</div>
        </div>
        <div className={`switch ${server.status !== 'off' ? 'on' : ''}`} onClick={onToggle} />
      </div>
      <div className="mcp-card-desc">{server.desc}</div>
      <div className="mcp-card-foot">
        {stat.dot}
        <span className="muted truncate muted-font-sm">{stat.label}</span>
        <span className="badge"><Icons.Wrench size={10} /> {server.tools}</span>
        <button className="icon-btn delete-btn-sm" title="删除" onClick={onDelete}>
          <Icons.Trash size={11} />
        </button>
      </div>
    </div>
  )
}
