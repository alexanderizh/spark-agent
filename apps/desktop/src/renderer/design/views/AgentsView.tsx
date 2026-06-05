import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { SparkCheckbox, SparkInput, SparkSelect, SparkTextarea } from '../components/FormControls'
import type {
  ManagedAgent,
  McpServerItem,
  ProviderProfile,
  RuleItem,
  SessionAgentAdapter,
  SessionPermissionMode,
  SessionReasoningEffort,
  SkillItem,
  WorkflowItem,
} from '@spark/protocol'

type AgentScreen = 'list' | 'detail'

type AgentDraft = {
  id?: string
  name: string
  description: string
  enabled: boolean
  builtIn: boolean
  providerProfileId: string
  modelId: string
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
  reasoningEffort: SessionReasoningEffort
  prompt: string
  skillIds: string[]
  disabledSkillIds: string[]
  mcpServerIds: string[]
  ruleIds: string[]
  hookConfig: AgentHookConfig
  workflowId: string
}

type AgentHookConfig = {
  enabled: boolean
  nodes: Record<AgentHookNode, { sound: boolean; notification: boolean }>
}

type AgentHookNode = 'permission_request' | 'ask_user_question' | 'session_end' | 'session_fail'

const EMPTY_DRAFT: AgentDraft = {
  name: '新 Agent',
  description: '',
  enabled: true,
  builtIn: false,
  providerProfileId: '',
  modelId: '',
  agentAdapter: 'claude-sdk',
  permissionMode: 'claude-ask',
  reasoningEffort: 'medium',
  prompt: '',
  skillIds: [],
  disabledSkillIds: [],
  mcpServerIds: [],
  ruleIds: [],
  hookConfig: {
    enabled: false,
    nodes: {
      permission_request: { sound: true, notification: true },
      ask_user_question: { sound: true, notification: true },
      session_end: { sound: false, notification: true },
      session_fail: { sound: true, notification: true },
    },
  },
  workflowId: '',
}

