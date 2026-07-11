/**
 * MemoryPanel — 长期记忆管理面板（V2）
 *
 * 三个区块：列表（scope/type/失效过滤）、详情/编辑 Drawer、新增 Drawer、配置 Drawer。
 * memory 配置走 settings:get/set；CRUD 走 memory:* IPC。子组件各自 useIpcInvoke 拿 typed invoke。
 * 仅 LobeHub + antd 组件，样式落 MemoryPanel.less（mp_ 前缀）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Tag, Tooltip, Drawer, Empty, Input as LobeInput, Select as LobeSelect, TextArea } from '@lobehub/ui'
import { Switch, message, Modal, Segmented, Spin, Checkbox } from 'antd'
import { Icons } from '../Icons'
import type { MemoryEntry, MemoryScope, MemoryType, ProviderProfile, ManagedAgent } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useSessionSidebar } from '../SessionSidebarContext'
import './MemoryPanel.less'

type ScopeFilter = 'user' | 'project' | 'agent'
type TypeFilter = 'all' | MemoryType

const TYPE_OPTIONS: Array<{ label: string; value: TypeFilter }> = [
  { label: '全部类型', value: 'all' },
  { label: 'User', value: 'user' },
  { label: 'Feedback', value: 'feedback' },
  { label: 'Project', value: 'project' },
  { label: 'Reference', value: 'reference' },
]

export function MemoryPanel() {
  const { invoke: listMemory } = useIpcInvoke('memory:list')
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  // 从 sidebar context 拿当前项目/会话，让 project/agent scope 默认绑当前上下文
  // （用户不用手填 UUID —— 这是"写入成功但面板看不到"的 UX 根因）
  const { workspaces, activeWorkspaceId, sessions, activeSessionId } = useSessionSidebar()
  // 从活跃会话推导当前 agentId（agent scope 默认选它）
  const activeAgentId = useMemo(() => {
    if (activeSessionId == null) return null
    return sessions.find((s) => s.id === activeSessionId)?.agentId ?? null
  }, [sessions, activeSessionId])
  const getContextScopeRef = useCallback((next: ScopeFilter): string => {
    if (next === 'project') return activeWorkspaceId ?? ''
    if (next === 'agent') return activeAgentId ?? ''
    return ''
  }, [activeWorkspaceId, activeAgentId])
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  useEffect(() => {
    void listAgents({}).then((r) => setAgents(r?.agents ?? [])).catch(() => {})
  }, [listAgents])
  const [scope, setScope] = useState<ScopeFilter>('user')
  const [scopeRef, setScopeRef] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [includeInvalid, setIncludeInvalid] = useState(false)
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  // 前端文本搜索（按 name/description 模糊匹配）
  const [searchText, setSearchText] = useState('')
  const switchScope = useCallback((next: ScopeFilter) => {
    setScope(next)
    // 列表筛选改为"未选 project/agent 时查该 scope 全部"；
    // 当前上下文仅保留给手动新增抽屉作为默认值，不再强制塞进筛选条件。
    setScopeRef('')
    setScopeRefInput('')
  }, [])
  // workspaces → Select options（project scope 用）
  const workspaceOptions = useMemo(
    () => workspaces.map((w) => ({ label: w.name || w.id, value: w.id })),
    [workspaces],
  )
  // agents → Select options（agent scope 用，仅启用项）
  const agentOptions = useMemo(
    () => agents.filter((a) => a.enabled).map((a) => ({ label: a.name || a.id, value: a.id })),
    [agents],
  )
  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (q === '') return entries
    return entries.filter((e) =>
      e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    )
  }, [entries, searchText])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 多选 + 批量操作（审查诉求：批量移除/归档）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { invoke: deleteMemory } = useIpcInvoke('memory:delete')
  const { invoke: archiveMemory } = useIpcInvoke('memory:archive')
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // 全选当前过滤后可见的条目（非全库，避免误删搜索外的）
  const visibleIds = useMemo(() => filteredEntries.map((e) => e.id), [filteredEntries])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }, [allSelected, visibleIds])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  // 切 scope/过滤维度时清空选择，避免跨批次误操作
  useEffect(() => { clearSelection() }, [scope, scopeRef, typeFilter, includeInvalid, clearSelection])
  const batchDelete = async () => {
    const ids = [...selectedIds]
    Modal.confirm({
      title: `批量删除 ${ids.length} 条记忆？`,
      okType: 'danger',
      content: '删除后不可恢复（含 markdown 文件与索引）。归档比删除安全，建议优先归档。',
      onOk: async () => {
        let ok = 0
        for (const id of ids) {
          try { await deleteMemory({ id }); ok++ } catch { /* 单条失败不阻断，继续删下一条 */ }
        }
        message.success(`已删除 ${ok}/${ids.length} 条`)
        clearSelection()
        void refreshFn()
      },
    })
  }
  const batchArchive = async () => {
    const ids = [...selectedIds]
    let ok = 0
    for (const id of ids) {
      try { await archiveMemory({ id }); ok++ } catch { /* 单条失败不阻断 */ }
    }
    message.success(`已归档 ${ok}/${ids.length} 条`)
    clearSelection()
    void refreshFn()
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const ref = scope === 'user' ? null : scopeRef.trim() || null
      const res = await listMemory({
        scope,
        scopeRef: ref,
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
        includeInvalid,
      })
      setEntries(res?.entries ?? [])
    } catch (err) {
      message.error(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [listMemory, scope, scopeRef, typeFilter, includeInvalid])

  const refreshFn = useRefreshable(refresh)
  // scopeRef 输入 debounce 300ms，避免每字符触发请求
  const [scopeRefInput, setScopeRefInput] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setScopeRef(scopeRefInput), 300)
    return () => clearTimeout(t)
  }, [scopeRefInput])
  const createDefaultScopeRef = scopeRef || getContextScopeRef(scope)
  // 初始加载 + 任一过滤维度变化自动刷新（refresh 是 useCallback，依赖 scope/scopeRef/typeFilter/includeInvalid）
  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="mp_root">
      <header className="mp_header">
        <div className="mp_title">
          <Icons.Brain size={18} />
          <span>长期记忆</span>
          <Tag size="middle">{entries.length}</Tag>
        </div>
        <div className="mp_actions">
          <Tooltip title="刷新">
            <Button icon={<Icons.History size={16} />} onClick={refreshFn} loading={loading}>
              刷新
            </Button>
          </Tooltip>
          <Button icon={<Icons.Sparkles size={16} />} onClick={() => setCreateOpen(true)}>新增</Button>
          <Button onClick={() => setSettingsOpen(true)}>配置</Button>
        </div>
      </header>

      <div className="mp_toolbar">
        <Segmented
          value={scope}
          onChange={(v) => switchScope(v as ScopeFilter)}
          options={[
            { label: 'User（跨项目）', value: 'user' },
            { label: 'Project', value: 'project' },
            { label: 'Agent', value: 'agent' },
          ]}
        />
        {scope === 'project' && (
          <LobeSelect
            value={scopeRefInput || undefined}
            onChange={(v) => setScopeRefInput((v as string) ?? '')}
            options={workspaceOptions}
            placeholder="选择项目（不选则全部）"
            style={{ width: 240 }}
            allowClear
            showSearch
          />
        )}
        {scope === 'agent' && (
          <LobeSelect
            value={scopeRefInput || undefined}
            onChange={(v) => setScopeRefInput((v as string) ?? '')}
            options={agentOptions}
            placeholder="选择 Agent（不选则全部）"
            style={{ width: 240 }}
            allowClear
            showSearch
          />
        )}
        <LobeSelect value={typeFilter} onChange={(v) => setTypeFilter((v as TypeFilter) ?? 'all')} options={TYPE_OPTIONS} style={{ width: 140 }} allowClear />
        <Segmented
          value={includeInvalid ? 'with-invalid' : 'active-only'}
          onChange={(v) => setIncludeInvalid(v === 'with-invalid')}
          options={[{ label: '仅有效', value: 'active-only' }, { label: '含失效', value: 'with-invalid' }]}
        />
        <LobeInput
          value={searchText}
          onChange={(e) => setSearchText((e.target as HTMLInputElement).value)}
          placeholder="搜索 name / description"
          style={{ width: 220, marginLeft: 'auto' }}
          allowClear
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="mp_batch_bar">
          <span>已选 {selectedIds.size} 条</span>
          <Button size="middle" onClick={batchArchive}>批量归档</Button>
          <Button size="middle" danger onClick={batchDelete}>批量删除</Button>
          <Button size="middle" type="link" onClick={clearSelection}>取消选择</Button>
        </div>
      )}

      <div className="mp_list">
        {loading ? (
          <div className="mp_list_loading"><Spin /></div>
        ) : filteredEntries.length === 0 ? (
          <Empty description={searchText.trim() ? '无匹配记忆' : '暂无记忆'} />
        ) : (
          <>
            <div className="mp_list_header">
              <Checkbox checked={allSelected} onChange={toggleSelectAll}>
                全选（当前 {visibleIds.length} 条）
              </Checkbox>
            </div>
            {filteredEntries.map((e) => (
              <MemoryRow
                key={e.id}
                entry={e}
                selected={selectedIds.has(e.id)}
                onToggleSelect={() => toggleSelect(e.id)}
                onOpen={() => setDetailId(e.id)}
              />
            ))}
          </>
        )}
      </div>

      <Drawer open={detailId != null} onClose={() => setDetailId(null)} title="记忆详情" width={560} destroyOnHidden>
        {detailId != null && <MemoryDetail id={detailId} onArchivedOrDeleted={() => { setDetailId(null); void refreshFn() }} onSaved={refreshFn} />}
      </Drawer>
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="手动新增记忆" width={520} destroyOnHidden>
        <MemoryCreate defaultScope={scope} defaultScopeRef={createDefaultScopeRef} onDone={() => { setCreateOpen(false); void refreshFn() }} />
      </Drawer>
      <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title="记忆系统配置" width={560} destroyOnHidden>
        <MemorySettings />
      </Drawer>
    </div>
  )
}

