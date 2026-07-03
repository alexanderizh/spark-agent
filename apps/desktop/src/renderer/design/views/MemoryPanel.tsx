/**
 * MemoryPanel — 长期记忆管理面板（V2）
 *
 * 三个区块：列表（scope/type/失效过滤）、详情/编辑 Drawer、新增 Drawer、配置 Drawer。
 * memory 配置走 settings:get/set；CRUD 走 memory:* IPC。子组件各自 useIpcInvoke 拿 typed invoke。
 * 仅 LobeHub + antd 组件，样式落 MemoryPanel.less（mp_ 前缀）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Tag, Tooltip, Drawer, Empty, Input as LobeInput, Select as LobeSelect, TextArea } from '@lobehub/ui'
import { Switch, message, Modal, Segmented } from 'antd'
import { Icons } from '../Icons'
import type { MemoryEntry, MemoryScope, MemoryType, ProviderProfile } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
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
  const [scope, setScope] = useState<ScopeFilter>('user')
  const [scopeRef, setScopeRef] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [includeInvalid, setIncludeInvalid] = useState(false)
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  // 初始加载 + 任一过滤维度变化自动刷新（refresh 是 useCallback，依赖 scope/scopeRef/typeFilter/includeInvalid）
  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="mp_root">
      <header className="mp_header">
        <div className="mp_title">
          <Icons.Brain size={18} />
          <span>长期记忆</span>
          <Tag size="small">{entries.length}</Tag>
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
          onChange={(v) => setScope(v as ScopeFilter)}
          options={[
            { label: 'User（跨项目）', value: 'user' },
            { label: 'Project', value: 'project' },
            { label: 'Agent', value: 'agent' },
          ]}
        />
        {scope !== 'user' && (
          <LobeInput
            value={scopeRefInput}
            onChange={(e) => setScopeRefInput((e.target as HTMLInputElement).value)}
            placeholder={`${scope === 'project' ? 'workspaceId' : 'agentId'}（留空仅查全局）`}
            style={{ width: 240 }}
          />
        )}
        <LobeSelect value={typeFilter} onChange={(v) => setTypeFilter((v as TypeFilter) ?? 'all')} options={TYPE_OPTIONS} style={{ width: 140 }} />
        <Segmented
          value={includeInvalid ? 'with-invalid' : 'active-only'}
          onChange={(v) => setIncludeInvalid(v === 'with-invalid')}
          options={[{ label: '仅有效', value: 'active-only' }, { label: '含失效', value: 'with-invalid' }]}
        />
      </div>

      <div className="mp_list">
        {entries.length === 0 ? (
          <Empty description={loading ? '加载中…' : '暂无记忆'} />
        ) : (
          entries.map((e) => <MemoryRow key={e.id} entry={e} onOpen={() => setDetailId(e.id)} />)
        )}
      </div>

      <Drawer open={detailId != null} onClose={() => setDetailId(null)} title="记忆详情" width={560} destroyOnClose>
        {detailId != null && <MemoryDetail id={detailId} onArchivedOrDeleted={() => { setDetailId(null); void refreshFn() }} onSaved={refreshFn} />}
      </Drawer>
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="手动新增记忆" width={520} destroyOnClose>
        <MemoryCreate defaultScope={scope} defaultScopeRef={scopeRef} onDone={() => { setCreateOpen(false); void refreshFn() }} />
      </Drawer>
      <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title="记忆系统配置" width={560} destroyOnClose>
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

function MemoryRow({ entry: e, onOpen }: { entry: MemoryEntry; onOpen: () => void }) {
  const invalid = e.invalidAt != null
  const isConsolidation = e.sourceSessionId === 'consolidation'
  return (
    <div className={`mp_row${invalid ? ' mp_row_invalid' : ''}`} onClick={onOpen}>
      <div className="mp_row_main">
        <div className="mp_row_title">
          <span className="mp_row_name">{e.name}</span>
          <Tag size="small" color={typeColor(e.type)}>{e.type}</Tag>
          {invalid && <Tag size="small" color="red">失效</Tag>}
          {isConsolidation && <Tag size="small" color="purple">整合</Tag>}
          {e.archived && <Tag size="small">归档</Tag>}
        </div>
        <div className="mp_row_desc">{e.description}</div>
      </div>
      <div className="mp_row_meta">
        <span>命中 {e.hitCount}</span>
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

  if (entry == null) return <Empty description="加载中…" />

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
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [rebuilding, setRebuilding] = useState(false)

  useEffect(() => {
    void settingsGetCategory({ category: 'memory' }).then((r) => setCfg(r?.settings ?? {}))
    void listProviders({}).then((r) => setProviders(r?.profiles ?? [])).catch(() => {})
  }, [settingsGetCategory, listProviders])

  const getStr = (k: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '')
  const getNum = (k: string) => (typeof cfg[k] === 'number' ? String(cfg[k]) : '')
  const getBool = (k: string, dflt: boolean) => (typeof cfg[k] === 'boolean' ? (cfg[k] as boolean) : dflt)
  const set = (k: string, v: unknown) => {
    setCfg((c) => ({ ...c, [k]: v }))
    void settingsSet({ category: 'memory', key: k, value: v })
  }
  // 抽取支持 anthropic 原生 + OpenAI 兼容；embedding 仅 OpenAI 兼容。
  // provider_type 不在 IPC DTO 上，按 provider 字符串识别 anthropic。
  const isAnthropicProvider = (p: ProviderProfile): boolean =>
    p.provider.toLowerCase() === 'anthropic'
  const isOpenAICompatibleProvider = (p: ProviderProfile): boolean =>
    p.provider.toLowerCase() !== 'anthropic'
  const extractionProviderOptions = useMemo(
    () => providers
      .map((p) => ({ label: `${p.name}（${p.provider}${isAnthropicProvider(p) ? ' · 原生 /v1/messages' : ' · OpenAI兼容'}）`, value: p.id })),
    [providers],
  )
  const embeddingProviderOptions = useMemo(
    () => providers
      .filter(isOpenAICompatibleProvider)
      .map((p) => ({ label: `${p.name}（${p.provider} · OpenAI兼容）`, value: p.id })),
    [providers],
  )

  return (
    <div className="mp_settings">
      <section className="mp_settings_section">
        <h4>总开关</h4>
        <div className="mp_settings_row"><span>启用长期记忆（关闭后注入/写入/整合全停）</span><Switch checked={getBool('enabled', true)} onChange={(v) => set('enabled', v)} /></div>
      </section>
      <section className="mp_settings_section">
        <h4>抽取模型（写入必需）</h4>
        <div className="mp_field"><label>Provider</label><LobeSelect value={getStr('extractionProviderId') || undefined} onChange={(v) => set('extractionProviderId', v ?? '')} options={extractionProviderOptions} placeholder="选择抽取 provider（anthropic 或 OpenAI 兼容）" /></div>
        <div className="mp_field"><label>模型名（OpenAI 兼容：deepseek-chat / gpt-4o-mini / qwen-plus；anthropic：claude-3-5-haiku-20241022 / claude-sonnet-4-20250514）</label><LobeInput value={getStr('extractionModel')} onChange={(e) => set('extractionModel', (e.target as HTMLInputElement).value)} /></div>
        <div className="mp_settings_hint_inline">未配置时自动回退到当前会话 / @mention agent 的对话模型（团队主持 agent 用会话默认模型）。</div>
      </section>
      <section className="mp_settings_section">
        <h4>向量模型（可选，不配则 FTS-only，仅 OpenAI 兼容）</h4>
        <div className="mp_field"><label>Provider</label><LobeSelect value={getStr('embeddingProviderId') || undefined} onChange={(v) => set('embeddingProviderId', v ?? '')} options={embeddingProviderOptions} placeholder="选择 embedding provider" /></div>
        <div className="mp_field"><label>模型名（text-embedding-3-small / bge-m3）</label><LobeInput value={getStr('embeddingModel')} onChange={(e) => set('embeddingModel', (e.target as HTMLInputElement).value)} /></div>
        <Button loading={rebuilding} onClick={async () => {
          setRebuilding(true)
          try {
            const r = await rebuildVectors({})
            if (r?.ok) message.success('向量重建已触发（后台回填）')
            else message.warning(`未重建：${r?.reason ?? '未知'}`)
          } catch (err) { message.error(`重建失败：${err instanceof Error ? err.message : String(err)}`) }
          finally { setRebuilding(false) }
        }}>重建向量索引</Button>
      </section>
      <section className="mp_settings_section">
        <h4>整合 job</h4>
        <div className="mp_settings_row"><span>启用整合</span><Switch checked={getBool('consolidationEnabled', true)} onChange={(v) => set('consolidationEnabled', v)} /></div>
        <div className="mp_field"><label>触发阈值（条数，默认 30；真机测试可设 2）</label><LobeInput value={getNum('consolidationThreshold')} onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) set('consolidationThreshold', n) }} /></div>
        <div className="mp_field"><label>触发间隔（天，默认 7；真机测试可设 0.01）</label><LobeInput value={getNum('consolidationIntervalDays')} onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) set('consolidationIntervalDays', n) }} /></div>
      </section>
      <section className="mp_settings_section">
        <h4>检索调参（高级）</h4>
        <div className="mp_field"><label>会话注入 token 上限（默认 4000）</label><LobeInput value={getNum('maxInjectTokens')} onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) set('maxInjectTokens', n) }} /></div>
        <div className="mp_field"><label>时间衰减 λ（默认 0.01）</label><LobeInput value={getNum('timeDecayLambda')} onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) set('timeDecayLambda', n) }} /></div>
      </section>
      <div className="mp_settings_hint">配置改完<b>下一个新会话生效</b>。抽取（extract）支持 <b>OpenAI 兼容 provider</b>（deepseek/openrouter/openai/自部署 vLLM）和 <b>anthropic 原生</b>（claude，provider_type=anthropic）；<b>未配置时自动回退</b>到当前会话 / @mention agent 的对话模型（团队主持 agent 用会话默认）。向量（embedding）仅支持 OpenAI 兼容（anthropic 本身不提供 embedding 模型）；不配向量则自动 FTS-only。</div>
    </div>
  )
}
