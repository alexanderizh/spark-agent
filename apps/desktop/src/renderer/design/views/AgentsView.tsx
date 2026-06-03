import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
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
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [rules, setRules] = useState<RuleItem[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [selectedId, setSelectedId] = useState<string>('code-agent')
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)

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
      const selected = agentRes.agents.find((agent) => agent.id === selectedId) ?? agentRes.agents[0]
      if (selected != null) {
        setSelectedId(selected.id)
        setDraft(agentToDraft(selected))
      }
    } finally {
      setLoading(false)
    }
  }, [listAgents, listMcp, listProviders, listRules, listSkills, listWorkflows, selectedId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectedProvider = providers.find((provider) => provider.id === draft.providerProfileId)
  const modelOptions = selectedProvider?.modelIds.length
    ? selectedProvider.modelIds
    : selectedProvider?.defaultModel
      ? [selectedProvider.defaultModel]
      : []
  const activeWorkflow = workflows.find((workflow) => workflow.id === draft.workflowId)
  const enabledAgents = agents.filter((agent) => agent.enabled).length
  const configuredAgents = agents.filter((agent) => agent.prompt.trim() || agent.workflowId).length

  const updateDraft = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handleSelect = (agent: ManagedAgent) => {
    setSelectedId(agent.id)
    setDraft(agentToDraft(agent))
  }

  const handleNew = () => {
    setSelectedId('')
    const provider = providers[0]
    setDraft({
      ...EMPTY_DRAFT,
      providerProfileId: provider?.id ?? '',
      modelId: provider?.defaultModel ?? provider?.modelIds[0] ?? '',
    })
  }

  const handleSave = async () => {
    const payload = draftToPayload(draft)
    if (!payload.name.trim()) {
      toast.warning('Agent 名称不能为空')
      return
    }
    const saved =
      draft.id != null
        ? (await updateAgent({ id: draft.id, ...payload })).agent
        : (await createAgent(payload)).agent
    toast.success('Agent 配置已保存')
    setSelectedId(saved.id)
    await refresh()
  }

  const handleDelete = async () => {
    if (draft.id == null || draft.builtIn) return
    const res = await deleteAgent({ id: draft.id })
    if (!res.deleted) {
      toast.warning('内置 Agent 或不存在的 Agent 不能删除')
      return
    }
    toast.success('Agent 已删除')
    setSelectedId('code-agent')
    await refresh()
  }

  return (
    <div className="agents-layout agents-manager">
      <div className="agents-run-header">
        <div>
          <div className="agents-desc">配置可在对话中选择的智能体、默认模型、提示词、规则、Skill、MCP 和工作流。</div>
        </div>
        <div className="agents-actions ">
          <button className="btn ghost sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />} 刷新
          </button>
          <button className="btn primary sm" onClick={handleNew}>
            <Icons.Plus size={12} /> 新建 Agent
          </button>
        </div>
      </div>

      <div className="agents-manager-grid">
        <aside className="agents-list-panel">
          <div className="agents-list">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`agent-list-item ${agent.id === selectedId ? 'active' : ''}`}
                onClick={() => handleSelect(agent)}
              >
                <span className="agent-list-icon">
                  {agent.builtIn ? <Icons.Code size={15} /> : <Icons.Bot size={15} />}
                </span>
                <span className="agent-list-copy">
                  <span className="agent-list-name">{agent.name}</span>
                  <span className="agent-list-meta">
                    {agent.builtIn ? '内置' : '自定义'} · {agent.enabled ? '启用' : '停用'}
                  </span>
                </span>
                {agent.workflowId && <Icons.Workflow size={14} />}
              </button>
            ))}
          </div>
        </aside>

        <main className="agent-editor-panel">
          <section className="agent-editor-main">
            <div className="agent-editor-head">
              <div>
                <div className="agent-editor-title">{draft.id ? draft.name : '新建 Agent'}</div>
                <div className="agent-editor-subtitle">
                  {draft.builtIn ? '内置 Agent 可调整提示词和运行配置，但不可删除。' : '自定义 Agent 会出现在对话输入栏的 Agent 选择器中。'}
                </div>
              </div>
              <div className="agents-actions">
                <button className="btn ghost sm danger" onClick={() => void handleDelete()} disabled={!draft.id || draft.builtIn}>
                  <Icons.Trash size={12} /> 删除
                </button>
                <button className="btn primary sm" onClick={() => void handleSave()}>
                  <Icons.Check size={12} /> 保存
                </button>
              </div>
            </div>

            <div className="agent-form-grid">
              <Field label="名称">
                <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
              </Field>
              <Field label="状态">
                <select value={draft.enabled ? 'enabled' : 'disabled'} onChange={(event) => updateDraft('enabled', event.target.value === 'enabled')}>
                  <option value="enabled">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </Field>
              <Field label="说明" wide>
                <input value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} />
              </Field>
              <Field label="Provider">
                <select
                  value={draft.providerProfileId}
                  onChange={(event) => {
                    const provider = providers.find((item) => item.id === event.target.value)
                    updateDraft('providerProfileId', event.target.value)
                    updateDraft('modelId', provider?.defaultModel ?? provider?.modelIds[0] ?? '')
                  }}
                >
                  <option value="">跟随会话</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="默认模型">
                <select value={draft.modelId} onChange={(event) => updateDraft('modelId', event.target.value)}>
                  <option value="">Provider 默认</option>
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </Field>
              <Field label="权限">
                <select value={draft.permissionMode} onChange={(event) => updateDraft('permissionMode', event.target.value as SessionPermissionMode)}>
                  {PERMISSION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="推理强度">
                <select value={draft.reasoningEffort} onChange={(event) => updateDraft('reasoningEffort', event.target.value as SessionReasoningEffort)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </Field>
              <Field label="工作流" wide>
                <select value={draft.workflowId} onChange={(event) => updateDraft('workflowId', event.target.value)}>
                  <option value="">不使用工作流</option>
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="提示词" wide>
                <textarea rows={8} value={draft.prompt} onChange={(event) => updateDraft('prompt', event.target.value)} />
              </Field>
            </div>
          </section>

          <aside className="agent-config-panel">
            <ConfigSection title="Skills" count={draft.skillIds.length}>
              <PickList
                items={skills.map((skill) => ({ id: skill.id, label: skill.name }))}
                selected={draft.skillIds}
                onChange={(ids) => updateDraft('skillIds', ids)}
              />
            </ConfigSection>
            <ConfigSection title="禁用 Skills" count={draft.disabledSkillIds.length}>
              <PickList
                items={skills.map((skill) => ({ id: skill.id, label: skill.name }))}
                selected={draft.disabledSkillIds}
                onChange={(ids) => updateDraft('disabledSkillIds', ids)}
              />
            </ConfigSection>
            <ConfigSection title="MCP" count={draft.mcpServerIds.length}>
              <PickList
                items={mcpServers.map((server) => ({ id: server.id, label: server.name }))}
                selected={draft.mcpServerIds}
                onChange={(ids) => updateDraft('mcpServerIds', ids)}
              />
            </ConfigSection>
            <ConfigSection title="规则" count={draft.ruleIds.length}>
              <PickList
                items={rules.map((rule) => ({ id: rule.id, label: rule.name }))}
                selected={draft.ruleIds}
                onChange={(ids) => updateDraft('ruleIds', ids)}
              />
            </ConfigSection>
            <ConfigSection title="Hook" count={draft.hookConfig.enabled ? 1 : 0}>
              <HookEditor
                value={draft.hookConfig}
                onChange={(hookConfig) => updateDraft('hookConfig', hookConfig)}
              />
            </ConfigSection>
            <div className="agent-workflow-card">
              <div className="agent-workflow-icon"><Icons.Workflow size={16} /></div>
              <div>
                <div className="strong">{activeWorkflow?.name ?? '未绑定工作流'}</div>
                <div className="muted">{activeWorkflow ? `${activeWorkflow.graph.nodes.length} 节点 · ${activeWorkflow.status}` : 'Agent 会按普通编码流程执行'}</div>
              </div>
            </div>
          </aside>
        </main>
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

function ConfigSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="agent-config-section">
      <div className="agent-config-head">
        <span>{title}</span>
        <span className="badge">{count}</span>
      </div>
      {children}
    </section>
  )
}

