import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './AgentsView.less'
import { Icons } from '../Icons'
import { translate, useI18n } from '../i18n'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useSaveShortcut } from '../hooks/useSaveShortcut'
import { useToast } from '../components/Toast'
import { Select, Switch } from 'antd'
import {
  Checkbox as LobeCheckbox,
  Dropdown,
  Input as LobeInput,
  Select as LobeSelect,
  TextArea as LobeTextArea,
} from '@lobehub/ui'
import { ActionIcon, Button } from '@lobehub/ui'
import { AgentHooksSection } from './hooks/AgentHooksSection'
import { AvatarPicker } from '../components/AvatarPicker'
import { AvatarImage } from '../components/AvatarImage'
import { SkillsPickerModal } from '../components/SkillsPickerModal'
import {
  McpServersPickerModal,
  allSelectableMcpIds,
  resolveMcpSelectionLabel,
  staleMcpSelectionIds,
} from '../components/McpServersPickerModal'
import { RuleCreateModal } from '../components/RuleCreateModal'
import { getAgentAvatarConfig, resolveAvatarSrc, type SparkAvatarConfig } from '../avatar'
import { DEFAULT_AGENT_AVATAR_ID } from '../builtinAvatars'
import { TeamsPanel } from './TeamsPanel'
import { TeamAssetPublishModal } from './TeamAssetMarket'
import {
  AGENTS_TARGET_TAB_EVENT,
  AGENTS_TARGET_TAB_STORAGE_KEY,
  readAgentsTargetTab,
  type AgentsTargetTab,
} from '../teamNavigation'
import { countExistingRefs, resolveExistingRefs } from './agent-config-counts'
import { CODEX_PERMISSION_MODE_OPTIONS as SHARED_CODEX_PERMISSION_MODE_OPTIONS } from '../utils/permission-options'
import { SPARK_PERMISSION_MODE_OPTIONS as SHARED_SPARK_PERMISSION_MODE_OPTIONS } from '../utils/permission-options'
import { isMediaProviderProfile } from '../utils/provider-model-kind'
import { NO_PROJECT_WORKSPACE_NAME, useSessionSidebar } from '../SessionSidebarContext'
import {
  getDefaultAgentModelForProvider,
  getLockedAgentAdapterForProvider,
  getProviderModelOptions,
  normalizeAgentModelForProvider,
  shouldAllowAgentModelOverride,
} from '../utils/agent-execution-config'
import type {
  AgentExportPayload,
  ManagedAgent,
  McpServerItem,
  ProviderProfile,
  RuleItem,
  SessionAgentAdapter,
  SessionPermissionMode,
  SessionReasoningEffort,
  SkillItem,
  WorkspaceInfo,
  WorkflowItem,
} from '@spark/protocol'
import { isBuiltInLocalCliProvider } from '@spark/protocol'
import {
  MAX_REASONING_BUDGET_TOKENS,
  MIN_REASONING_BUDGET_TOKENS,
  normalizeReasoningBudgetTokens,
} from '@spark/shared'

type AgentScreen = 'list' | 'detail'
type AgentFilterTab = 'all' | 'mine'
type AgentSortKey = 'updated-desc' | 'created-desc' | 'name-asc'
type AgentStatusFilter = 'all' | 'enabled' | 'disabled'

const agentSelectStyle = { width: '100%' }

/**
 * 跨视图跳转：外部（如技能详情 chip）请求打开 Agents 视图并定位到某 Agent 详情。
 * 复用 SKILL_STORE_TARGET_TAB 的「storage 暂存 + CustomEvent」三段式。
 */
export const AGENTS_OPEN_DETAIL_EVENT = 'spark-agent:agents-open-detail'
export const AGENTS_OPEN_DETAIL_STORAGE_KEY = 'spark-agent:agents-open-detail'

// 字段长度上限 —— 与服务端 schema 对齐
const AGENT_NAME_MAX = 30
const AGENT_DESC_MAX = 200

const FILTER_TABS: Array<{ value: AgentFilterTab; label: string }> = [
  { value: 'all', label: translate('agentsView.t1') },
  { value: 'mine', label: translate('agentsView.t2') },
]

const STATUS_FILTER_OPTIONS: Array<{ value: AgentStatusFilter; label: string }> = [
  { value: 'all', label: translate('agentsView.t3') },
  { value: 'enabled', label: translate('agentsView.t4') },
  { value: 'disabled', label: translate('agentsView.t5') },
]

const SORT_OPTIONS: Array<{ value: AgentSortKey; label: string }> = [
  { value: 'updated-desc', label: translate('agentsView.t6') },
  { value: 'created-desc', label: translate('agentsView.t7') },
  { value: 'name-asc', label: translate('agentsView.t8') },
]

const adapterOptions = [
  { label: 'Claude SDK', value: 'claude-sdk' },
  { label: 'Codex', value: 'codex' },
  { label: 'Spark', value: 'spark' },
]

const reasoningOptions = [
  { label: 'minimal', value: 'minimal' },
  { label: translate('agentsView.t9'), value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: translate('agentsView.t10Desc'), value: 'high' },
  { label: 'xhigh', value: 'xhigh' },
  { label: 'max', value: 'max' },
]

/** 推理强度当前值的提示文案（控件下方灰色辅助说明） */
const REASONING_HINT: Record<SessionReasoningEffort, string> = {
  minimal: translate('agentsView.t11Desc'),
  low: translate('agentsView.t12'),
  medium: translate('agentsView.t13'),
  high: translate('agentsView.t14'),
  xhigh: translate('agentsView.t15'),
  max: translate('agentsView.t16'),
}

function normalizeReasoningEffort(value: unknown): SessionReasoningEffort {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
    ? value
    : 'max'
}

function getPathBasename(path: string): string {
  return path.split(/[/\\]/).pop() ?? ''
}

type AgentDraft = {
  id?: string
  name: string
  description: string
  enabled: boolean
  isDefault: boolean
  builtIn: boolean
  providerProfileId: string
  modelId: string
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
  reasoningEffort: SessionReasoningEffort
  reasoningBudgetTokens: string
  prompt: string
  skillIds: string[]
  /** Agent 级 MCP 选择（「空=全量、部分点选=白名单」；内置用 builtin:spark_* 合成 id） */
  mcpServerIds: string[]
  ruleIds: string[]
  hookConfig: AgentHookConfig
  workflowId: string
  metadata: Record<string, unknown>
  avatar: SparkAvatarConfig
}

type AgentHookConfig = {
  enabled: boolean
  nodes: Record<AgentHookNode, { sound: boolean; notification: boolean }>
}

type AgentHookNode = 'permission_request' | 'ask_user_question' | 'session_end' | 'session_fail'

const EMPTY_DRAFT: AgentDraft = {
  name: translate('agentsView.t17'),
  description: '',
  enabled: true,
  isDefault: false,
  builtIn: false,
  providerProfileId: '',
  modelId: '',
  agentAdapter: 'claude-sdk',
  permissionMode: 'claude-auto',
  reasoningEffort: 'medium',
  reasoningBudgetTokens: '',
  prompt: '',
  skillIds: [
    'builtin:multi-search-engine',
    'builtin:browser-use',
    'builtin:platform-manager',
    'builtin:find-skills',
  ],
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
  metadata: {},
  avatar: { kind: 'builtin', id: DEFAULT_AGENT_AVATAR_ID },
}

/**
 * AgentsView 外壳：Agents / Teams 两个 Tab。
 *
 * 复用同一个 agents 数据源，避免 TeamsPanel 重复 list。
 * Agents Tab 渲染 AgentsTabContent，Teams Tab 渲染 TeamsPanel。
 */
export function AgentsView() {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const [tab, setTab] = useState<AgentsTargetTab>(readAgentsTargetTab)
  const [agentsForTeams, setAgentsForTeams] = useState<ManagedAgent[]>([])
  useEffect(() => {
    const handleTargetTab = (event: Event) => {
      const next = (event as CustomEvent<{ tab?: AgentsTargetTab }>).detail?.tab
      if (next === 'agents' || next === 'teams') setTab(next)
    }
    window.addEventListener(AGENTS_TARGET_TAB_EVENT, handleTargetTab)
    return () => window.removeEventListener(AGENTS_TARGET_TAB_EVENT, handleTargetTab)
  }, [])

  const selectTab = (next: AgentsTargetTab) => {
    window.localStorage.setItem(AGENTS_TARGET_TAB_STORAGE_KEY, next)
    setTab(next)
  }
  return (
    <div className="agents-view">
      <div className="agents-view-tabs">
        <button
          type="button"
          className={`agents-view-tab${tab === 'agents' ? ' active' : ''}`}
          onClick={() => selectTab('agents')}
        >
          <Icons.Bot size={13} /> Agents
        </button>
        <button
          type="button"
          className={`agents-view-tab${tab === 'teams' ? ' active' : ''}`}
          onClick={() => selectTab('teams')}
        >
          <Icons.Team size={13} /> Teams
        </button>
      </div>
      {tab === 'agents' ? (
        <AgentsTabContent onAgentsChange={setAgentsForTeams} />
      ) : (
        <TeamsPanel agents={agentsForTeams} />
      )}
    </div>
  )
}