export function AgentsView() {
  const { toast } = useToast()
  const { registerNavGuard, requestConfirm } = useApp()
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [rules, setRules] = useState<RuleItem[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [screen, setScreen] = useState<AgentScreen>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT)
  const [baseline, setBaseline] = useState<AgentDraft>(EMPTY_DRAFT)
  const [pendingNew, setPendingNew] = useState(false)
  const [loading, setLoading] = useState(true)
  const dirty = useMemo(() => pendingNew || JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline, pendingNew])
  const dirtyRef = useRef(dirty)
  const selectedIdRef = useRef<string | null>(selectedId)
  const pendingNewRef = useRef(pendingNew)
  const screenRef = useRef<AgentScreen>('list')

  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { pendingNewRef.current = pendingNew }, [pendingNew])
  useEffect(() => { screenRef.current = screen }, [screen])

  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: createAgent } = useIpcInvoke('agent:create')
  const { invoke: updateAgent } = useIpcInvoke('agent:update')
  const { invoke: deleteAgent } = useIpcInvoke('agent:delete')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { invoke: listMcp } = useIpcInvoke('mcp:list')
  const { invoke: listRules } = useIpcInvoke('rules:list')
  const { invoke: listWorkflows } = useIpcInvoke('workflow:list')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [agentRes, providerRes, skillRes, mcpRes, ruleRes, workflowRes] = await Promise.all([
        listAgents({ includeDisabled: true }),
        listProviders({}),
        listSkills({}),
        listMcp({}),
        listRules({}),
        listWorkflows({ includeArchived: true }),
      ])
      setAgents(agentRes.agents)
      setProviders(providerRes.profiles)
      setSkills(skillRes.skills)
      setMcpServers(mcpRes.servers)
      setRules(ruleRes.rules)
      setWorkflows(workflowRes.workflows)
      if (pendingNewRef.current) return
      const currentId = selectedIdRef.current
      if (currentId != null) {
        const selected = agentRes.agents.find((a) => a.id === currentId)
        if (selected != null) {
          setSelectedId(selected.id)
          const next = agentToDraft(selected)
          setDraft(next)
          setBaseline(next)
        } else {
          selectedIdRef.current = null
          screenRef.current = 'list'
          setSelectedId(null)
          setScreen('list')
        }
      }
    } finally {
      setLoading(false)
    }
  }, [listAgents, listMcp, listProviders, listRules, listSkills, listWorkflows])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  useEffect(() => {
    registerNavGuard(async () => {
      if (!dirtyRef.current) return true
      return requestConfirm({
        title: '放弃未保存的 Agent 修改？',
        description: '离开后，当前 Agent 编辑内容会恢复到上次保存的状态。',
        confirmText: '离开',
      })
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, requestConfirm])

  const selectedProvider = providers.find((p) => p.id === draft.providerProfileId)
  const modelOptions = selectedProvider?.modelIds.length
    ? selectedProvider.modelIds
    : selectedProvider?.defaultModel ? [selectedProvider.defaultModel] : []
  const activeWorkflow = workflows.find((w) => w.id === draft.workflowId)

  const updateDraft = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const openAgent = (agent: ManagedAgent) => {
    screenRef.current = 'detail'
    selectedIdRef.current = agent.id
    setSelectedId(agent.id)
    setScreen('detail')
    const next = agentToDraft(agent)
    setDraft(next)
    setBaseline(next)
    setPendingNew(false)
  }

  const showList = async () => {
    if (dirtyRef.current) {
      const confirmed = await requestConfirm({
        title: '放弃未保存的修改？',
        description: '返回列表后，当前编辑内容会恢复到上次保存的状态。',
        confirmText: '返回',
      })
      if (!confirmed) return
    }
    screenRef.current = 'list'
    setScreen('list')
    if (pendingNewRef.current) {
      pendingNewRef.current = false
      setPendingNew(false)
    }
  }

  const createDraft = () => {
    const provider = providers[0]
    const next: AgentDraft = {
      ...EMPTY_DRAFT,
      providerProfileId: provider?.id ?? '',
      modelId: provider?.defaultModel ?? provider?.modelIds[0] ?? '',
    }
    screenRef.current = 'detail'
    selectedIdRef.current = null
    setSelectedId(null)
    setScreen('detail')
    setDraft(next)
    setBaseline(next)
    setPendingNew(true)
  }

  const handleNew = async () => {
    if (dirty) {
      const confirmed = await requestConfirm({
        title: '放弃未保存的修改？',
        description: '新建 Agent 会清空当前编辑区的未保存内容。',
        confirmText: '新建',
      })
      if (!confirmed) return
    }
    createDraft()
  }

  const handleSave = async () => {
    const payload = draftToPayload(draft)
    if (!payload.name.trim()) {
      toast.warning('Agent 名称不能为空')
      return
    }
    const saved = draft.id != null
      ? (await updateAgent({ id: draft.id, ...payload })).agent
      : (await createAgent(payload)).agent
    toast.success('Agent 配置已保存')
    selectedIdRef.current = saved.id
    pendingNewRef.current = false
    setSelectedId(saved.id)
    setPendingNew(false)
    const next = agentToDraft(saved)
    setDraft(next)
    setBaseline(next)
    await refresh()
  }

  const handleDelete = async () => {
    if (draft.id == null || draft.builtIn) return
    const confirmed = await requestConfirm({
      title: `删除 Agent「${draft.name}」？`,
      description: '此操作不可撤销，删除后该 Agent 将从会话选择器中移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed || draft.id == null) return
    const res = await deleteAgent({ id: draft.id })
    if (!res.deleted) {
      toast.warning('内置 Agent 或不存在的 Agent 不能删除')
      return
    }
    toast.success('Agent 已删除')
    selectedIdRef.current = null
    screenRef.current = 'list'
    pendingNewRef.current = false
    setSelectedId(null)
    setScreen('list')
    setPendingNew(false)
    await refresh()
  }

  // ── Card list screen ──
  if (screen === 'list') {
    return (
      <div className="agents-home">
        <div className="agents-home-head">
          <div>
            <div className="agents-title-lg">Agents</div>
            <div className="agents-desc">配置可在对话中选择的智能体、默认模型、提示词、规则、Skill、MCP 和工作流。</div>
          </div>
          <div className="agents-actions">
            <button className="btn ghost sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />} 刷新
            </button>
            <button className="btn primary sm" onClick={() => void handleNew()}>
              <Icons.Plus size={12} /> 新建 Agent
            </button>
          </div>
        </div>
        {agents.length > 0 ? (
          <div className="agents-card-grid">
            {agents.map((agent) => {
              const wf = workflows.find((w) => w.id === agent.workflowId)
              const provider = providers.find((p) => p.id === agent.providerProfileId)
              return (
                <button key={agent.id} className="agents-card" onClick={() => openAgent(agent)}>
                  <span className="agents-card-head">
                    <span className="agents-card-icon">
                      {agent.builtIn ? <Icons.Code size={18} /> : <Icons.Bot size={18} />}
                    </span>
                    <span className={`agents-card-status ${agent.enabled ? 'enabled' : 'disabled'}`}>
                      {agent.enabled ? '启用' : '停用'}
                    </span>
                  </span>
                  <span className="agents-card-name">{agent.name}</span>
                  <span className="agents-card-desc">
                    {agent.description || (agent.builtIn ? '内置 Agent' : '自定义 Agent')}
                  </span>
                  <span className="agents-card-meta">
                    <span>{agent.builtIn ? '内置' : '自定义'}</span>
                    {provider && <><span className="agents-card-dot" /><span>{provider.name}</span></>}
                    {wf && <><span className="agents-card-dot" /><span>{wf.name}</span></>}
                  </span>
                  <span className="agents-card-tags">
                    {agent.skillIds.length > 0 && <span className="agents-card-tag">{agent.skillIds.length} Skills</span>}
                    {agent.mcpServerIds.length > 0 && <span className="agents-card-tag">{agent.mcpServerIds.length} MCP</span>}
                    {agent.ruleIds.length > 0 && <span className="agents-card-tag">{agent.ruleIds.length} 规则</span>}
                    {agent.workflowId && <span className="agents-card-tag workflow-tag"><Icons.Workflow size={10} /> 工作流</span>}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          !loading && (
            <div className="agents-empty-state">
              <div className="agents-empty-icon"><Icons.Bot size={24} /></div>
              <div className="agents-empty-title">创建第一个 Agent</div>
              <div className="agents-empty-desc">智能体可在对话中选择，配置独立的模型、提示词、工具和工作流。</div>
              <div style={{ marginTop: 8 }}>
                <button className="btn primary" onClick={() => void handleNew()}>
                  <Icons.Plus size={12} /> 创建 Agent
                </button>
              </div>
            </div>
          )
        )}
      </div>
    )
  }

  // ── Detail / editor screen ──
  return (
    <div className="agents-detail">
      <div className="agents-detail-toolbar">
        <button className="btn ghost sm" onClick={() => void showList()} title="返回列表">
          <Icons.ArrowLeft size={12} /> 列表
        </button>
        <div className="agents-detail-title">
          {draft.id ? draft.name : '新建 Agent'}
          {dirty && <span className="agent-dirty-badge">已编辑未保存</span>}
        </div>
        <div className="agents-detail-spacer" />
        {draft.id != null && !draft.builtIn && (
          <button className="btn ghost sm danger" onClick={() => void handleDelete()}>
            <Icons.Trash size={12} /> 删除
          </button>
        )}
        <button className="btn primary sm" onClick={() => void handleSave()}>
          <Icons.Check size={12} /> 保存
        </button>
      </div>

      <div className="agents-detail-grid">
        <section className="agent-editor-main">
          <div className="agent-editor-head">
            <div>
              <div className="agent-editor-subtitle">
                {draft.builtIn ? '内置 Agent 可调整提示词和运行配置，但不可删除。' : '自定义 Agent 会出现在对话输入栏的 Agent 选择器中。'}
              </div>
            </div>
          </div>

          <div className="agent-form-grid">
            <Field label="名称">
              <SparkInput value={draft.name} onChange={(e) => updateDraft('name', e.target.value)} />
            </Field>
            <Field label="状态">
              <SparkSelect value={draft.enabled ? 'enabled' : 'disabled'} onChange={(e) => updateDraft('enabled', e.target.value === 'enabled')}>
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </SparkSelect>
            </Field>
            <Field label="说明" wide>
              <SparkInput value={draft.description} onChange={(e) => updateDraft('description', e.target.value)} />
            </Field>
            <Field label="Provider">
              <SparkSelect
                value={draft.providerProfileId}
                onChange={(e) => {
                  const p = providers.find((item) => item.id === e.target.value)
                  updateDraft('providerProfileId', e.target.value)
                  updateDraft('modelId', p?.defaultModel ?? p?.modelIds[0] ?? '')
                }}
              >
                <option value="">跟随会话</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SparkSelect>
            </Field>
            <Field label="默认模型">
              <SparkSelect value={draft.modelId} onChange={(e) => updateDraft('modelId', e.target.value)}>
                <option value="">Provider 默认</option>
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </SparkSelect>
            </Field>
            <Field label="权限">
              <SparkSelect value={draft.permissionMode} onChange={(e) => updateDraft('permissionMode', e.target.value as SessionPermissionMode)}>
                {PERMISSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SparkSelect>
            </Field>
            <Field label="推理强度">
              <SparkSelect value={draft.reasoningEffort} onChange={(e) => updateDraft('reasoningEffort', e.target.value as SessionReasoningEffort)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
              </SparkSelect>
            </Field>
            <Field label="工作流" wide>
              <SparkSelect value={draft.workflowId} onChange={(e) => updateDraft('workflowId', e.target.value)}>
                <option value="">不使用工作流</option>
                {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </SparkSelect>
            </Field>
            <Field label="提示词" wide>
              <SparkTextarea rows={8} value={draft.prompt} onChange={(e) => updateDraft('prompt', e.target.value)} />
            </Field>
          </div>
        </section>

        <aside className="agent-config-panel">
          <ConfigSection
            title="启用 Skills"
            count={draft.skillIds.length}
            description="勾选后，该 Agent 在运行时会主动加载这些 Skill 作为可用能力。"
          >
            <PickList
              items={skills.map((s) => ({ id: s.id, label: s.name }))}
              selected={draft.skillIds}
              disabledIds={draft.disabledSkillIds}
              onChange={(ids) => {
                const idSet = new Set(ids)
                setDraft((prev) => ({
                  ...prev,
                  skillIds: ids,
                  // 启用某个 skill 时，把它从「禁用」中移除，避免冲突
                  disabledSkillIds: prev.disabledSkillIds.filter((id) => !idSet.has(id)),
                }))
              }}
            />
          </ConfigSection>
          <ConfigSection
            title="禁用 Skills"
            count={draft.disabledSkillIds.length}
            description="勾选后，即使这些 Skill 来自全局/项目默认配置，也会被该 Agent 强制屏蔽。"
          >
            <PickList
              tone="danger"
              items={skills.map((s) => ({ id: s.id, label: s.name }))}
              selected={draft.disabledSkillIds}
              disabledIds={draft.skillIds}
              onChange={(ids) => {
                const idSet = new Set(ids)
                setDraft((prev) => ({
                  ...prev,
                  disabledSkillIds: ids,
                  // 禁用某个 skill 时，把它从「启用」中移除，避免冲突
                  skillIds: prev.skillIds.filter((id) => !idSet.has(id)),
                }))
              }}
            />
          </ConfigSection>
          <ConfigSection title="MCP" count={draft.mcpServerIds.length}>
            <PickList
              items={mcpServers.map((s) => ({ id: s.id, label: s.name }))}
              selected={draft.mcpServerIds}
              onChange={(ids) => updateDraft('mcpServerIds', ids)}
            />
          </ConfigSection>
          <ConfigSection title="规则" count={draft.ruleIds.length}>
            <PickList
              items={rules.map((r) => ({ id: r.id, label: r.name }))}
              selected={draft.ruleIds}
              onChange={(ids) => updateDraft('ruleIds', ids)}
            />
          </ConfigSection>
          <ConfigSection title="Hook" count={draft.hookConfig.enabled ? 1 : 0}>
            <HookEditor value={draft.hookConfig} onChange={(c) => updateDraft('hookConfig', c)} />
          </ConfigSection>
          <div className="agent-workflow-card">
            <div className="agent-workflow-icon"><Icons.Workflow size={16} /></div>
            <div>
              <div className="strong">{activeWorkflow?.name ?? '未绑定工作流'}</div>
              <div className="muted">
                {activeWorkflow ? `${activeWorkflow.graph.nodes.length} 节点 · ${activeWorkflow.status}` : 'Agent 会按普通编码流程执行'}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`agent-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function ConfigSection({
  title,
  count,
  description,
  children,
}: {
  title: string
  count: number
  description?: string
  children: ReactNode
}) {
  return (
    <section className="agent-config-section">
      <div className="agent-config-head">
        <span>{title}</span>
        <span className="badge">{count}</span>
      </div>
      {description != null && <p className="agent-config-desc">{description}</p>}
      {children}
    </section>
  )
}

function PickList({
  items,
  selected,
  onChange,
  tone = 'default',
  disabledIds,
}: {
  items: Array<{ id: string; label: string }>
  selected: string[]
  onChange: (ids: string[]) => void
  /** 'danger' 用于「禁用」列表，把 active 项以红色高亮以区别于「启用」 */
  tone?: 'default' | 'danger'
  /** 已被互斥配置占用的 id：在本列表中显示为灰色不可点 */
  disabledIds?: string[]
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const disabledSet = useMemo(() => new Set(disabledIds ?? []), [disabledIds])
  if (items.length === 0) return <div className="agents-empty-mini">暂无可选项</div>
  return (
    <div className="agent-pick-list">
      {items.map((item) => {
        const active = selectedSet.has(item.id)
        const blocked = !active && disabledSet.has(item.id)
        const cls = ['agent-pick-item']
        if (active) cls.push('active')
        if (tone === 'danger') cls.push('tone-danger')
        if (blocked) cls.push('blocked')
        return (
          <button
            key={item.id}
            className={cls.join(' ')}
            disabled={blocked}
            title={blocked ? '已在互斥列表中配置' : undefined}
            onClick={() => onChange(active ? selected.filter((id) => id !== item.id) : [...selected, item.id])}
          >
            <span>{item.label}</span>
            {active && <Icons.Check size={12} />}
          </button>
        )
      })}
    </div>
  )
}

function agentToDraft(agent: ManagedAgent): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    enabled: agent.enabled,
    builtIn: agent.builtIn,
    providerProfileId: agent.providerProfileId ?? '',
    modelId: agent.modelId ?? '',
    agentAdapter: agent.agentAdapter,
    permissionMode: agent.permissionMode,
    reasoningEffort: agent.reasoningEffort,
    prompt: agent.prompt,
    skillIds: agent.skillIds,
    disabledSkillIds: agent.disabledSkillIds,
    mcpServerIds: agent.mcpServerIds,
    ruleIds: agent.ruleIds,
    hookConfig: normalizeAgentHookConfig(agent.hookConfig),
    workflowId: agent.workflowId ?? '',
  }
}

function draftToPayload(draft: AgentDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    providerProfileId: draft.providerProfileId || null,
    modelId: draft.modelId || null,
    agentAdapter: draft.agentAdapter,
    permissionMode: draft.permissionMode,
    reasoningEffort: draft.reasoningEffort,
    prompt: draft.prompt,
    skillIds: draft.skillIds,
    disabledSkillIds: draft.disabledSkillIds,
    mcpServerIds: draft.mcpServerIds,
    ruleIds: draft.ruleIds,
    hookConfig: draft.hookConfig,
    workflowId: draft.workflowId || null,
  }
}

function HookEditor({ value, onChange }: { value: AgentHookConfig; onChange: (v: AgentHookConfig) => void }) {
  const patchNode = (node: AgentHookNode, patch: Partial<AgentHookConfig['nodes'][AgentHookNode]>) => {
    onChange({ ...value, nodes: { ...value.nodes, [node]: { ...value.nodes[node], ...patch } } })
  }
  return (
    <div className="agent-hook-editor">
      <SparkCheckbox className="agent-toggle-row" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} label="启用 Agent 专属 Hook" />
      {HOOK_NODES.map((item) => (
        <div key={item.node} className="agent-hook-row">
          <span>{item.label}</span>
          <SparkCheckbox checked={value.nodes[item.node].sound} onChange={(e) => patchNode(item.node, { sound: e.target.checked })} label="声音" />
          <SparkCheckbox checked={value.nodes[item.node].notification} onChange={(e) => patchNode(item.node, { notification: e.target.checked })} label="通知" />
        </div>
      ))}
    </div>
  )
}

function normalizeAgentHookConfig(value: Record<string, unknown>): AgentHookConfig {
  const enabled = value.enabled === true
  const rawNodes = value.nodes != null && typeof value.nodes === 'object' ? value.nodes as Record<string, unknown> : {}
  const nodes = Object.fromEntries(
    HOOK_NODES.map((item) => {
      const raw = rawNodes[item.node]
      const record = raw != null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      return [item.node, { sound: record.sound !== false, notification: record.notification !== false }]
    }),
  ) as AgentHookConfig['nodes']
  return { enabled, nodes }
}

const HOOK_NODES: Array<{ node: AgentHookNode; label: string }> = [
  { node: 'permission_request', label: '权限请求' },
  { node: 'ask_user_question', label: '用户提问' },
  { node: 'session_end', label: '任务完成' },
  { node: 'session_fail', label: '任务失败' },
]

const PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> = [
  { value: 'claude-ask', label: '每次询问' },
  { value: 'claude-auto-edits', label: '自动接受编辑' },
  { value: 'claude-plan', label: '计划模式' },
  { value: 'claude-auto', label: '自动权限' },
  { value: 'claude-bypass', label: '绕过权限' },
]