function typeColor(type: MemoryType): string {
  switch (type) {
    case 'feedback': return 'orange'
    case 'user': return 'blue'
    case 'project': return 'green'
    case 'reference': return 'default'
  }
}

function MemoryRow({ entry: e, selected, onToggleSelect, onOpen }: {
  entry: MemoryEntry
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const invalid = e.invalidAt != null
  const isConsolidation = e.sourceSessionId === 'consolidation'
  // scopeRef 截断显示（project/agent scope 列出全部时，让用户能区分各条属于哪个项目/agent）
  const refTail = e.scopeRef != null && e.scopeRef.length > 8 ? e.scopeRef.slice(-8) : e.scopeRef
  return (
    <div className={`mp_row${invalid ? ' mp_row_invalid' : ''}${selected ? ' mp_row_selected' : ''}`}>
      <Checkbox checked={selected} onChange={onToggleSelect} onClick={(ev) => ev.stopPropagation()} />
      <div className="mp_row_main" onClick={onOpen}>
        <div className="mp_row_title">
          <span className="mp_row_name">{e.name}</span>
          <Tag size="middle" color={typeColor(e.type)}>{e.type}</Tag>
          {e.scopeRef != null && <Tag size="middle" color="cyan">…{refTail}</Tag>}
          {invalid && <Tag size="middle" color="red">失效</Tag>}
          {isConsolidation && <Tag size="middle" color="purple">整合</Tag>}
          {e.archived && <Tag size="middle">归档</Tag>}
        </div>
        <div className="mp_row_desc">{e.description}</div>
      </div>
      <div className="mp_row_meta">
        {/* <span>命中 {e.hitCount}</span> */}
        <span>{new Date(e.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function MemoryDetail({ id, onSaved, onArchivedOrDeleted }: { id: string; onSaved: () => void; onArchivedOrDeleted: () => void }) {
  const { invoke: getMemory } = useIpcInvoke('memory:get')
  const { invoke: updateMemory } = useIpcInvoke('memory:update')
  const { invoke: archiveMemory } = useIpcInvoke('memory:archive')
  const { invoke: deleteMemory } = useIpcInvoke('memory:delete')
  const [entry, setEntry] = useState<MemoryEntry | null>(null)
  const [body, setBody] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await getMemory({ id })
    setEntry(res?.entry ?? null)
    setBody(res?.body ?? '')
    setDesc(res?.entry?.description ?? '')
  }, [getMemory, id])
  useEffect(() => { void load() }, [load])

  if (entry == null) return <div className="mp_list_loading"><Spin /></div>

  const save = async () => {
    setSaving(true)
    try {
      const patch: { description?: string; body?: string } = {}
      if (desc !== entry.description) patch.description = desc
      // body 与当前磁盘版本对比
      const cur = await getMemory({ id })
      if (body !== (cur.body ?? '')) patch.body = body
      if (Object.keys(patch).length === 0) { message.info('无变更'); return }
      await updateMemory({ id, ...patch })
      message.success('已保存')
      await load()
      onSaved()
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mp_detail">
      {entry.invalidAt != null && (
        <div className="mp_warn">
          此记忆已于 {new Date(entry.invalidAt).toLocaleString()} 失效{entry.supersededBy != null ? `，已被 ${entry.supersededBy} 取代` : ''}。仅作历史参考。
        </div>
      )}
      <div className="mp_field">
        <label>描述</label>
        <LobeInput value={desc} onChange={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </div>
      <div className="mp_field">
        <label>正文（markdown）</label>
        <TextArea value={body} onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)} rows={14} />
      </div>
      <div className="mp_meta_grid">
        <span>ID: {entry.id}</span>
        <span>scope: {entry.scope}/{entry.scopeRef ?? '∅'}</span>
        <span>类型: {entry.type}</span>
        <span>置信度: {entry.confidence}</span>
        <span>命中: {entry.hitCount}</span>
        <span>来源: {entry.sourceSessionId ?? '手工/对话'}</span>
        <span>创建: {new Date(entry.createdAt).toLocaleString()}</span>
        <span>更新: {new Date(entry.updatedAt).toLocaleString()}</span>
      </div>
      <div className="mp_detail_actions">
        <Button type="primary" onClick={save} loading={saving}>保存</Button>
        <Button onClick={async () => { await archiveMemory({ id }); message.success('已归档'); onArchivedOrDeleted() }}>归档</Button>
        <Button danger onClick={() => Modal.confirm({
          title: '永久删除该记忆？', okType: 'danger',
          content: '删除后不可恢复（含 markdown 文件与索引）。',
          onOk: async () => { await deleteMemory({ id }); message.success('已删除'); onArchivedOrDeleted() },
        })}>删除</Button>
      </div>
    </div>
  )
}

function MemoryCreate({ defaultScope, defaultScopeRef, onDone }: { defaultScope: ScopeFilter; defaultScopeRef: string; onDone: () => void }) {
  const { invoke: createMemory } = useIpcInvoke('memory:create')
  const [cScope, setCScope] = useState<MemoryScope>(defaultScope)
  const [cScopeRef, setCScopeRef] = useState(defaultScopeRef)
  const [type, setType] = useState<MemoryType>('feedback')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [body, setBody] = useState('')
  const [entities, setEntities] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim() || !desc.trim()) { message.warning('name 与 description 必填'); return }
    setSaving(true)
    try {
      const ents = entities.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
      await createMemory({
        scope: cScope, scopeRef: cScope === 'user' ? null : cScopeRef.trim() || null, type,
        name: name.trim(), description: desc.trim(), body,
        ...(ents.length > 0 ? { entities: ents } : {}),
      })
      message.success('已新增')
      onDone()
    } catch (err) {
      message.error(`新增失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mp_create">
      <div className="mp_field">
        <label>层级 scope</label>
        <Segmented value={cScope} onChange={(v) => setCScope(v as MemoryScope)} options={[{ label: 'User', value: 'user' }, { label: 'Project', value: 'project' }, { label: 'Agent', value: 'agent' }]} />
      </div>
      {cScope !== 'user' && (
        <div className="mp_field">
          <label>{cScope === 'project' ? 'workspaceId' : 'agentId'}</label>
          <LobeInput value={cScopeRef} onChange={(e) => setCScopeRef((e.target as HTMLInputElement).value)} />
        </div>
      )}
      <div className="mp_field">
        <label>type</label>
        <Segmented value={type} onChange={(v) => setType(v as MemoryType)} options={[{ label: 'User', value: 'user' }, { label: 'Feedback', value: 'feedback' }, { label: 'Project', value: 'project' }, { label: 'Reference', value: 'reference' }]} />
      </div>
      <div className="mp_field">
        <label>name（kebab-case，scope 内唯一）</label>
        <LobeInput value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder="如 prefer-arco-over-radix" />
      </div>
      <div className="mp_field">
        <label>description（≤80 字）</label>
        <LobeInput value={desc} onChange={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </div>
      <div className="mp_field">
        <label>正文 body（markdown，feedback/project 建议含 Why / How to apply）</label>
        <TextArea value={body} onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)} rows={6} />
      </div>
      <div className="mp_field">
        <label>实体（逗号分隔，可选）</label>
        <LobeInput value={entities} onChange={(e) => setEntities((e.target as HTMLInputElement).value)} placeholder="如 Arco Design, vite, React" />
      </div>
      <Button type="primary" onClick={submit} loading={saving}>创建</Button>
    </div>
  )
}

function MemorySettings() {
  const { invoke: settingsSet } = useIpcInvoke('settings:set')
  const { invoke: settingsGetCategory } = useIpcInvoke('settings:get-category')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: rebuildVectors } = useIpcInvoke('memory:rebuild-vectors')
  const { invoke: testExtraction } = useIpcInvoke('memory:test-extraction')
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [rebuilding, setRebuilding] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void settingsGetCategory({ category: 'memory' }).then((r) => setCfg(r?.settings ?? {}))
    void listProviders({}).then((r) => setProviders(r?.profiles ?? [])).catch(() => {})
  }, [settingsGetCategory, listProviders])

  const getStr = (k: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '')
  const getNum = (k: string) => (typeof cfg[k] === 'number' ? String(cfg[k]) : '')
  const getBool = (k: string, dflt: boolean) => (typeof cfg[k] === 'boolean' ? (cfg[k] as boolean) : dflt)
  const set = (k: string, v: unknown) => {
    // 空字符串 / null / undefined 统一视为"未设置"：本地状态移除该 key，
    // IPC 发送 value=null 触发后端 repo.delete()。这样 Provider 下拉清除、
    // 模型名输入框清空、数字框清空都能回到"未配置"语义（触发 agent 对话模型回退 / 默认值）。
    const isBlank = v === '' || v === null || v === undefined
    setCfg((c) => {
      const next = { ...c }
      if (isBlank) delete next[k]
      else next[k] = v
      return next
    })
    void settingsSet({ category: 'memory', key: k, value: isBlank ? null : v })
  }
  // 抽取支持 anthropic 原生 + OpenAI 兼容；embedding 仅 OpenAI 兼容。
  // provider_type 不在 IPC DTO 上，按 provider 字符串识别 anthropic。
  const isAnthropicProvider = (p: ProviderProfile): boolean =>
    p.provider.toLowerCase() === 'anthropic'
  const isOpenAICompatibleProvider = (p: ProviderProfile): boolean =>
    p.provider.toLowerCase() !== 'anthropic'
  // 抽取 provider 过滤（保持原逻辑不动）：排除 responses API（不支持 /chat/completions）+
  // 纯多媒体（image/voice/video 无 chat 能力）。embedding 专用 provider 也排除（不做 chat）。
  const isResponsesApiProvider = (p: ProviderProfile): boolean =>
    (p as ProviderProfile & { codexApiKind?: string }).codexApiKind === 'responses'
  const isEmbeddingOnlyProvider = (p: ProviderProfile): boolean =>
    (p as ProviderProfile & { codexApiKind?: string }).codexApiKind === 'embedding'
  const isMultimediaProvider = (p: ProviderProfile): boolean => {
    const t = (p as ProviderProfile & { modelType?: string }).modelType
    return t === 'image' || t === 'voice' || t === 'video'
  }
  const extractionProviderOptions = useMemo(
    () => providers
      .filter((p) => !isResponsesApiProvider(p) && !isEmbeddingOnlyProvider(p) && !isMultimediaProvider(p))
      .map((p) => ({ label: `${p.name}（${p.provider}${isAnthropicProvider(p) ? ' · 原生 /v1/messages' : ' · OpenAI兼容'}）`, value: p.id })),
    [providers],
  )
  // 向量 provider 必须显式声明 codexApiKind='embedding'（用户在 provider 编辑页选 Embeddings）。
  // 这样筛选准确：只有专门配的 embedding provider 出现，code1 那种"看着 chat 实际不支持 /v1/embeddings"
  // 的 provider 不会漏进来。anthropic 无 embedding 模型，天然排除。
  const isEmbeddingProvider = (p: ProviderProfile): boolean =>
    (p as ProviderProfile & { codexApiKind?: string }).codexApiKind === 'embedding'
  const embeddingProviderOptions = useMemo(
    () => providers
      .filter((p) => isOpenAICompatibleProvider(p) && isEmbeddingProvider(p))
      .map((p) => ({ label: `${p.name}（${p.provider} · Embeddings）`, value: p.id })),
    [providers],
  )
  // 选中 provider 的可用模型（从 provider:list 返回的 modelIds 生成）
  // 选 provider 后模型字段从 Input 升级为 Select；modelIds 为空时 fallback Input 兜底。
  const modelOptionsFor = (providerId: string): Array<{ label: string; value: string }> => {
    const p = providers.find((x) => x.id === providerId)
    if (p == null) return []
    return (p.modelIds ?? []).map((m) => ({ label: m, value: m }))
  }
  const extractionModelOptions = useMemo(
    () => modelOptionsFor(getStr('extractionProviderId')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, cfg.extractionProviderId],
  )
  const embeddingModelOptions = useMemo(
    () => modelOptionsFor(getStr('embeddingProviderId')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, cfg.embeddingProviderId],
  )
  // 选 provider 时，若当前 model 不在新 provider 的 modelIds 里，清空 model（防跨 provider 串味）
  const pickProvider = (key: 'extractionProviderId' | 'embeddingProviderId', providerId: string) => {
    const modelKey = key === 'extractionProviderId' ? 'extractionModel' : 'embeddingModel'
    const modelIds = providers.find((p) => p.id === providerId)?.modelIds ?? []
    const curModel = getStr(modelKey)
    set(key, providerId)
    if (curModel.length > 0 && !modelIds.includes(curModel)) {
      set(modelKey, null) // 当前 model 不属于新 provider，清空让用户重选
    }
  }

  return (
    <div className="mp_settings">
      <section className="mp_settings_section">
        <h4>总开关</h4>
        <div className="mp_settings_row"><span>启用长期记忆（关闭后注入/写入/整合全停）</span><Switch checked={getBool('enabled', true)} onChange={(v) => set('enabled', v)} /></div>
      </section>
      <section className="mp_settings_section">
        <h4>抽取模型<span className="mp_section_hint">（写入必需；支持 anthropic 原生 + OpenAI 兼容 /chat，不支持 responses API）</span></h4>
        <div className="mp_field"><label>Provider（可清除，清除后回退到对话模型）</label><LobeSelect value={getStr('extractionProviderId') || undefined} onChange={(v) => pickProvider('extractionProviderId', (v as string) ?? '')} options={extractionProviderOptions} placeholder="选择抽取 provider（anthropic 或 OpenAI 兼容）" allowClear showSearch /></div>
        <div className="mp_field">
          <label>模型名{extractionModelOptions.length > 0 ? '（从该 provider 可用模型选）' : '（该 provider 未预拉模型列表，手动填写）'}</label>
          {extractionModelOptions.length > 0 ? (
            <LobeSelect value={getStr('extractionModel') || undefined} onChange={(v) => set('extractionModel', (v as string) ?? '')} options={extractionModelOptions} placeholder="选择抽取模型" allowClear showSearch />
          ) : (
            <LobeInput value={getStr('extractionModel')} onChange={(e) => set('extractionModel', (e.target as HTMLInputElement).value)} placeholder="留空则回退到对话模型" />
          )}
        </div>
        <div className="mp_settings_hint_inline">未配置时自动回退到当前会话 / @mention agent 的对话模型（团队主持 agent 用会话默认模型）。</div>
        <Button loading={testing} onClick={async () => {
          setTesting(true)
          try {
            const r = await testExtraction({})
            if (r?.ok) {
              const via = r.source === 'fallback' ? '（回退到对话模型，settings 未配）' : `（settings 显式配置：${r.model ?? '?'}）`
              message.success(`抽取配置可用${via}${r.sample != null ? `，返回：${r.sample.slice(0, 50)}` : ''}`)
            } else {
              message.warning(`抽取配置不可用：${r?.reason ?? '未知'}${r?.source === 'none' ? '（settings 未配且无对话模型回退上下文；会话中实际使用时会回退）' : ''}`)
            }
          } catch (err) { message.error(`测试失败：${err instanceof Error ? err.message : String(err)}`) }
          finally { setTesting(false) }
        }}>测试抽取配置</Button>
      </section>
      <section className="mp_settings_section">
        <h4>向量模型<span className="mp_section_hint">（可选，不配则 FTS-only；仅 OpenAI 兼容 /chat 风格，不支持 anthropic 与 responses API）</span></h4>
        <div className="mp_field"><label>Provider（可清除）</label><LobeSelect value={getStr('embeddingProviderId') || undefined} onChange={(v) => pickProvider('embeddingProviderId', (v as string) ?? '')} options={embeddingProviderOptions} placeholder="选择 embedding provider" allowClear showSearch /></div>
        <div className="mp_field">
          <label>模型名{embeddingModelOptions.length > 0 ? '（从该 provider 可用模型选）' : '（该 provider 未预拉模型列表，手动填写，如 text-embedding-3-small）'}</label>
          {embeddingModelOptions.length > 0 ? (
            <LobeSelect value={getStr('embeddingModel') || undefined} onChange={(v) => set('embeddingModel', (v as string) ?? '')} options={embeddingModelOptions} placeholder="选择 embedding 模型" allowClear showSearch />
          ) : (
            <LobeInput value={getStr('embeddingModel')} onChange={(e) => set('embeddingModel', (e.target as HTMLInputElement).value)} placeholder="留空则 FTS-only" />
          )}
        </div>
        <Button loading={rebuilding} onClick={async () => {
          setRebuilding(true)
          try {
            const r = await rebuildVectors({})
            if (r?.ok) message.success('向量表已重建，后台正按新模型回填全部记忆（条目多时可能持续几分钟，期间向量检索会逐步恢复）。')
            else message.warning(`未重建：${r?.reason ?? '未知'}`)
          } catch (err) { message.error(`重建失败：${err instanceof Error ? err.message : String(err)}`) }
          finally { setRebuilding(false) }
        }}>重建向量索引</Button>
      </section>
      <section className="mp_settings_section">
        <h4>整合 job</h4>
        <div className="mp_settings_row"><span>启用整合</span><Switch checked={getBool('consolidationEnabled', true)} onChange={(v) => set('consolidationEnabled', v)} /></div>
        <div className="mp_field"><label>触发阈值（条数，默认 30；真机测试可设 2；留空用默认）</label><LobeInput value={getNum('consolidationThreshold')} onChange={(e) => { const raw = (e.target as HTMLInputElement).value; if (raw === '') { set('consolidationThreshold', null); return } const n = Number(raw); if (Number.isFinite(n)) set('consolidationThreshold', n) }} placeholder="留空用默认 30" /></div>
        <div className="mp_field"><label>触发间隔（天，默认 7；真机测试可设 0.01；留空用默认）</label><LobeInput value={getNum('consolidationIntervalDays')} onChange={(e) => { const raw = (e.target as HTMLInputElement).value; if (raw === '') { set('consolidationIntervalDays', null); return } const n = Number(raw); if (Number.isFinite(n)) set('consolidationIntervalDays', n) }} placeholder="留空用默认 7" /></div>
      </section>
      <section className="mp_settings_section">
        <h4>检索调参（高级）</h4>
        <div className="mp_field"><label>会话注入 token 上限（默认 4000；留空用默认）</label><LobeInput value={getNum('maxInjectTokens')} onChange={(e) => { const raw = (e.target as HTMLInputElement).value; if (raw === '') { set('maxInjectTokens', null); return } const n = Number(raw); if (Number.isFinite(n)) set('maxInjectTokens', n) }} placeholder="留空用默认 4000" /></div>
        <div className="mp_field"><label>时间衰减 λ（默认 0.01；越大旧记忆沉降越快；留空用默认）</label><LobeInput value={getNum('timeDecayLambda')} onChange={(e) => { const raw = (e.target as HTMLInputElement).value; if (raw === '') { set('timeDecayLambda', null); return } const n = Number(raw); if (Number.isFinite(n)) set('timeDecayLambda', n) }} placeholder="留空用默认 0.01" /></div>
      </section>
      <div className="mp_settings_hint">配置改完<b>下一个新会话生效</b>。抽取（extract）支持 <b>OpenAI 兼容 provider</b>（deepseek/openrouter/openai/自部署 vLLM）和 <b>anthropic 原生</b>（claude，provider_type=anthropic）；<b>未配置时自动回退</b>到当前会话 / @mention agent 的对话模型（团队主持 agent 用会话默认）。向量（embedding）仅支持 OpenAI 兼容（anthropic 本身不提供 embedding 模型）；不配向量则自动 FTS-only。</div>
    </div>
  )
}