function AgentsTabContent({
  onAgentsChange,
}: {
  onAgentsChange?: (agents: ManagedAgent[]) => void
}) {
  const { toast } = useToast()
  const [teamPublishFor, setTeamPublishFor] = useState<ManagedAgent | null>(null)
  const { registerNavGuard, requestConfirm, setTweak, setHasUnsavedChanges } = useApp()
  const sessionSidebar = useSessionSidebar()
  const { handleNewSession, setActiveSession, workspaces, refreshData } = sessionSidebar
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
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [showMcpPicker, setShowMcpPicker] = useState(false)
  const [showRuleCreator, setShowRuleCreator] = useState(false)
  const [filterTab, setFilterTab] = useState<AgentFilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<AgentSortKey>('updated-desc')
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [quickChatAgent, setQuickChatAgent] = useState<ManagedAgent | null>(null)
  const [quickChatBusy, setQuickChatBusy] = useState(false)
  const [quickChatProjectName, setQuickChatProjectName] = useState('')
  const [quickChatProjectPath, setQuickChatProjectPath] = useState('')
  const dirty = useMemo(
    () => pendingNew || JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline, pendingNew],
  )
  const dirtyRef = useRef(dirty)
  const selectedIdRef = useRef<string | null>(selectedId)
  const pendingNewRef = useRef(pendingNew)
  const screenRef = useRef<AgentScreen>('list')

  useEffect(() => {
    dirtyRef.current = dirty
    // 同步推进到全局，让 beforeunload 能正确判断窗口是否要拦截关闭。
    // 离开 Agents 视图时也清回 false，避免脏标志残留阻塞后续退出。
    setHasUnsavedChanges(dirty)
    return () => {
      setHasUnsavedChanges(false)
    }
  }, [dirty, setHasUnsavedChanges])
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    pendingNewRef.current = pendingNew
  }, [pendingNew])
  useEffect(() => {
    screenRef.current = screen
  }, [screen])

  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: createAgent } = useIpcInvoke('agent:create')
  const { invoke: updateAgent } = useIpcInvoke('agent:update')
  const { invoke: deleteAgent } = useIpcInvoke('agent:delete')
  const { invoke: exportAgentsToFile } = useIpcInvoke('agent:export-to-file')
  const { invoke: importAgentsFromFile } = useIpcInvoke('agent:import-from-file')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { invoke: listMcp } = useIpcInvoke('mcp:list')
  const { invoke: listRules } = useIpcInvoke('rules:list')
  const { invoke: createRule } = useIpcInvoke('rules:create')
  const { invoke: listWorkflows } = useIpcInvoke('workflow:list')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: getTempProjectDir } = useIpcInvoke('app:get-temp-project-dir')

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
      onAgentsChange?.(agentRes.agents)
      setProviders(providerRes.profiles.filter((provider) => !isMediaProviderProfile(provider)))
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
          const provider = providerRes.profiles.find(
            (item) => item.id === (selected.providerProfileId ?? ''),
          )
          const next = normalizeDraftForProvider(agentToDraft(selected), provider)
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
  }, [listAgents, listMcp, listProviders, listRules, listSkills, listWorkflows, onAgentsChange])

  useRefreshable(refresh)

  useEffect(() => {
    const id = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'agent' || event.scope === 'provider' || event.scope === 'model')
          void refresh()
      }) ?? (() => {})
    )
  }, [refresh])

  useEffect(() => {
    registerNavGuard(async () => {
      if (!dirtyRef.current) return true
      return requestConfirm({
        title: translate('agentsView.t18Desc'),
        description: translate('agentsView.t19Desc'),
        confirmText: translate('agentsView.t20'),
      })
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, requestConfirm])

  const selectedProvider = providers.find((p) => p.id === draft.providerProfileId)
  const lockedAdapter = getLockedAgentAdapterForProvider(selectedProvider)
  const effectiveAgentAdapter = lockedAdapter ?? draft.agentAdapter
  const modelOptions = useMemo(() => getAgentModelOptions(selectedProvider), [selectedProvider])
  const allowModelOverride = shouldAllowAgentModelOverride(selectedProvider)
  const activeWorkflow = workflows.find((w) => w.id === draft.workflowId)
  const quickChatProjects = useMemo(
    () =>
      workspaces
        .filter(
          (workspace) =>
            workspace.name !== NO_PROJECT_WORKSPACE_NAME &&
            workspace.worktreeMeta == null &&
            workspace.archivedAt == null,
        )
        .sort((a, b) => {
          const aPinned = a.pinnedAt == null ? 0 : new Date(a.pinnedAt).getTime()
          const bPinned = b.pinnedAt == null ? 0 : new Date(b.pinnedAt).getTime()
          if (aPinned !== bPinned) return bPinned - aPinned
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })
        .slice(0, 8),
    [workspaces],
  )

  const updateDraft = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  // 就地新建规则：成功后仅刷新规则列表并自动勾选进当前草稿（保存 Agent 后关联生效）。
  // 注意不能调 refresh()——它会用已保存的 Agent 重置 draft，覆盖用户正在编辑的内容。
  const handleCreateRule = useCallback(
    async (input: { name: string; content: string; priority: number }) => {
      const res = await createRule({
        scope: 'user',
        name: input.name,
        content: input.content,
        priority: input.priority,
      })
      const ruleRes = await listRules({})
      setRules(ruleRes.rules)
      setDraft((prev) =>
        prev.ruleIds.includes(res.rule.id)
          ? prev
          : { ...prev, ruleIds: [...prev.ruleIds, res.rule.id] },
      )
      toast.success(translate('agentsView.tpl1Desc', { name: res.rule.name }))
      setShowRuleCreator(false)
    },
    [createRule, listRules, toast],
  )

  // 深链到 设置 → 规则：先写 settingsSection 再切视图。Agent 编辑为脏时导航守卫
  // 会先弹「放弃未保存的修改？」确认，由用户决定是否离开。
  const openRulesSettings = useCallback(() => {
    setTweak('settingsSection', 'rules')
    setTweak('view', 'settings')
  }, [setTweak])

  const closeQuickChatPicker = useCallback(() => {
    if (quickChatBusy) return
    setQuickChatAgent(null)
    setQuickChatProjectName('')
    setQuickChatProjectPath('')
  }, [quickChatBusy])

  const openAgent = useCallback(
    (agent: ManagedAgent) => {
      screenRef.current = 'detail'
      selectedIdRef.current = agent.id
      setSelectedId(agent.id)
      setScreen('detail')
      const provider = providers.find((item) => item.id === (agent.providerProfileId ?? ''))
      const next = normalizeDraftForProvider(agentToDraft(agent), provider)
      setDraft(next)
      setBaseline(next)
      setPendingNew(false)
    },
    [providers],
  )

  // 跨视图跳转：外部（如技能详情 chip）请求打开某 Agent 详情。
  // agents 数据需等加载完成，故用 pending 暂存，加载后消费。
  const [pendingOpenAgentId, setPendingOpenAgentId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(AGENTS_OPEN_DETAIL_STORAGE_KEY)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handler = (event: Event) => {
      const agentId = (event as CustomEvent<{ agentId?: unknown }>).detail?.agentId
      if (typeof agentId === 'string') setPendingOpenAgentId(agentId)
    }
    window.addEventListener(AGENTS_OPEN_DETAIL_EVENT, handler)
    return () => window.removeEventListener(AGENTS_OPEN_DETAIL_EVENT, handler)
  }, [])

  useEffect(() => {
    if (pendingOpenAgentId == null) return undefined
    const id = window.setTimeout(() => {
      const target = agents.find((a) => a.id === pendingOpenAgentId)
      if (target == null) return
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(AGENTS_OPEN_DETAIL_STORAGE_KEY)
      }
      setPendingOpenAgentId(null)
      openAgent(target)
    }, 0)
    return () => window.clearTimeout(id)
  }, [pendingOpenAgentId, agents, openAgent])

  const showList = async () => {
    if (dirtyRef.current) {
      const confirmed = await requestConfirm({
        title: translate('agentsView.t21'),
        description: translate('agentsView.t22Desc'),
        confirmText: translate('agentsView.t23'),
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
    const defaultName = EMPTY_DRAFT.name
    const next = normalizeDraftForProvider(
      {
        ...EMPTY_DRAFT,
        avatar: getAgentAvatarConfig(undefined, '', defaultName),
        providerProfileId: provider?.id ?? '',
        modelId: getDefaultAgentModelForProvider(provider),
      },
      provider,
    )
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
        title: translate('agentsView.t21'),
        description: translate('agentsView.t24Desc'),
        confirmText: translate('agentsView.t25'),
      })
      if (!confirmed) return
    }
    createDraft()
  }

  const handleSave = async () => {
    if (
      draft.reasoningBudgetTokens.trim().length > 0 &&
      normalizeReasoningBudgetTokens(draft.reasoningBudgetTokens) == null
    ) {
      toast.warning(
        translate('agentsView.tpl2Desc', { min: MIN_REASONING_BUDGET_TOKENS, max: MAX_REASONING_BUDGET_TOKENS }),
      )
      return
    }
    const payload = draftToPayload(draft, selectedProvider)
    if (!payload.name.trim()) {
      toast.warning(translate('agentsView.t26'))
      return
    }
    const saved =
      draft.id != null
        ? (await updateAgent({ id: draft.id, ...payload })).agent
        : (await createAgent(payload)).agent
    toast.success(translate('agentsView.t27'))
    selectedIdRef.current = saved.id
    pendingNewRef.current = false
    setSelectedId(saved.id)
    setPendingNew(false)
    const provider = providers.find((item) => item.id === (saved.providerProfileId ?? ''))
    const next = normalizeDraftForProvider(agentToDraft(saved), provider)
    setDraft(next)
    setBaseline(next)
    await refresh()
  }

  useSaveShortcut(handleSave, screen === 'detail')

  const handleDelete = async () => {
    if (draft.id == null || draft.builtIn) return
    const confirmed = await requestConfirm({
      title: translate('agentsView.tpl3Desc', { name: draft.name }),
      description: translate('agentsView.t28Desc'),
      confirmText: translate('agentsView.t29'),
      danger: true,
    })
    if (!confirmed || draft.id == null) return
    const res = await deleteAgent({ id: draft.id })
    if (!res.deleted) {
      toast.warning(translate('agentsView.t30Desc'))
      return
    }
    toast.success(translate('agentsView.t31'))
    selectedIdRef.current = null
    screenRef.current = 'list'
    pendingNewRef.current = false
    setSelectedId(null)
    setScreen('list')
    setPendingNew(false)
    await refresh()
  }

  const handleCardCopy = async (agent: ManagedAgent) => {
    try {
      const provider = providers.find((item) => item.id === (agent.providerProfileId ?? ''))
      const cloned = normalizeDraftForProvider(agentToDraft(agent), provider)
      const payload = draftToPayload(
        { ...cloned, name: translate('agentsView.tpl4Desc', { name: agent.name }), isDefault: false },
        provider,
      )
      await createAgent(payload)
      toast.success(translate('agentsView.tpl5Desc', { name: agent.name }))
      await refresh()
    } catch {
      toast.error(translate('agentsView.tpl6Desc', { name: agent.name }))
    }
  }

  const handleCardDelete = async (agent: ManagedAgent) => {
    if (agent.builtIn) return
    const confirmed = await requestConfirm({
      title: translate('agentsView.tpl3Desc', { name: agent.name }),
      description: translate('agentsView.t28Desc'),
      confirmText: translate('agentsView.t29'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const res = await deleteAgent({ id: agent.id })
      if (!res.deleted) {
        toast.warning(translate('agentsView.t32'))
        return
      }
      toast.success(translate('agentsView.t31'))
      await refresh()
    } catch {
      toast.error(translate('agentsView.tpl7Desc', { name: agent.name }))
    }
  }

  const handleCardToggle = async (agent: ManagedAgent) => {
    try {
      await updateAgent({ id: agent.id, enabled: !agent.enabled })
      toast.success(agent.enabled ? translate('agentsView.tpl8Desc', { name: agent.name }) : translate('agentsView.tpl9Desc', { name: agent.name }))
      await refresh()
    } catch {
      toast.error(agent.enabled ? translate('agentsView.tpl10Desc', { name: agent.name }) : translate('agentsView.tpl11Desc', { name: agent.name }))
    }
  }

  const handleCardSetDefault = async (agent: ManagedAgent) => {
    if (agent.isDefault) return
    const currentDefault = agents.find((a) => a.isDefault)
    try {
      if (currentDefault) {
        await updateAgent({ id: currentDefault.id, isDefault: false })
      }
      try {
        await updateAgent({ id: agent.id, isDefault: true })
      } catch {
        // Rollback: restore the old default
        if (currentDefault) {
          await updateAgent({ id: currentDefault.id, isDefault: true }).catch(() => {})
        }
        throw new Error('set-default-failed')
      }
      toast.success(translate('agentsView.tpl12Desc', { name: agent.name }))
      await refresh()
    } catch {
      toast.error(translate('agentsView.tpl13Desc'))
    }
  }

  const handleExportAgent = async (agent: ManagedAgent) => {
    try {
      const res = await exportAgentsToFile({ ids: [agent.id] })
      if (res.filePath) {
        toast.success(translate('agentsView.tpl14Desc', { name: agent.name, path: res.filePath }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('agentsView.t33'))
    }
  }

  const handleQuickChat = (agent: ManagedAgent) => {
    setQuickChatAgent(agent)
    setQuickChatProjectName('')
    setQuickChatProjectPath('')
  }

  const launchQuickChat = useCallback(
    async (agent: ManagedAgent, workspaceId: string | null) => {
      setQuickChatBusy(true)
      try {
        const sessionId = await handleNewSession(workspaceId, {
          agentId: agent.id,
          forceNew: true,
        })
        if (sessionId != null) {
          setActiveSession(sessionId)
          setTweak('view', 'chat')
          setQuickChatAgent(null)
          setQuickChatProjectName('')
          setQuickChatProjectPath('')
          toast.success(translate('agentsView.tpl15Desc', { name: agent.name }))
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('agentsView.t34'))
      } finally {
        setQuickChatBusy(false)
      }
    },
    [handleNewSession, setActiveSession, setTweak, toast],
  )

  const handleQuickChatPickPath = useCallback(async () => {
    try {
      const selected = await openDirectoryDialog({ title: translate('agentsView.t35') })
      if (selected.canceled || selected.filePath == null) return
      const filePath = selected.filePath
      setQuickChatProjectPath(filePath)
      setQuickChatProjectName((prev) => prev.trim() || getPathBasename(filePath))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('agentsView.t36'))
    }
  }, [openDirectoryDialog, toast])

  const handleQuickChatCreateProject = useCallback(async () => {
    if (quickChatAgent == null) return
    const name = quickChatProjectName.trim() || getPathBasename(quickChatProjectPath.trim())
    if (!name) {
      toast.warning(translate('agentsView.t37'))
      return
    }
    setQuickChatBusy(true)
    try {
      let rootPath = quickChatProjectPath.trim()
      if (!rootPath) {
        const { tempDir } = await getTempProjectDir({})
        const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_') || 'project'
        rootPath = `${tempDir}/${safeName}-${Date.now()}`
      }
      const res = await openWorkspace({ create: { name, rootPath } })
      await refreshData()
      const sessionId = await handleNewSession(res.workspace.id, {
        agentId: quickChatAgent.id,
        forceNew: true,
      })
      if (sessionId != null) {
        setActiveSession(sessionId)
        setTweak('view', 'chat')
        setQuickChatAgent(null)
        setQuickChatProjectName('')
        setQuickChatProjectPath('')
        toast.success(translate('agentsView.tpl16Desc', { name: quickChatAgent.name }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('agentsView.t38'))
    } finally {
      setQuickChatBusy(false)
    }
  }, [
    getTempProjectDir,
    handleNewSession,
    openWorkspace,
    quickChatAgent,
    quickChatProjectName,
    quickChatProjectPath,
    refreshData,
    setActiveSession,
    setTweak,
    toast,
  ])

  const handleExportAll = async () => {
    try {
      const res = await exportAgentsToFile({ ids: [] })
      if (res.filePath) {
        toast.success(translate('agentsView.tpl17Desc', { count: res.count, path: res.filePath }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('agentsView.t33'))
    }
  }

  const handleExportSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.warning(translate('agentsView.t39Desc'))
      return
    }
    try {
      const res = await exportAgentsToFile({ ids })
      if (res.filePath) {
        toast.success(translate('agentsView.tpl17Desc', { count: res.count, path: res.filePath }))
        setSelectedIds(new Set())
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('agentsView.t33'))
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) {
      toast.warning(translate('agentsView.t40Desc'))
      return
    }
    // 内置 Agent 不可删除，过滤掉
    const deletable = agents.filter((a) => selectedIds.has(a.id) && !a.builtIn)
    if (deletable.length === 0) {
      toast.warning(translate('agentsView.t41Desc'))
      return
    }
    const confirmed = await requestConfirm({
      title: translate('agentsView.tpl18Desc', { count: deletable.length }),
      description: translate('agentsView.t42Desc'),
      confirmText: translate('agentsView.t43'),
      danger: true,
    })
    if (!confirmed) return
    let ok = 0
    const errs: string[] = []
    for (const agent of deletable) {
      try {
        const res = await deleteAgent({ id: agent.id })
        if (res.deleted) ok += 1
        else errs.push(agent.name)
      } catch {
        errs.push(agent.name)
      }
    }
    if (ok > 0) toast.success(translate('agentsView.tpl19Desc', { count: ok }))
    if (errs.length > 0) {
      toast.error(translate('agentsView.tpl20Desc', { count: errs.length, detail: errs.slice(0, 2).join('; ') }))
    }
    setSelectedIds(new Set())
    await refresh()
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true)
  }, [])

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleImport = async () => {
    try {
      const fileRes = await importAgentsFromFile({})
      if (fileRes.payload == null) return

      const existingNames = new Set(agents.map((a) => a.name))
      const payload = fileRes.payload as AgentExportPayload
      let imported = 0
      let skipped = 0

      for (const agent of payload.agents) {
        if (existingNames.has(agent.name)) {
          skipped++
          continue
        }
        await createAgent({
          name: agent.name,
          description: agent.description,
          agentAdapter: agent.agentAdapter,
          permissionMode: agent.permissionMode,
          reasoningEffort: normalizeReasoningEffort(agent.reasoningEffort),
          prompt: agent.prompt,
          skillIds: agent.skillIds,
          disabledSkillIds: agent.disabledSkillIds,
          ruleIds: agent.ruleIds,
          hookConfig: agent.hookConfig,
          workflowId: agent.workflowId,
          metadata: agent.metadata,
        })
        imported++
      }

      if (imported > 0) {
        toast.success(
          translate('agentsView.tpl21Desc', { count: imported, skipped: skipped > 0 ? translate('agentsView.tpl21bDesc', { count: skipped }) : '' }),
        )
        await refresh()
      } else if (skipped > 0) {
        toast.warning(translate('agentsView.tpl22Desc', { count: skipped }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('agentsView.t44'))
    }
  }

  // ── Filtered + sorted agents for the list view ──
  const counts = useMemo(() => {
    const total = agents.length
    const mine = agents.filter((a) => !a.builtIn).length
    return { all: total, mine }
  }, [agents])

  const visibleAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = agents.filter((agent) => {
      if (filterTab === 'mine' && agent.builtIn) return false
      if (statusFilter === 'enabled' && !agent.enabled) return false
      if (statusFilter === 'disabled' && agent.enabled) return false
      if (query) {
        const haystack = `${agent.name}\n${agent.description}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
    const sorted = [...filtered]
    // 固定排序：内置 agent 优先 → 默认 agent 次之 → 其他按所选排序键
    const compareBuiltIn = (a: ManagedAgent, b: ManagedAgent) => {
      if (a.builtIn === b.builtIn) return 0
      return a.builtIn ? -1 : 1
    }
    const compareDefault = (a: ManagedAgent, b: ManagedAgent) => {
      if (a.isDefault === b.isDefault) return 0
      return a.isDefault ? -1 : 1
    }
    const compareName = (a: ManagedAgent, b: ManagedAgent) =>
      a.name.localeCompare(b.name, 'zh-Hans-CN')
    const compareUpdated = (a: ManagedAgent, b: ManagedAgent) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    const compareCreated = (a: ManagedAgent, b: ManagedAgent) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt)

    sorted.sort((a, b) => {
      const builtInCmp = compareBuiltIn(a, b)
      if (builtInCmp !== 0) return builtInCmp
      const defaultCmp = compareDefault(a, b)
      if (defaultCmp !== 0) return defaultCmp
      if (sortKey === 'name-asc') return compareName(a, b)
      if (sortKey === 'created-desc') return compareCreated(a, b)
      return compareUpdated(a, b)
    })
    return sorted
  }, [agents, filterTab, statusFilter, searchQuery, sortKey])

  // 当前可见列表中已选 id 集合（用于 selectbar 的全选 / 部分选）
  const visibleIdSet = useMemo(() => new Set(visibleAgents.map((a) => a.id)), [visibleAgents])

  // 切换筛选/搜索/排序时，清理掉已不在可见列表中的选择项
  // 直接计算派生值，避开 setState-in-effect 的级联渲染告警
  const effectiveSelectedIds = useMemo(() => {
    if (selectedIds.size === 0) return selectedIds
    let changed = false
    const next = new Set<string>()
    selectedIds.forEach((id) => {
      if (visibleIdSet.has(id)) next.add(id)
      else changed = true
    })
    return changed ? next : selectedIds
  }, [selectedIds, visibleIdSet])

  // 派生结果与 selectedIds 不一致时，回写一次（不放在 useEffect 里）
  if (effectiveSelectedIds !== selectedIds) {
    setSelectedIds(effectiveSelectedIds)
  }

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(visibleAgents.map((a) => a.id)))
  }, [visibleAgents])

  // ── Card list screen ──
  if (screen === 'list') {
    return (
      <>
        <TeamAssetPublishModal
          open={teamPublishFor != null}
          assetType="agent"
          localId={teamPublishFor?.id ?? null}
          localName={teamPublishFor?.name ?? ''}
          onClose={() => setTeamPublishFor(null)}
          onPublished={() => void refresh()}
        />
        <div className="agents-home">
          <div className="agents-home-head">
            <div className="agents-home-title-block">
              <div className="agents-home-title-row">
                <h1 className="agents-home-title">{translate('agentsView.t125')}</h1>
              </div>
              <div className="agents-home-subtitle">{translate('agentsView.t126Desc')}</div>
            </div>
            <div className="agents-home-tools">
              <LobeInput
                size="middle"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={translate('agentsView.t89')}
                prefix={<Icons.Search size={14} />}
                allowClear
                className="agents-home-search"
              />
              <Button
                size="middle"
                type="primary"
                // className="agents-home-create"
                onClick={() => void handleNew()}
                icon={<Icons.Plus size={12} />}
              >
                {translate('agentsView.t127')}
              </Button>
            </div>
          </div>

          <div className="agents-home-filterbar">
            <div className="agents-home-tabs" role="tablist">
              {FILTER_TABS.map((tab) => {
                const count = tab.value === 'all' ? counts.all : counts.mine
                const active = filterTab === tab.value
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`agents-home-tab${active ? ' active' : ''}`}
                    onClick={() => setFilterTab(tab.value)}
                  >
                    <span className="agents-home-tab-label">{tab.label}</span>
                    <span className="agents-home-tab-count">{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="agents-home-toolbar">
              <Dropdown
                trigger={['click']}
                menu={{
                  items: SORT_OPTIONS.map((opt) => ({
                    key: opt.value,
                    label: opt.label,
                    onClick: () => setSortKey(opt.value),
                  })),
                }}
              >
                <button type="button" className="agents-home-sort">
                  <Icons.ArrowDown size={12} />
                  <span>
                    {SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? translate('agentsView.t6')}
                  </span>
                  <Icons.ChevronDown size={12} />
                </button>
              </Dropdown>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: STATUS_FILTER_OPTIONS.map((opt) => ({
                    key: opt.value,
                    label: opt.label,
                    onClick: () => setStatusFilter(opt.value),
                  })),
                }}
              >
                <button type="button" className="agents-home-sort">
                  <Icons.CheckCircle size={12} />
                  <span>
                    {STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ??
                      translate('agentsView.t3')}
                  </span>
                  <Icons.ChevronDown size={12} />
                </button>
              </Dropdown>
              <Button
                size="middle"
                type="text"
                onClick={() => void refresh()}
                disabled={loading}
                title={translate('agentsView.t90')}
                icon={loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />}
              />
              {visibleAgents.length > 0 && (
                <Button
                  size="middle"
                  type={selectionMode ? 'primary' : 'text'}
                  onClick={selectionMode ? exitSelectionMode : enterSelectionMode}
                  icon={<Icons.CheckSquare size={12} />}
                >
                  {selectionMode ? translate('agentsView.t45') : translate('agentsView.t46')}
                </Button>
              )}
              <Button
                size="middle"
                type="text"
                onClick={() => void handleImport()}
                icon={<Icons.Upload size={12} />}
              >
                {translate('agentsView.t128')}
              </Button>
              <Button
                size="middle"
                type="text"
                onClick={() => void handleExportAll()}
                icon={<Icons.Download size={12} />}
              >
                {translate('agentsView.t129')}
              </Button>
            </div>
          </div>

          {loading && visibleAgents.length === 0 ? (
            <div className="agents-loading-state" role="status" aria-live="polite">
              <Icons.Spinner size={24} />
              <div className="agents-loading-title">{translate('agentsView.t130')}</div>
              <div className="agents-loading-desc">{translate('agentsView.t131Desc')}</div>
            </div>
          ) : visibleAgents.length > 0 ? (
            <>
              {selectionMode && selectedIds.size > 0 && (
                <div className="agents-selectbar" role="region" aria-label={translate('agentsView.t91')}>
                  <span className="agents-selectbar-count">{translate('agentsView.tpl23Desc', { count: selectedIds.size })}</span>
                  <span className="agents-selectbar-spacer" />
                  <Button
                    size="middle"
                    type="text"
                    onClick={
                      selectedIds.size === visibleAgents.length ? clearSelection : selectAllVisible
                    }
                  >
                    {selectedIds.size === visibleAgents.length ? translate('agentsView.t47') : translate('agentsView.t48')}
                  </Button>
                  <Button size="middle" type="text" onClick={clearSelection}>
                    {translate('agentsView.t132')}
                  </Button>
                  <Button
                    size="middle"
                    type="primary"
                    danger
                    onClick={() => void handleDeleteSelected()}
                    icon={<Icons.Trash size={12} />}
                  >
                    {translate('agentsView.t133')}
                  </Button>
                  <Button
                    size="middle"
                    type="primary"
                    onClick={() => void handleExportSelected()}
                    icon={<Icons.Download size={12} />}
                  >
                    {translate('agentsView.t134')}
                  </Button>
                </div>
              )}
              <div className="agents-card-grid">
                {visibleAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    providers={providers}
                    workflows={workflows}
                    skills={skills}
                    rules={rules}
                    selected={selectedIds.has(agent.id)}
                    selectionMode={selectionMode}
                    onToggleSelect={() => toggleSelect(agent.id)}
                    onOpen={() => openAgent(agent)}
                    onQuickChat={() => handleQuickChat(agent)}
                    onExport={() => void handleExportAgent(agent)}
                    onPublishToTeam={agent.builtIn ? undefined : () => setTeamPublishFor(agent)}
                    onCopy={() => void handleCardCopy(agent)}
                    onEdit={() => openAgent(agent)}
                    onDelete={agent.builtIn ? noop : () => void handleCardDelete(agent)}
                    onToggle={() => void handleCardToggle(agent)}
                    onSetDefault={agent.isDefault ? noop : () => void handleCardSetDefault(agent)}
                  />
                ))}
              </div>
            </>
          ) : (
            !loading && (
              <div className="agents-empty-state">
                <div className="agents-empty-icon">
                  <Icons.Bot size={24} />
                </div>
                <div className="agents-empty-title">
                  {searchQuery
                    ? translate('agentsView.tpl24Desc', { query: searchQuery })
                    : filterTab === 'mine'
                      ? translate('agentsView.t49')
                      : translate('agentsView.t50')}
                </div>
                <div className="agents-empty-desc">
                  {searchQuery
                    ? translate('agentsView.t51Desc')
                    : translate('agentsView.t52Desc')}
                </div>
                {!searchQuery && (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      onClick={() => void handleNew()}
                      icon={<Icons.Plus size={12} />}
                    >
                      {translate('agentsView.t127')}
                    </Button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
        <QuickChatProjectModal
          agent={quickChatAgent}
          projects={quickChatProjects}
          projectName={quickChatProjectName}
          projectPath={quickChatProjectPath}
          busy={quickChatBusy}
          onClose={closeQuickChatPicker}
          onProjectNameChange={setQuickChatProjectName}
          onProjectPathChange={setQuickChatProjectPath}
          onPickProjectPath={() => void handleQuickChatPickPath()}
          onPickWorkspace={(workspaceId) => {
            if (quickChatAgent == null) return
            void launchQuickChat(quickChatAgent, workspaceId)
          }}
          onUseTemporaryChat={() => {
            if (quickChatAgent == null) return
            void launchQuickChat(quickChatAgent, null)
          }}
          onCreateProject={() => void handleQuickChatCreateProject()}
        />
      </>
    )
  }

  // ── Detail / editor screen ──
  return (
    <div className="agents-detail">
      <div className="agents-detail-toolbar">
        <Button
          size="middle"
          type="text"
          onClick={() => void showList()}
          title={translate('agentsView.t92')}
          icon={<Icons.ArrowLeft size={12} />}
        >
          {translate('agentsView.t135')}
        </Button>
        <div className="agents-detail-title">
          {draft.id ? draft.name : translate('agentsView.t53')}
          {dirty && <span className="agent-dirty-badge">{translate('agentsView.t136')}</span>}
        </div>
        <div className="agents-detail-spacer" />
        {draft.id != null && !draft.builtIn && (
          <Button
            size="middle"
            type="text"
            danger
            onClick={() => void handleDelete()}
            icon={<Icons.Trash size={12} />}
          >
            {translate('agentsView.t29')}
          </Button>
        )}
        <Button
          size="middle"
          type="primary"
          onClick={() => void handleSave()}
          icon={<Icons.Check size={12} />}
        >
          {translate('agentsView.t137')}
        </Button>
      </div>

      <div className="agents-detail-grid">
        <section className="agent-editor-main">
          {/* ── Section: 基本信息 ── */}
          <SectionHeader
            title={translate('agentsView.t93')}
            desc={
              draft.builtIn
                ? translate('agentsView.t54Desc')
                : translate('agentsView.t55Desc')
            }
          />

          <div className="agent-info-grid">
            <div className="agent-info-avatar">
              <AvatarPicker
                value={draft.avatar}
                defaultSeed={draft.name || 'agent'}
                defaultAvatarId={DEFAULT_AGENT_AVATAR_ID}
                title=""
                showDefaultAction={false}
                uploadOnPreviewClick
                onChange={(avatar) => updateDraft('avatar', avatar)}
              />
            </div>

            <Field
              label={translate('agentsView.t94')}
              required
              counter={{ current: draft.name.length, max: AGENT_NAME_MAX }}
            >
              <LobeInput
                value={draft.name}
                maxLength={AGENT_NAME_MAX}
                placeholder={translate('agentsView.t95Desc')}
                onChange={(e) => updateDraft('name', e.target.value)}
              />
            </Field>

            <Field label={translate('agentsView.t96')}>
              <div className="agent-status-row">
                <Switch
                  checked={draft.enabled}
                  onChange={(checked: boolean) => updateDraft('enabled', checked)}
                />
                <span className="agent-status-text">{draft.enabled ? translate('agentsView.t56') : translate('agentsView.t57')}</span>
              </div>
              <div className="agent-field-hint">{translate('agentsView.t138Desc')}</div>
            </Field>

            <Field
              label={translate('agentsView.t97')}
              required
              wide
              counter={{ current: draft.description.length, max: AGENT_DESC_MAX }}
            >
              <LobeTextArea
                value={draft.description}
                maxLength={AGENT_DESC_MAX}
                rows={3}
                placeholder={translate('agentsView.t98Desc')}
                onChange={(e) => updateDraft('description', e.target.value)}
              />
            </Field>

            <Field label={translate('agentsView.t99')}>
              <div className="agent-status-row">
                <Switch
                  checked={draft.isDefault}
                  onChange={(checked: boolean) => updateDraft('isDefault', checked)}
                />
                <span className="agent-status-text">
                  {draft.isDefault ? translate('agentsView.t58') : translate('agentsView.t59')}
                </span>
              </div>
              <div className="agent-field-hint">
                {draft.isDefault ? translate('agentsView.t60Desc') : translate('agentsView.t61')}
              </div>
            </Field>
          </div>

          {/* ── Section: 执行配置 ── */}
          <div className="agent-section-divider" />
          <SectionHeader
            title={translate('agentsView.t100')}
            desc={translate('agentsView.t101Desc')}
          />

          <div className="agent-form-grid">
            <Field label="Provider">
              <LobeSelect
                value={draft.providerProfileId}
                onChange={(value) => {
                  const nextProviderId = String(value)
                  const provider = providers.find((item) => item.id === nextProviderId)
                  setDraft((prev) =>
                    normalizeDraftForProvider(
                      {
                        ...prev,
                        providerProfileId: nextProviderId,
                        modelId: getDefaultAgentModelForProvider(provider),
                      },
                      provider,
                    ),
                  )
                }}
                options={[
                  { label: translate('agentsView.t62'), value: '' },
                  ...providers.map((p) => ({
                    // router 行加 ⚙ 前缀标识（选中后模型由分流器逐轮决定）
                    label: p.providerType === 'auto-router' ? `⚙ ${p.name}` : p.name,
                    value: p.id,
                  })),
                ]}
                style={agentSelectStyle}
              />
            </Field>
            <Field
              label={translate('agentsView.t102')}
              badge={
                effectiveAgentAdapter === 'claude-sdk' ? (
                  <span className="agent-badge-soft">{translate('agentsView.t139')}</span>
                ) : null
              }
            >
              {lockedAdapter ? (
                <LobeInput value={getAgentAdapterLabel(lockedAdapter)} readOnly disabled />
              ) : (
                <LobeSelect
                  value={draft.agentAdapter}
                  onChange={(value) => {
                    const nextAdapter = value as SessionAgentAdapter
                    updateDraft('agentAdapter', nextAdapter)
                    updateDraft('permissionMode', getDefaultPermissionMode(nextAdapter))
                  }}
                  options={adapterOptions}
                  style={agentSelectStyle}
                />
              )}
            </Field>
            <Field
              label={translate('agentsView.t103')}
              hint={
                selectedProvider && !allowModelOverride
                  ? selectedProvider.providerType === 'auto-router'
                    ? translate('agentsView.t63Desc')
                    : translate('agentsView.t64Desc')
                  : undefined
              }
            >
              {selectedProvider && !allowModelOverride ? (
                <LobeInput
                  value={
                    selectedProvider.providerType === 'auto-router'
                      ? translate('agentsView.t65')
                      : translate('agentsView.t66')
                  }
                  readOnly
                  disabled
                />
              ) : (
                <LobeSelect
                  value={draft.modelId}
                  onChange={(value) => updateDraft('modelId', String(value))}
                  options={[{ label: translate('agentsView.t67'), value: '' }, ...modelOptions]}
                  style={agentSelectStyle}
                />
              )}
            </Field>
            <Field label={translate('agentsView.t104')}>
              <LobeSelect
                value={draft.permissionMode}
                onChange={(value) => updateDraft('permissionMode', value as SessionPermissionMode)}
                options={getPermissionOptions(effectiveAgentAdapter).map((o) => ({
                  label: o.label,
                  value: o.value,
                }))}
                style={agentSelectStyle}
              />
            </Field>
            <Field label={translate('agentsView.t105')} hint={REASONING_HINT[draft.reasoningEffort]}>
              <LobeSelect
                value={draft.reasoningEffort}
                onChange={(value) =>
                  updateDraft('reasoningEffort', value as SessionReasoningEffort)
                }
                options={reasoningOptions}
                style={agentSelectStyle}
              />
            </Field>
            <Field
              label={translate('agentsView.t106')}
              hint={translate('agentsView.t107LongDesc')}
            >
              <LobeInput
                type="number"
                min={MIN_REASONING_BUDGET_TOKENS}
                max={MAX_REASONING_BUDGET_TOKENS}
                step={1024}
                value={draft.reasoningBudgetTokens}
                disabled={effectiveAgentAdapter !== 'claude-sdk'}
                placeholder={translate('agentsView.t108')}
                onChange={(event) => updateDraft('reasoningBudgetTokens', event.target.value)}
              />
            </Field>
            <Field
              label={translate('agentsView.t109')}
              hint={
                activeWorkflow
                  ? translate('agentsView.tpl25Desc', { name: activeWorkflow.name, count: activeWorkflow.graph.nodes.length, status: activeWorkflow.status })
                  : translate('agentsView.t68Desc')
              }
            >
              <LobeSelect
                value={draft.workflowId}
                onChange={(value) => updateDraft('workflowId', String(value))}
                options={[
                  { label: translate('agentsView.t69'), value: '' },
                  ...workflows.map((w) => ({ label: w.name, value: w.id })),
                ]}
                style={agentSelectStyle}
              />
            </Field>
            <div className="agent-form-grid-wide">
              <PromptEditor value={draft.prompt} onChange={(next) => updateDraft('prompt', next)} />
            </div>
          </div>
        </section>

        <aside className="agent-config-panel">
          <ConfigSection
            title="Skills"
            count={countExistingRefs(draft.skillIds, skills)}
            description={translate('agentsView.t110Desc')}
            footer={
              <button
                type="button"
                className="agent-config-link"
                onClick={() => setShowSkillPicker(true)}
              >
                <Icons.Skills size={12} /> {translate('agentsView.t140')}
              </button>
            }
          >
            {(() => {
              const selectedSkills = resolveExistingRefs(draft.skillIds, skills)
              return selectedSkills.length > 0 ? (
                <div className="skill-selected-preview">
                  {selectedSkills.slice(0, 6).map((skill) => (
                    <span key={skill.id} className="skill-chip">
                      {skill.name}
                    </span>
                  ))}
                  {selectedSkills.length > 6 && (
                    <span className="skill-chip more">+{selectedSkills.length - 6}</span>
                  )}
                </div>
              ) : (
                <div className="agent-config-empty">{translate('agentsView.t141')}</div>
              )
            })()}
          </ConfigSection>

          <ConfigSection
            title={translate('agentsView.t111')}
            count={
              draft.mcpServerIds.length > 0
                ? draft.mcpServerIds.length
                : mcpServers.filter((server) => server.enabled).length
            }
            description={translate('agentsView.t112Desc')}
            footer={
              <button
                type="button"
                className="agent-config-link"
                onClick={() => setShowMcpPicker(true)}
              >
                <Icons.Skills size={12} /> {translate('agentsView.t142')}
              </button>
            }
          >
            {(() => {
              if (draft.mcpServerIds.length === 0) {
                return (
                  <div className="agent-config-empty">
                    {translate('agentsView.t143Desc')}
                    <span className="mcp-default-hint">{translate('agentsView.t144Desc')}</span>
                  </div>
                )
              }
              return (
                <div className="skill-selected-preview">
                  {draft.mcpServerIds.slice(0, 6).map((id) => (
                    <span key={id} className="skill-chip">
                      {resolveMcpSelectionLabel(id, mcpServers)}
                    </span>
                  ))}
                  {draft.mcpServerIds.length > 6 && (
                    <span className="skill-chip more">+{draft.mcpServerIds.length - 6}</span>
                  )}
                </div>
              )
            })()}
          </ConfigSection>

          <ConfigSection
            title={translate('agentsView.t113')}
            count={countExistingRefs(draft.ruleIds, rules)}
            description={translate('agentsView.t114Desc')}
            actions={
              <button
                type="button"
                className="agent-config-action-btn"
                onClick={() => setShowRuleCreator(true)}
              >
                <Icons.Plus size={12} /> {translate('agentsView.t145')}
              </button>
            }
            footer={
              <button
                type="button"
                className="agent-config-link"
                onClick={openRulesSettings}
                title={translate('agentsView.t115Desc')}
              >
                <Icons.ListTodo size={12} /> {translate('agentsView.t146')}
              </button>
            }
          >
            {rules.length > 0 ? (
              <PickList
                items={rules.map((r) => ({ id: r.id, label: r.name }))}
                selected={draft.ruleIds}
                onChange={(ids) => updateDraft('ruleIds', ids)}
              />
            ) : (
              <div className="agent-config-empty">
                {translate('agentsView.t147Desc')}
              </div>
            )}
          </ConfigSection>

          <ConfigSection title="Hook" description={translate('agentsView.t116Desc')}>
            <AgentHooksSection agentId={draft.id ?? null} />
          </ConfigSection>
        </aside>
      </div>
      <SkillsPickerModal
        visible={showSkillPicker}
        skills={skills.map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
        }))}
        selectedIds={draft.skillIds}
        onChange={(ids) => updateDraft('skillIds', ids)}
        onConfirm={() => setShowSkillPicker(false)}
        onClose={() => setShowSkillPicker(false)}
      />
      <McpServersPickerModal
        visible={showMcpPicker}
        userServers={mcpServers}
        selectedIds={draft.mcpServerIds}
        onChange={(ids) => updateDraft('mcpServerIds', ids)}
        onConfirm={() => {
          // D6「全选 = 全部（动态）」：勾满全部可选项时归一化为 []，后续新增
          // server 自动纳入，语义不漂移；部分选择才落显式清单。已删除 server 的
          // 失效 id 不参与判等并在保存时自动清理（停用 server 的选择保留，重新
          // 启用后自动恢复意义）。
          const stale = new Set(staleMcpSelectionIds(draft.mcpServerIds, mcpServers))
          const effective = draft.mcpServerIds.filter((id) => !stale.has(id))
          const selectable = new Set(allSelectableMcpIds(mcpServers))
          const coversAll = effective.length > 0 && effective.every((id) => selectable.has(id))
          if (coversAll && effective.length === selectable.size) {
            updateDraft('mcpServerIds', [])
          } else if (stale.size > 0) {
            updateDraft('mcpServerIds', effective)
          }
          setShowMcpPicker(false)
        }}
        onClose={() => setShowMcpPicker(false)}
      />
      <RuleCreateModal
        visible={showRuleCreator}
        onClose={() => setShowRuleCreator(false)}
        onSubmit={handleCreateRule}
      />
    </div>
  )
}

// 临时会话在 Select 中的哨兵值，避免与真实项目 id 冲突
const QUICKCHAT_TEMP_VALUE = '__quickchat_temp__'

function QuickChatProjectModal({
  agent,
  projects,
  projectName,
  projectPath,
  busy,
  onClose,
  onProjectNameChange,
  onProjectPathChange,
  onPickProjectPath,
  onPickWorkspace,
  onUseTemporaryChat,
  onCreateProject,
}: {
  agent: ManagedAgent | null
  projects: WorkspaceInfo[]
  projectName: string
  projectPath: string
  busy: boolean
  onClose: () => void
  onProjectNameChange: (value: string) => void
  onProjectPathChange: (value: string) => void
  onPickProjectPath: () => void
  onPickWorkspace: (workspaceId: string) => void
  onUseTemporaryChat: () => void
  onCreateProject: () => void
}) {
  const [selectedValue, setSelectedValue] = useState<string | null>(null)

  if (agent == null) return null

  // Select 选项：所有已有项目 + 临时会话（哨兵）
  const selectOptions = [
    ...projects.map((workspace) => ({
      value: workspace.id,
      displayName: workspace.name,
      label: (
        <div className="agents-quickchat-option">
          <span className="agents-quickchat-option-name">
            <Icons.Folder size={13} />
            <span>{workspace.name}</span>
          </span>
          <span className="agents-quickchat-option-path">{workspace.rootPath}</span>
        </div>
      ),
    })),
    {
      value: QUICKCHAT_TEMP_VALUE,
      displayName: translate('agentsView.t70'),
      label: (
        <div className="agents-quickchat-option">
          <span className="agents-quickchat-option-name">
            <Icons.Chat size={13} />
            <span>{translate('agentsView.t70')}</span>
          </span>
          <span className="agents-quickchat-option-path">{translate('agentsView.t148Desc')}</span>
        </div>
      ),
    },
  ]

  const handleSelectChange = (value: string | null) => {
    setSelectedValue(value)
    if (value == null) return
    if (value === QUICKCHAT_TEMP_VALUE) {
      onUseTemporaryChat()
    } else {
      onPickWorkspace(value)
    }
  }

  return (
    <div
      className="agents-quickchat-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="agents-quickchat-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="agents-quickchat-head">
          <div>
            <div className="agents-quickchat-kicker">{translate('agentsView.t149')}</div>
            <div className="agents-quickchat-title">{translate('agentsView.tpl26Desc', { name: agent.name })}</div>
          </div>
          <button
            type="button"
            className="agents-quickchat-close"
            onClick={onClose}
            disabled={busy}
            aria-label={translate('agentsView.t117')}
          >
            <Icons.X size={14} />
          </button>
        </div>

        <div className="agents-quickchat-body">
          <div className="agents-quickchat-section">
            <div className="agents-quickchat-section-title">{translate('agentsView.t150')}</div>
            <Select
              className="agents-quickchat-select"
              value={selectedValue}
              onChange={handleSelectChange}
              disabled={busy}
              placeholder={translate('agentsView.t118Desc')}
              optionLabelProp="displayName"
              optionFilterProp="displayName"
              showSearch
              options={selectOptions}
              notFoundContent={projects.length === 0 ? translate('agentsView.t71Desc') : translate('agentsView.t72')}
              popupMatchSelectWidth
            />
            {projects.length === 0 && (
              <div className="agents-quickchat-empty">
                {translate('agentsView.t151Desc')}
              </div>
            )}
          </div>

          <div className="agents-quickchat-divider" />

          <div className="agents-quickchat-section">
            <div className="agents-quickchat-section-title">{translate('agentsView.t152')}</div>
            <label className="agents-quickchat-field">
              <span>{translate('agentsView.t153')}</span>
              <LobeInput
                value={projectName}
                placeholder={translate('agentsView.t119')}
                onChange={(event) => onProjectNameChange(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="agents-quickchat-field">
              <span>{translate('agentsView.t154')}</span>
              <div className="agents-quickchat-path-row">
                <LobeInput
                  value={projectPath}
                  placeholder={translate('agentsView.t120')}
                  onChange={(event) => onProjectPathChange(event.target.value)}
                  disabled={busy}
                />
                <Button size="middle" type="text" onClick={onPickProjectPath} disabled={busy}>
                  {translate('agentsView.t155')}
                </Button>
              </div>
            </label>
          </div>
        </div>

        <div className="agents-quickchat-actions">
          <Button size="middle" type="text" onClick={onClose} disabled={busy}>
            {translate('agentsView.t156')}
          </Button>
          <Button size="middle" type="primary" onClick={onCreateProject} loading={busy}>
            {translate('agentsView.t157')}
          </Button>
        </div>
      </div>
    </div>
  )
}

type AgentCardProps = {
  agent: ManagedAgent
  providers: ProviderProfile[]
  workflows: WorkflowItem[]
  skills: SkillItem[]
  rules: RuleItem[]
  selected: boolean
  selectionMode: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onQuickChat: () => void
  onExport: () => void
  onPublishToTeam?: (() => void) | undefined
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onSetDefault: () => void
}

const noop = () => {}

function AgentCard({
  agent,
  providers,
  workflows,
  skills,
  rules,
  selected,
  selectionMode,
  onToggleSelect,
  onOpen,
  onQuickChat,
  onExport,
  onPublishToTeam,
  onCopy,
  onEdit,
  onDelete,
  onToggle,
  onSetDefault,
}: AgentCardProps) {
  const provider = providers.find((p) => p.id === agent.providerProfileId)
  const workflow = workflows.find((w) => w.id === agent.workflowId)
  const avatar = getAgentAvatarConfig(agent.metadata, agent.id, agent.name)
  const modelLabel =
    provider?.providerType === 'auto-router'
      ? `⚙ ${provider.name}`
      : agent.modelId?.trim() ||
        provider?.defaultModel ||
        provider?.modelIds[0] ||
        (agent.agentAdapter === 'codex'
          ? 'Codex'
          : agent.agentAdapter === 'spark'
            ? 'Spark'
            : 'Claude')
  const skillCount = countExistingRefs(agent.skillIds, skills)
  const ruleCount = countExistingRefs(agent.ruleIds, rules)
  const hasMetaTags = agent.isDefault || skillCount > 0 || workflow != null || ruleCount > 0

  const menuItems = {
    items: [
      {
        key: 'chat',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Chat size={14} /> {translate('agentsView.t149')}
          </span>
        ),
        onClick: () => onQuickChat(),
      },
      {
        key: 'export',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Download size={14} /> {translate('agentsView.t121')}
          </span>
        ),
        onClick: () => onExport(),
      },
      ...(onPublishToTeam != null
        ? [
            {
              key: 'team-publish',
              label: (
                <span className="agent-context-menu-item">
                  <Icons.Users size={14} /> {translate('agentsView.t158')}
                </span>
              ),
              onClick: () => onPublishToTeam(),
            },
          ]
        : []),
      {
        key: 'copy',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Copy size={14} /> {translate('agentsView.t122')}
          </span>
        ),
        onClick: () => onCopy(),
      },
      {
        key: 'edit',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Edit size={14} /> {translate('agentsView.t159')}
          </span>
        ),
        onClick: () => onEdit(),
      },
      ...(!agent.builtIn
        ? [
            {
              key: 'delete',
              label: (
                <span className="agent-context-menu-item danger">
                  <Icons.Trash size={14} /> {translate('agentsView.t29')}
                </span>
              ),
              onClick: () => onDelete(),
            },
          ]
        : []),
    ],
  }

  const cardBody = (
    <div
      className={`agents-card${agent.enabled ? '' : ' is-disabled'}${selected ? ' is-selected' : ''}${selectionMode ? ' is-selecting' : ''}`}
    >
      {selectionMode && (
        <label
          className="agents-card-check"
          onClick={(e) => e.stopPropagation()}
          title={selected ? translate('agentsView.t73') : translate('agentsView.t46')}
        >
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </label>
      )}
      <div
        className="agents-card-clickable"
        role="button"
        tabIndex={0}
        onClick={selectionMode ? onToggleSelect : onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (selectionMode) onToggleSelect()
            else onOpen()
          }
        }}
      >
        <div className="agents-card-main">
          <div className="agents-card-head">
            <div className="agents-card-head-main">
              <span className="agents-card-avatar">
                <AvatarImage
                  src={resolveAvatarSrc(avatar)}
                  seed={agent.id}
                  name={agent.name}
                  alt={agent.name}
                />
              </span>
              <span className="agents-card-name">{agent.name}</span>
            </div>
            <span className={`agents-card-status ${agent.enabled ? 'enabled' : 'disabled'}`}>
              {agent.enabled ? translate('agentsView.t56') : translate('agentsView.t57')}
            </span>
          </div>
          <div className="agents-card-desc">
            {agent.description || (agent.builtIn ? translate('agentsView.t74') : translate('agentsView.t75'))}
          </div>
        </div>
        {hasMetaTags && (
          <div className="agents-card-meta">
            <div className="agents-card-tags">
              {agent.isDefault && <span className="agents-card-tag default-tag">{translate('agentsView.t160')}</span>}
              {skillCount > 0 && (
                <span className="agents-card-tag" title="Skills">
                  <Icons.Skills size={10} />
                  {skillCount} Skills
                </span>
              )}
              {workflow && (
                <span className="agents-card-tag" title={workflow.name}>
                  <Icons.Workflow size={10} />
                  {translate('agentsView.t109')}
                </span>
              )}
              {ruleCount > 0 && (
                <span className="agents-card-tag" title={translate('agentsView.t113')}>
                  <Icons.Filter size={10} />
                  {translate('agentsView.tpl27Desc', { count: ruleCount })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="agents-card-footer" onClick={(e) => e.stopPropagation()}>
        <div className="agents-card-model agents-card-model-chip" title={modelLabel}>
          <Icons.Cpu size={12} />
          <span className="agents-card-model-name">{modelLabel}</span>
        </div>
        <span className="agents-card-actions">
          <ActionIcon
            icon={agent.enabled ? Icons.XCircle : Icons.CheckCircle}
            size="small"
            variant="borderless"
            title={agent.enabled ? translate('agentsView.t57') : translate('agentsView.t56')}
            onClick={onToggle}
          />
          {!agent.isDefault && (
            <ActionIcon
              icon={Icons.Star}
              size="small"
              variant="borderless"
              title={translate('agentsView.t59')}
              onClick={onSetDefault}
            />
          )}
          <ActionIcon
            icon={Icons.Download}
            size="small"
            variant="borderless"
            title={translate('agentsView.t121')}
            onClick={onExport}
          />
          <ActionIcon
            icon={Icons.Copy}
            size="small"
            variant="borderless"
            title={translate('agentsView.t122')}
            onClick={onCopy}
          />
          {!agent.builtIn && (
            <ActionIcon
              icon={Icons.Trash}
              size="small"
              variant="borderless"
              danger
              title={translate('agentsView.t29')}
              onClick={onDelete}
            />
          )}
        </span>
      </div>
    </div>
  )

  return (
    <Dropdown trigger={['contextMenu']} menu={menuItems} placement="bottomLeft">
      {cardBody}
    </Dropdown>
  )
}

function Field({
  label,
  wide,
  required,
  counter,
  hint,
  badge,
  children,
}: {
  label: string
  wide?: boolean
  /** 必填 —— 在 label 后加红色 * */
  required?: boolean
  /** 字符计数，如 { current: 8, max: 30 }，渲染在 label 右侧 */
  counter?: { current: number; max: number }
  /** 控件下方的灰色辅助说明 */
  hint?: ReactNode
  /** label 旁的小徽章（如「推荐」） */
  badge?: ReactNode
  children: ReactNode
}) {
  // 不用 <label> 包 children：label 元素会拦截内部 click，
  // 在一些 select / popover / date-picker 控件里会导致下拉/弹窗"{translate('agentsView.tpl28Desc')}"。
  return (
    <div className={`agent-field ${wide ? 'wide' : ''}`}>
      <div className="agent-field-label-row">
        <span className="agent-field-label">
          {label}
          {required && (
            <span className="agent-field-required" aria-label={translate('agentsView.t123')}>
              *
            </span>
          )}
        </span>
        {badge && <span className="agent-field-badge">{badge}</span>}
        {counter && (
          <span className={`agent-field-counter${counter.current > counter.max ? ' over' : ''}`}>
            {counter.current} / {counter.max}
          </span>
        )}
      </div>
      {children}
      {hint && <div className="agent-field-hint">{hint}</div>}
    </div>
  )
}

function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="agent-section-header">
      <h2 className="agent-section-title">{title}</h2>
      {desc != null && <p className="agent-section-desc">{desc}</p>}
    </div>
  )
}

/**
 * 提示词（System Prompt）代码编辑器：
 *  - 头部：标题 + 全屏按钮
 *  - 主体：行号 + textarea，monospace，code 主题
 *  - 全屏：toggle 一个 className，CSS 用 fixed 定位撑满屏幕
 */
function PromptEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [fullscreen, setFullscreen] = useState(false)
  const lineCount = Math.max(1, value.split('\n').length)
  const lines = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount])
  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget
    const gutter = target.parentElement?.querySelector<HTMLDivElement>('.agent-prompt-gutter')
    if (gutter) gutter.scrollTop = target.scrollTop
  }, [])
  return (
    <div className={`agent-prompt-editor${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="agent-prompt-toolbar">
        <div className="agent-prompt-toolbar-title">
          <span>{translate('agentsView.t161')}</span>
          <span className="agent-prompt-toolbar-sub">System Prompt</span>
        </div>
        <div className="agent-prompt-toolbar-actions">
          <button
            type="button"
            className="agent-prompt-toolbar-btn"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? translate('agentsView.t76') : translate('agentsView.t77')}
          >
            <Icons.Maximize size={12} /> {fullscreen ? translate('agentsView.t78') : translate('agentsView.t79')}
          </button>
        </div>
      </div>
      <div className="agent-prompt-body">
        <div className="agent-prompt-gutter" aria-hidden="true">
          {lines.map((n) => (
            <div key={n} className="agent-prompt-line-no">
              {n}
            </div>
          ))}
        </div>
        <textarea
          className="agent-prompt-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          placeholder={translate('agentsView.t124Desc')}
        />
      </div>
    </div>
  )
}

function ConfigSection({
  title,
  count,
  description,
  actions,
  footer,
  children,
}: {
  title: string
  count?: number
  description?: string
  /** 头部右侧动作位（如「新增」入口），与标题同行、靠右对齐 */
  actions?: ReactNode
  /** 卡片底部链接 / 按钮 */
  footer?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="agent-config-section">
      <div className="agent-config-head">
        <div className="agent-config-head-main">
          <span className="agent-config-title">{title}</span>
          {count != null && <span className="agent-config-count">{count}</span>}
        </div>
        {actions != null && <div className="agent-config-actions">{actions}</div>}
      </div>
      {description != null && <p className="agent-config-desc">{description}</p>}
      {children}
      {footer != null && <div className="agent-config-footer">{footer}</div>}
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
  if (items.length === 0) return <div className="agents-empty-mini">{translate('agentsView.t162')}</div>
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
            title={blocked ? translate('agentsView.t80') : undefined}
            onClick={() =>
              onChange(active ? selected.filter((id) => id !== item.id) : [...selected, item.id])
            }
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
    isDefault: agent.isDefault,
    builtIn: agent.builtIn,
    providerProfileId: agent.providerProfileId ?? '',
    modelId: agent.modelId ?? '',
    agentAdapter: agent.agentAdapter,
    permissionMode: agent.permissionMode,
    reasoningEffort: normalizeReasoningEffort(agent.reasoningEffort),
    reasoningBudgetTokens:
      normalizeReasoningBudgetTokens(agent.metadata.reasoningBudgetTokens)?.toString() ?? '',
    prompt: agent.prompt,
    skillIds: agent.skillIds,
    mcpServerIds: agent.mcpServerIds,
    ruleIds: agent.ruleIds,
    hookConfig: normalizeAgentHookConfig(agent.hookConfig),
    workflowId: agent.workflowId ?? '',
    metadata: agent.metadata,
    avatar: getAgentAvatarConfig(agent.metadata, agent.id, agent.name),
  }
}

function getAgentModelOptions(
  provider: ProviderProfile | null | undefined,
): Array<{ label: string; value: string }> {
  if (provider == null) return []
  return getProviderModelOptions(provider).map((modelId) => ({
    label: modelId,
    value: modelId,
  }))
}

function draftToPayload(draft: AgentDraft, provider?: ProviderProfile | null) {
  const normalized = normalizeDraftForProvider(draft, provider)
  const metadata = { ...normalized.metadata }
  delete metadata.reasoningBudgetTokens
  const reasoningBudgetTokens = normalizeReasoningBudgetTokens(normalized.reasoningBudgetTokens)
  return {
    name: normalized.name.trim(),
    description: normalized.description.trim(),
    enabled: normalized.enabled,
    isDefault: normalized.isDefault,
    providerProfileId: normalized.providerProfileId || null,
    modelId: normalized.modelId || null,
    agentAdapter: normalized.agentAdapter,
    permissionMode: normalized.permissionMode,
    reasoningEffort: normalizeReasoningEffort(normalized.reasoningEffort),
    prompt: normalized.prompt,
    skillIds: normalized.skillIds,
    mcpServerIds: normalized.mcpServerIds,
    disabledSkillIds: [] as string[],
    ruleIds: normalized.ruleIds,
    hookConfig: normalized.hookConfig,
    workflowId: normalized.workflowId || null,
    metadata: {
      ...metadata,
      ...(reasoningBudgetTokens != null ? { reasoningBudgetTokens } : {}),
      avatar: normalizeDraftAvatar(normalized),
    },
  }
}

function normalizeDraftForProvider(
  draft: AgentDraft,
  provider: ProviderProfile | null | undefined,
): AgentDraft {
  if (provider == null) return draft
  const nextAdapter = getLockedAgentAdapterForProvider(provider) ?? draft.agentAdapter
  const nextPermissionMode = isPermissionModeAllowedForAdapter(draft.permissionMode, nextAdapter)
    ? draft.permissionMode
    : getDefaultPermissionMode(nextAdapter)
  const nextModelId = normalizeAgentModelForProvider(provider, draft.modelId)
  if (
    nextAdapter === draft.agentAdapter &&
    nextPermissionMode === draft.permissionMode &&
    nextModelId === draft.modelId
  ) {
    return draft
  }
  return {
    ...draft,
    agentAdapter: nextAdapter,
    permissionMode: nextPermissionMode,
    modelId: nextModelId,
  }
}

function normalizeDraftAvatar(draft: AgentDraft): SparkAvatarConfig {
  const config = draft.avatar
  if (config.kind === 'url' || config.kind === 'upload' || config.kind === 'builtin') return config
  return { kind: 'builtin', id: DEFAULT_AGENT_AVATAR_ID }
}

function normalizeAgentHookConfig(value: Record<string, unknown>): AgentHookConfig {
  const enabled = value.enabled === true
  const rawNodes =
    value.nodes != null && typeof value.nodes === 'object'
      ? (value.nodes as Record<string, unknown>)
      : {}
  const nodes = Object.fromEntries(
    HOOK_NODES.map((item) => {
      const raw = rawNodes[item.node]
      const record = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      return [
        item.node,
        { sound: record.sound !== false, notification: record.notification !== false },
      ]
    }),
  ) as AgentHookConfig['nodes']
  return { enabled, nodes }
}

const HOOK_NODES: Array<{ node: AgentHookNode; label: string }> = [
  { node: 'permission_request', label: translate('agentsView.t81') },
  { node: 'ask_user_question', label: translate('agentsView.t82') },
  { node: 'session_end', label: translate('agentsView.t83') },
  { node: 'session_fail', label: translate('agentsView.t84') },
]

const PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> = [
  { value: 'claude-ask', label: translate('agentsView.t85') },
  { value: 'claude-plan', label: translate('agentsView.t86') },
  { value: 'claude-auto', label: translate('agentsView.t87') },
  { value: 'claude-bypass', label: translate('agentsView.t88') },
]

const CODEX_PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> =
  SHARED_CODEX_PERMISSION_MODE_OPTIONS.map(({ value, label }) => ({ value, label }))

const SPARK_PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> =
  SHARED_SPARK_PERMISSION_MODE_OPTIONS.map(({ value, label }) => ({ value, label }))

function getPermissionOptions(
  adapter: SessionAgentAdapter,
): Array<{ value: SessionPermissionMode; label: string }> {
  if (adapter === 'codex') return CODEX_PERMISSION_OPTIONS
  if (adapter === 'spark') return SPARK_PERMISSION_OPTIONS
  return PERMISSION_OPTIONS
}

function getDefaultPermissionMode(adapter: SessionAgentAdapter): SessionPermissionMode {
  // 会话缺省权限档位：claude / codex 默认「自动」档，spark 维持手动审批。
  if (adapter === 'codex') return 'codex-auto-review'
  if (adapter === 'spark') return 'spark-default'
  return 'claude-auto'
}

function isPermissionModeAllowedForAdapter(
  mode: SessionPermissionMode,
  adapter: SessionAgentAdapter,
): boolean {
  return getPermissionOptions(adapter).some((option) => option.value === mode)
}

function getAgentAdapterLabel(adapter: SessionAgentAdapter): string {
  return adapter === 'codex' ? 'Codex' : 'Claude SDK'
}