function PickList({
  items,
  selected,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  if (items.length === 0) return <div className="agents-empty-mini">暂无可选项</div>
  return (
    <div className="agent-pick-list">
      {items.map((item) => {
        const active = selectedSet.has(item.id)
        return (
          <button
            key={item.id}
            className={`agent-pick-item ${active ? 'active' : ''}`}
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

function HookEditor({
  value,
  onChange,
}: {
  value: AgentHookConfig
  onChange: (value: AgentHookConfig) => void
}) {
  const patchNode = (
    node: AgentHookNode,
    patch: Partial<AgentHookConfig['nodes'][AgentHookNode]>,
  ) => {
    onChange({
      ...value,
      nodes: {
        ...value.nodes,
        [node]: { ...value.nodes[node], ...patch },
      },
    })
  }
  return (
    <div className="agent-hook-editor">
      <label className="agent-toggle-row">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        <span>启用 Agent 专属 Hook</span>
      </label>
      {HOOK_NODES.map((item) => (
        <div key={item.node} className="agent-hook-row">
          <span>{item.label}</span>
          <label>
            <input
              type="checkbox"
              checked={value.nodes[item.node].sound}
              onChange={(event) => patchNode(item.node, { sound: event.target.checked })}
            />
            声音
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.nodes[item.node].notification}
              onChange={(event) => patchNode(item.node, { notification: event.target.checked })}
            />
            通知
          </label>
        </div>
      ))}
    </div>
  )
}

function normalizeAgentHookConfig(value: Record<string, unknown>): AgentHookConfig {
  const enabled = value.enabled === true
  const rawNodes = value.nodes != null && typeof value.nodes === 'object'
    ? value.nodes as Record<string, unknown>
    : {}
  const nodes = Object.fromEntries(
    HOOK_NODES.map((item) => {
      const raw = rawNodes[item.node]
      const record = raw != null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      return [item.node, {
        sound: record.sound !== false,
        notification: record.notification !== false,
      }]
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
