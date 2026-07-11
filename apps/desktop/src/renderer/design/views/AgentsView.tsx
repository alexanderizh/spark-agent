import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './AgentsView.less'
import { Icons } from '../Icons'
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
import { AvatarPicker } from '../components/AvatarPicker'
import { AvatarImage } from '../components/AvatarImage'
import { SkillsPickerModal } from '../components/SkillsPickerModal'
import { getAgentAvatarConfig, resolveAvatarSrc, type SparkAvatarConfig } from '../avatar'
import { DEFAULT_AGENT_AVATAR_ID } from '../builtinAvatars'
import { TeamsPanel } from './TeamsPanel'
import {
  AGENTS_TARGET_TAB_EVENT,
  AGENTS_TARGET_TAB_STORAGE_KEY,
  readAgentsTargetTab,
  type AgentsTargetTab,
} from '../teamNavigation'
import { countExistingRefs, resolveExistingRefs } from './agent-config-counts'
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
  ModelProfile,
  ProviderProfile,
  RuleItem,
  SessionAgentAdapter,
  SessionPermissionMode,
  SessionReasoningEffort,
  SkillItem,
  WorkspaceInfo,
  WorkflowItem,
} from '@spark/protocol'
import {
  isBuiltInLocalCliProvider,
  isAutoRouterProvider,
  isRoutingModelConfig,
} from '@spark/protocol'

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
  { value: 'all', label: '全部' },
  { value: 'mine', label: '我创建的' },
]

const STATUS_FILTER_OPTIONS: Array<{ value: AgentStatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
]

const SORT_OPTIONS: Array<{ value: AgentSortKey; label: string }> = [
  { value: 'updated-desc', label: '按更新时间' },
  { value: 'created-desc', label: '按创建时间' },
  { value: 'name-asc', label: '按名称' },
]

const adapterOptions = [
  { label: 'Claude SDK', value: 'claude-sdk' },
  { label: 'Codex', value: 'codex' },
]

const reasoningOptions = [
  { label: 'minimal', value: 'minimal' },
  { label: '低 · 更快、更省资源', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: '高 · 更强的推理与输出质量', value: 'high' },
  { label: 'xhigh', value: 'xhigh' },
  { label: 'max', value: 'max' },
]

/** 推理强度当前值的提示文案（控件下方灰色辅助说明） */
const REASONING_HINT: Record<SessionReasoningEffort, string> = {
  minimal: '最少推理，适合简单直接的任务',
  low: '较少推理，更快且更省资源',
  medium: '标准模式，速度优先',
  high: '更强的推理与输出质量',
  xhigh: '深度推理，适合复杂任务',
  max: '极限推理，最长思考时间',
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
  prompt: string
  skillIds: string[]
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
  name: '新 Agent',
  description: '',
  enabled: true,
  isDefault: false,
  builtIn: false,
  providerProfileId: '',
  modelId: '',
  agentAdapter: 'claude-sdk',
  permissionMode: 'claude-ask',
  reasoningEffort: 'medium',
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
  const { registerNavGuard, requestConfirm, setTweak, setHasUnsavedChanges } = useApp()
  const sessionSidebar = useSessionSidebar()
  const { handleNewSession, setActiveSession, workspaces, refreshData } = sessionSidebar
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [modelCards, setModelCards] = useState<ModelProfile[]>([])
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
  const { invoke: listModels } = useIpcInvoke('model:list')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { invoke: listMcp } = useIpcInvoke('mcp:list')
  const { invoke: listRules } = useIpcInvoke('rules:list')
  const { invoke: listWorkflows } = useIpcInvoke('workflow:list')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: getTempProjectDir } = useIpcInvoke('app:get-temp-project-dir')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [agentRes, providerRes, modelRes, skillRes, mcpRes, ruleRes, workflowRes] =
        await Promise.all([
          listAgents({ includeDisabled: true }),
          listProviders({}),
          listModels({}),
          listSkills({}),
          listMcp({}),
          listRules({}),
          listWorkflows({ includeArchived: true }),
        ])
      setAgents(agentRes.agents)
      onAgentsChange?.(agentRes.agents)
      setProviders(providerRes.profiles)
      setModelCards(modelRes.models)
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
  }, [
    listAgents,
    listMcp,
    listModels,
    listProviders,
    listRules,
    listSkills,
    listWorkflows,
    onAgentsChange,
  ])

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
        title: '放弃未保存的 Agent 修改？',
        description: '离开后，当前 Agent 编辑内容会恢复到上次保存的状态。',
        confirmText: '离开',
      })
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, requestConfirm])

  const selectedProvider = providers.find((p) => p.id === draft.providerProfileId)
  const lockedAdapter = getLockedAgentAdapterForProvider(selectedProvider)
  const effectiveAgentAdapter = lockedAdapter ?? draft.agentAdapter
  const modelOptions = useMemo(
    () => getAgentModelOptions(selectedProvider, modelCards),
    [modelCards, selectedProvider],
  )
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
        title: '放弃未保存的修改？',
        description: '新建 Agent 会清空当前编辑区的未保存内容。',
        confirmText: '新建',
      })
      if (!confirmed) return
    }
    createDraft()
  }

  const handleSave = async () => {
    const payload = draftToPayload(draft, selectedProvider)
    if (!payload.name.trim()) {
      toast.warning('Agent 名称不能为空')
      return
    }
    const saved =
      draft.id != null
        ? (await updateAgent({ id: draft.id, ...payload })).agent
        : (await createAgent(payload)).agent
    toast.success('Agent 配置已保存')
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

  const handleCardCopy = async (agent: ManagedAgent) => {
    try {
      const provider = providers.find((item) => item.id === (agent.providerProfileId ?? ''))
      const cloned = normalizeDraftForProvider(agentToDraft(agent), provider)
      const payload = draftToPayload(
        { ...cloned, name: `${agent.name} 副本`, isDefault: false },
        provider,
      )
      await createAgent(payload)
      toast.success(`已复制「${agent.name}」`)
      await refresh()
    } catch {
      toast.error(`复制「${agent.name}」失败`)
    }
  }

  const handleCardDelete = async (agent: ManagedAgent) => {
    if (agent.builtIn) return
    const confirmed = await requestConfirm({
      title: `删除 Agent「${agent.name}」？`,
      description: '此操作不可撤销，删除后该 Agent 将从会话选择器中移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      const res = await deleteAgent({ id: agent.id })
      if (!res.deleted) {
        toast.warning('删除失败')
        return
      }
      toast.success('Agent 已删除')
      await refresh()
    } catch {
      toast.error(`删除「${agent.name}」失败`)
    }
  }

  const handleCardToggle = async (agent: ManagedAgent) => {
    try {
      await updateAgent({ id: agent.id, enabled: !agent.enabled })
      toast.success(agent.enabled ? `已停用「${agent.name}」` : `已启用「${agent.name}」`)
      await refresh()
    } catch {
      toast.error(agent.enabled ? `停用「${agent.name}」失败` : `启用「${agent.name}」失败`)
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
      toast.success(`已将「${agent.name}」设为默认`)
      await refresh()
    } catch {
      toast.error(`设为默认失败`)
    }
  }

  const handleExportAgent = async (agent: ManagedAgent) => {
    try {
      const res = await exportAgentsToFile({ ids: [agent.id] })
      if (res.filePath) {
        toast.success(`已导出「${agent.name}」到 ${res.filePath}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
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
          toast.success(`已进入「${agent.name}」的新会话`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建会话失败')
      } finally {
        setQuickChatBusy(false)
      }
    },
    [handleNewSession, setActiveSession, setTweak, toast],
  )

  const handleQuickChatPickPath = useCallback(async () => {
    try {
      const selected = await openDirectoryDialog({ title: '选择项目文件夹' })
      if (selected.canceled || selected.filePath == null) return
      const filePath = selected.filePath
      setQuickChatProjectPath(filePath)
      setQuickChatProjectName((prev) => prev.trim() || getPathBasename(filePath))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '选择项目文件夹失败')
    }
  }, [openDirectoryDialog, toast])

  const handleQuickChatCreateProject = useCallback(async () => {
    if (quickChatAgent == null) return
    const name = quickChatProjectName.trim() || getPathBasename(quickChatProjectPath.trim())
    if (!name) {
      toast.warning('请先输入项目名称')
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
        toast.success(`已在新项目中启动「${quickChatAgent.name}」`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建项目失败')
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
        toast.success(`已导出 ${res.count} 个 Agent 到 ${res.filePath}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }

  const handleExportSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.warning('请先选择要导出的 Agent')
      return
    }
    try {
      const res = await exportAgentsToFile({ ids })
      if (res.filePath) {
        toast.success(`已导出 ${res.count} 个 Agent 到 ${res.filePath}`)
        setSelectedIds(new Set())
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) {
      toast.warning('请先选择要删除的 Agent')
      return
    }
    // 内置 Agent 不可删除，过滤掉
    const deletable = agents.filter((a) => selectedIds.has(a.id) && !a.builtIn)
    if (deletable.length === 0) {
      toast.warning('选中的均为内置 Agent，无法删除')
      return
    }
    const confirmed = await requestConfirm({
      title: `删除 ${deletable.length} 个 Agent？`,
      description: '此操作不可撤销，选中的 Agent 将从会话选择器中移除。',
      confirmText: '批量删除',
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
    if (ok > 0) toast.success(`已删除 ${ok} 个 Agent`)
    if (errs.length > 0) {
      toast.error(`${errs.length} 个删除失败：${errs.slice(0, 2).join('；')}`)
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
          mcpServerIds: agent.mcpServerIds,
          ruleIds: agent.ruleIds,
          hookConfig: agent.hookConfig,
          workflowId: agent.workflowId,
          metadata: agent.metadata,
        })
        imported++
      }

      if (imported > 0) {
        toast.success(
          `已导入 ${imported} 个 Agent${skipped > 0 ? `，跳过 ${skipped} 个同名 Agent` : ''}`,
        )
        await refresh()
      } else if (skipped > 0) {
        toast.warning(`所有 ${skipped} 个 Agent 名称已存在，已跳过`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
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
        <div className="agents-home">
          <div className="agents-home-head">
            <div className="agents-home-title-block">
              <div className="agents-home-title-row">
                <h1 className="agents-home-title">Agent 管理</h1>
                <button type="button" className="agents-home-help" title="了解更多">
                  <Icons.HelpCircle size={14} />
                </button>
              </div>
              <div className="agents-home-subtitle">管理和配置你的智能体，让 AI 更好地为你服务</div>
            </div>
            <div className="agents-home-tools">
              <LobeInput
                size="middle"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Agent..."
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
                创建 Agent
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
                    {SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? '按更新时间'}
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
                      '全部状态'}
                  </span>
                  <Icons.ChevronDown size={12} />
                </button>
              </Dropdown>
              <Button
                size="middle"
                type="text"
                onClick={() => void refresh()}
                disabled={loading}
                title="刷新"
                icon={loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />}
              />
              {visibleAgents.length > 0 && (
                <Button
                  size="middle"
                  type={selectionMode ? 'primary' : 'text'}
                  onClick={selectionMode ? exitSelectionMode : enterSelectionMode}
                  icon={<Icons.CheckSquare size={12} />}
                >
                  {selectionMode ? '退出选择' : '选择'}
                </Button>
              )}
              <Button
                size="middle"
                type="text"
                onClick={() => void handleImport()}
                icon={<Icons.Upload size={12} />}
              >
                导入
              </Button>
              <Button
                size="middle"
                type="text"
                onClick={() => void handleExportAll()}
                icon={<Icons.Download size={12} />}
              >
                导出全部
              </Button>
            </div>
          </div>

          {loading && visibleAgents.length === 0 ? (
            <div className="agents-loading-state" role="status" aria-live="polite">
              <Icons.Spinner size={24} />
              <div className="agents-loading-title">正在加载 Agent…</div>
              <div className="agents-loading-desc">同步模型、工具、技能和工作流配置</div>
            </div>
          ) : visibleAgents.length > 0 ? (
            <>
              {selectionMode && selectedIds.size > 0 && (
                <div className="agents-selectbar" role="region" aria-label="批量操作">
                  <span className="agents-selectbar-count">已选 {selectedIds.size} 个</span>
                  <span className="agents-selectbar-spacer" />
                  <Button
                    size="middle"
                    type="text"
                    onClick={
                      selectedIds.size === visibleAgents.length ? clearSelection : selectAllVisible
                    }
                  >
                    {selectedIds.size === visibleAgents.length ? '取消全选' : '全选当前'}
                  </Button>
                  <Button size="middle" type="text" onClick={clearSelection}>
                    清空选择
                  </Button>
                  <Button
                    size="middle"
                    type="primary"
                    danger
                    onClick={() => void handleDeleteSelected()}
                    icon={<Icons.Trash size={12} />}
                  >
                    删除选中
                  </Button>
                  <Button
                    size="middle"
                    type="primary"
                    onClick={() => void handleExportSelected()}
                    icon={<Icons.Download size={12} />}
                  >
                    导出选中
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
                    mcpServers={mcpServers}
                    rules={rules}
                    selected={selectedIds.has(agent.id)}
                    selectionMode={selectionMode}
                    onToggleSelect={() => toggleSelect(agent.id)}
                    onOpen={() => openAgent(agent)}
                    onQuickChat={() => handleQuickChat(agent)}
                    onExport={() => void handleExportAgent(agent)}
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
                    ? `没有匹配「${searchQuery}」的 Agent`
                    : filterTab === 'mine'
                      ? '还没有创建过 Agent'
                      : '创建第一个 Agent'}
                </div>
                <div className="agents-empty-desc">
                  {searchQuery
                    ? '试试更换关键词，或切换到「全部」标签'
                    : '智能体可在对话中选择，配置独立的模型、提示词、工具和工作流。'}
                </div>
                {!searchQuery && (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      onClick={() => void handleNew()}
                      icon={<Icons.Plus size={12} />}
                    >
                      创建 Agent
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
          title="返回列表"
          icon={<Icons.ArrowLeft size={12} />}
        >
          列表
        </Button>
        <div className="agents-detail-title">
          {draft.id ? draft.name : '新建 Agent'}
          {dirty && <span className="agent-dirty-badge">已编辑未保存</span>}
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
            删除
          </Button>
        )}
        <Button
          size="middle"
          type="primary"
          onClick={() => void handleSave()}
          icon={<Icons.Check size={12} />}
        >
          保存
        </Button>
      </div>

      <div className="agents-detail-grid">
        <section className="agent-editor-main">
          {/* ── Section: 基本信息 ── */}
          <SectionHeader
            title="基本信息"
            desc={
              draft.builtIn
                ? '内置 Agent 可调整提示词和运行配置，但不可删除。'
                : '自定义 Agent 会出现在对话输入栏的 Agent 选择器中。'
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
              label="名称"
              required
              counter={{ current: draft.name.length, max: AGENT_NAME_MAX }}
            >
              <LobeInput
                value={draft.name}
                maxLength={AGENT_NAME_MAX}
                placeholder="为这个 Agent 起个名字"
                onChange={(e) => updateDraft('name', e.target.value)}
              />
            </Field>

            <Field label="状态">
              <div className="agent-status-row">
                <Switch
                  checked={draft.enabled}
                  onChange={(checked: boolean) => updateDraft('enabled', checked)}
                />
                <span className="agent-status-text">{draft.enabled ? '启用' : '停用'}</span>
              </div>
              <div className="agent-field-hint">禁用后，Agent 将无法被选择和使用</div>
            </Field>

            <Field
              label="描述"
              required
              wide
              counter={{ current: draft.description.length, max: AGENT_DESC_MAX }}
            >
              <LobeTextArea
                value={draft.description}
                maxLength={AGENT_DESC_MAX}
                rows={3}
                placeholder="用一句话描述这个 Agent 的能力和使用场景"
                onChange={(e) => updateDraft('description', e.target.value)}
              />
            </Field>

            <Field label="默认 Agent">
              <div className="agent-status-row">
                <Switch
                  checked={draft.isDefault}
                  onChange={(checked: boolean) => updateDraft('isDefault', checked)}
                />
                <span className="agent-status-text">
                  {draft.isDefault ? '已设为默认' : '设为默认'}
                </span>
              </div>
              <div className="agent-field-hint">
                {draft.isDefault ? '新会话默认选择此 Agent' : '未设为默认'}
              </div>
            </Field>
          </div>

          {/* ── Section: 执行配置 ── */}
          <div className="agent-section-divider" />
          <SectionHeader
            title="执行配置"
            desc="模型、执行器、权限、推理强度与工作流，决定 Agent 怎么运行。"
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
                  { label: '跟随会话', value: '' },
                  ...providers.map((p) => ({ label: p.name, value: p.id })),
                ]}
                style={agentSelectStyle}
              />
            </Field>
            <Field
              label="执行器 (SDK)"
              badge={
                effectiveAgentAdapter === 'claude-sdk' ? (
                  <span className="agent-badge-soft">推荐</span>
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
              label="默认模型"
              hint={
                selectedProvider && !allowModelOverride
                  ? '本地 CLI 直接沿用宿主机实际配置，这里不再单独覆盖模型。'
                  : undefined
              }
            >
              {selectedProvider && !allowModelOverride ? (
                <LobeInput value="跟随本地 CLI" readOnly disabled />
              ) : (
                <LobeSelect
                  value={draft.modelId}
                  onChange={(value) => updateDraft('modelId', String(value))}
                  options={[{ label: 'Provider 默认', value: '' }, ...modelOptions]}
                  style={agentSelectStyle}
                />
              )}
            </Field>
            <Field label="权限">
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
            <Field label="推理强度" hint={REASONING_HINT[draft.reasoningEffort]}>
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
              label="工作流"
              hint={
                activeWorkflow
                  ? `已绑定：${activeWorkflow.name} · ${activeWorkflow.graph.nodes.length} 节点 · ${activeWorkflow.status}`
                  : '未绑定工作流，Agent 会按普通编码流程执行'
              }
            >
              <LobeSelect
                value={draft.workflowId}
                onChange={(value) => updateDraft('workflowId', String(value))}
                options={[
                  { label: '不使用工作流', value: '' },
                  ...workflows.map((w) => ({ label: w.name, value: w.id })),
                ]}
                style={agentSelectStyle}
              />
            </Field>
            <div className="agent-form-grid-wide">
              <PromptEditor
                value={draft.prompt}
                onChange={(next) => updateDraft('prompt', next)}
                onToast={(msg) => toast.info(msg)}
              />
            </div>
          </div>
        </section>

        <aside className="agent-config-panel">
          <ConfigSection
            title="Skills"
            count={countExistingRefs(draft.skillIds, skills)}
            description="配置该 Agent 可使用的 Skills"
            footer={
              <button
                type="button"
                className="agent-config-link"
                onClick={() => setShowSkillPicker(true)}
              >
                <Icons.Skills size={12} /> 管理 Skills
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
                <div className="agent-config-empty">尚未选择 Skill</div>
              )
            })()}
          </ConfigSection>

          <ConfigSection
            title="MCP 服务"
            count={countExistingRefs(draft.mcpServerIds, mcpServers)}
            description="扩展 Agent 的外部能力"
            footer={
              <button type="button" className="agent-config-link">
                <Icons.Wrench size={12} /> 配置 MCP
              </button>
            }
          >
            {mcpServers.length > 0 ? (
              <PickList
                items={mcpServers.map((s) => ({ id: s.id, label: s.name }))}
                selected={draft.mcpServerIds}
                onChange={(ids) => updateDraft('mcpServerIds', ids)}
              />
            ) : (
              <div className="agent-config-empty">暂无可用 MCP 服务</div>
            )}
          </ConfigSection>

          <ConfigSection
            title="规则"
            count={countExistingRefs(draft.ruleIds, rules)}
            description="约束 Agent 的行为与输出"
            footer={
              <button type="button" className="agent-config-link">
                <Icons.Shield size={12} /> 管理规则
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
              <div className="agent-config-empty">暂无可用规则</div>
            )}
          </ConfigSection>

          <ConfigSection
            title="Hook"
            count={draft.hookConfig.enabled ? 1 : 0}
            description="在特定事件触发 Agent 专属逻辑"
            footer={
              <button type="button" className="agent-config-link">
                <Icons.Bell size={12} /> 配置 Hook
              </button>
            }
          >
            <HookEditor value={draft.hookConfig} onChange={(c) => updateDraft('hookConfig', c)} />
          </ConfigSection>

          <ConfigSection
            title="高级设置"
            description="更多个性化配置"
            interactive
            onActivate={() => toast.info('更多高级设置（即将推出）')}
          >
            <div className="agent-config-advanced">
              <Icons.ChevronRight size={14} />
            </div>
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
      displayName: '临时会话',
      label: (
        <div className="agents-quickchat-option">
          <span className="agents-quickchat-option-name">
            <Icons.Chat size={13} />
            <span>临时会话</span>
          </span>
          <span className="agents-quickchat-option-path">不切到已有项目，直接进入临时目录会话</span>
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
            <div className="agents-quickchat-kicker">快速对话</div>
            <div className="agents-quickchat-title">先选项目，再进入「{agent.name}」</div>
          </div>
          <button
            type="button"
            className="agents-quickchat-close"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭快速对话项目选择器"
          >
            <Icons.X size={14} />
          </button>
        </div>

        <div className="agents-quickchat-body">
          <div className="agents-quickchat-section">
            <div className="agents-quickchat-section-title">选择工作区</div>
            <Select
              className="agents-quickchat-select"
              value={selectedValue}
              onChange={handleSelectChange}
              disabled={busy}
              placeholder="选择已有项目或使用临时会话"
              optionLabelProp="displayName"
              optionFilterProp="displayName"
              showSearch
              options={selectOptions}
              notFoundContent={projects.length === 0 ? '还没有可用项目，可直接新建' : '没有匹配项'}
              popupMatchSelectWidth
            />
            {projects.length === 0 && (
              <div className="agents-quickchat-empty">
                还没有可用项目，可以直接使用下方「新建项目」表单。
              </div>
            )}
          </div>

          <div className="agents-quickchat-divider" />

          <div className="agents-quickchat-section">
            <div className="agents-quickchat-section-title">新建项目后进入会话</div>
            <label className="agents-quickchat-field">
              <span>项目名称</span>
              <LobeInput
                value={projectName}
                placeholder="输入项目名称"
                onChange={(event) => onProjectNameChange(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="agents-quickchat-field">
              <span>项目目录（可选）</span>
              <div className="agents-quickchat-path-row">
                <LobeInput
                  value={projectPath}
                  placeholder="留空则自动使用临时目录"
                  onChange={(event) => onProjectPathChange(event.target.value)}
                  disabled={busy}
                />
                <Button size="middle" type="text" onClick={onPickProjectPath} disabled={busy}>
                  选择目录
                </Button>
              </div>
            </label>
          </div>
        </div>

        <div className="agents-quickchat-actions">
          <Button size="middle" type="text" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="middle" type="primary" onClick={onCreateProject} loading={busy}>
            创建项目并进入
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
  mcpServers: McpServerItem[]
  rules: RuleItem[]
  selected: boolean
  selectionMode: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onQuickChat: () => void
  onExport: () => void
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
  mcpServers,
  rules,
  selected,
  selectionMode,
  onToggleSelect,
  onOpen,
  onQuickChat,
  onExport,
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
    agent.modelId?.trim() ||
    provider?.defaultModel ||
    provider?.modelIds[0] ||
    (agent.agentAdapter === 'codex' ? 'Codex' : 'Claude')
  const skillCount = countExistingRefs(agent.skillIds, skills)
  const mcpCount = countExistingRefs(agent.mcpServerIds, mcpServers)
  const ruleCount = countExistingRefs(agent.ruleIds, rules)
  const hasMetaTags =
    agent.isDefault || skillCount > 0 || mcpCount > 0 || workflow != null || ruleCount > 0

  const menuItems = {
    items: [
      {
        key: 'chat',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Chat size={14} /> 快速对话
          </span>
        ),
        onClick: () => onQuickChat(),
      },
      {
        key: 'export',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Download size={14} /> 导出
          </span>
        ),
        onClick: () => onExport(),
      },
      {
        key: 'copy',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Copy size={14} /> 复制
          </span>
        ),
        onClick: () => onCopy(),
      },
      {
        key: 'edit',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Edit size={14} /> 编辑
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
                  <Icons.Trash size={14} /> 删除
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
          title={selected ? '取消选择' : '选择'}
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
              {agent.enabled ? '启用' : '停用'}
            </span>
          </div>
          <div className="agents-card-desc">
            {agent.description || (agent.builtIn ? '内置 Agent' : '自定义 Agent')}
          </div>
        </div>
        {hasMetaTags && (
          <div className="agents-card-meta">
            <div className="agents-card-tags">
              {agent.isDefault && <span className="agents-card-tag default-tag">默认</span>}
              {skillCount > 0 && (
                <span className="agents-card-tag" title="Skills">
                  <Icons.Skills size={10} />
                  {skillCount} Skills
                </span>
              )}
              {mcpCount > 0 && (
                <span className="agents-card-tag" title="MCP">
                  <Icons.MCP size={10} />
                  {mcpCount} MCP
                </span>
              )}
              {workflow && (
                <span className="agents-card-tag" title={workflow.name}>
                  <Icons.Workflow size={10} />
                  工作流
                </span>
              )}
              {ruleCount > 0 && (
                <span className="agents-card-tag" title="规则">
                  <Icons.Filter size={10} />
                  {ruleCount} 规则
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
            title={agent.enabled ? '停用' : '启用'}
            onClick={onToggle}
          />
          {!agent.isDefault && (
            <ActionIcon
              icon={Icons.Star}
              size="small"
              variant="borderless"
              title="设为默认"
              onClick={onSetDefault}
            />
          )}
          <ActionIcon
            icon={Icons.Download}
            size="small"
            variant="borderless"
            title="导出"
            onClick={onExport}
          />
          <ActionIcon
            icon={Icons.Copy}
            size="small"
            variant="borderless"
            title="复制"
            onClick={onCopy}
          />
          {!agent.builtIn && (
            <ActionIcon
              icon={Icons.Trash}
              size="small"
              variant="borderless"
              danger
              title="删除"
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
  // 在一些 select / popover / date-picker 控件里会导致下拉/弹窗"点不出来"。
  return (
    <div className={`agent-field ${wide ? 'wide' : ''}`}>
      <div className="agent-field-label-row">
        <span className="agent-field-label">
          {label}
          {required && (
            <span className="agent-field-required" aria-label="必填">
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
 *  - 头部：标题 + 模板/优化/全屏 按钮（视觉对齐参考图，模板/优化为占位，全屏为真实 toggle）
 *  - 主体：行号 + textarea，monospace，code 主题
 *  - 全屏：toggle 一个 className，CSS 用 fixed 定位撑满屏幕
 */
function PromptEditor({
  value,
  onChange,
  onToast,
}: {
  value: string
  onChange: (next: string) => void
  onToast: (msg: string) => void
}) {
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
          <span>提示词</span>
          <span className="agent-prompt-toolbar-sub">System Prompt</span>
        </div>
        <div className="agent-prompt-toolbar-actions">
          <button
            type="button"
            className="agent-prompt-toolbar-btn"
            onClick={() => onToast('模板库即将推出')}
            title="从模板库选择"
          >
            <Icons.Book size={12} /> 模板
          </button>
          <button
            type="button"
            className="agent-prompt-toolbar-btn"
            onClick={() => onToast('提示词优化即将推出')}
            title="AI 优化提示词"
          >
            <Icons.Sparkles size={12} /> 优化
          </button>
          <button
            type="button"
            className="agent-prompt-toolbar-btn"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? '退出全屏' : '全屏编辑'}
          >
            <Icons.Maximize size={12} /> {fullscreen ? '退出' : '全屏'}
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
          placeholder="为这个 Agent 写一份系统提示词…"
        />
      </div>
    </div>
  )
}

function ConfigSection({
  title,
  count,
  description,
  footer,
  interactive,
  onActivate,
  children,
}: {
  title: string
  count?: number
  description?: string
  /** 卡片底部链接 / 按钮 */
  footer?: ReactNode
  /** 整张卡片可点击（用于「高级设置」导航卡） */
  interactive?: boolean
  onActivate?: () => void
  children?: ReactNode
}) {
  return (
    <section
      className={`agent-config-section${interactive ? ' is-interactive' : ''}`}
      onClick={interactive ? onActivate : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="agent-config-head">
        <span className="agent-config-title">{title}</span>
        {count != null && <span className="agent-config-count">{count}</span>}
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
  modelCards: ModelProfile[],
): Array<{ label: string; value: string }> {
  if (provider == null) return []
  const providerModels = getProviderModelOptions(provider).map((modelId) => ({
    label: modelId,
    value: modelId,
  }))
  const routeModels = modelCards
    .filter(
      (model) =>
        isAutoRouterProvider(provider) &&
        model.enabled &&
        model.providerId === provider.id &&
        isRoutingModelCard(model),
    )
    .map((model) => ({ label: model.name, value: model.id }))
  return [...providerModels, ...routeModels]
}

function isRoutingModelCard(model: ModelProfile): boolean {
  try {
    const parsed = JSON.parse(model.configJson) as unknown
    return isRoutingModelConfig(parsed)
  } catch {
    return false
  }
}

function draftToPayload(draft: AgentDraft, provider?: ProviderProfile | null) {
  const normalized = normalizeDraftForProvider(draft, provider)
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
    disabledSkillIds: [] as string[],
    mcpServerIds: normalized.mcpServerIds,
    ruleIds: normalized.ruleIds,
    hookConfig: normalized.hookConfig,
    workflowId: normalized.workflowId || null,
    metadata: {
      ...normalized.metadata,
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

function HookEditor({
  value,
  onChange,
}: {
  value: AgentHookConfig
  onChange: (v: AgentHookConfig) => void
}) {
  const patchNode = (
    node: AgentHookNode,
    patch: Partial<AgentHookConfig['nodes'][AgentHookNode]>,
  ) => {
    onChange({ ...value, nodes: { ...value.nodes, [node]: { ...value.nodes[node], ...patch } } })
  }
  return (
    <div className="agent-hook-editor">
      <LobeCheckbox
        checked={value.enabled}
        onChange={(checked) => onChange({ ...value, enabled: checked })}
      >
        启用 Agent 专属 Hook
      </LobeCheckbox>
      {HOOK_NODES.map((item) => (
        <div key={item.node} className="agent-hook-row">
          <span>{item.label}</span>
          <LobeCheckbox
            checked={value.nodes[item.node].sound}
            onChange={(checked) => patchNode(item.node, { sound: checked })}
          >
            声音
          </LobeCheckbox>
          <LobeCheckbox
            checked={value.nodes[item.node].notification}
            onChange={(checked) => patchNode(item.node, { notification: checked })}
          >
            通知
          </LobeCheckbox>
        </div>
      ))}
    </div>
  )
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
  { node: 'permission_request', label: '权限请求' },
  { node: 'ask_user_question', label: '用户提问' },
  { node: 'session_end', label: '任务完成' },
  { node: 'session_fail', label: '任务失败' },
]

const PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> = [
  { value: 'claude-ask', label: '请求批准' },
  { value: 'claude-plan', label: '计划模式' },
  { value: 'claude-auto', label: '自动审批' },
  { value: 'claude-bypass', label: '完全访问' },
]

const CODEX_PERMISSION_OPTIONS: Array<{ value: SessionPermissionMode; label: string }> = [
  { value: 'codex-default', label: 'Codex 默认' },
  { value: 'codex-auto-review', label: 'Codex 自动审查' },
  { value: 'codex-full-access', label: 'Codex 完全访问' },
]

function getPermissionOptions(
  adapter: SessionAgentAdapter,
): Array<{ value: SessionPermissionMode; label: string }> {
  return adapter === 'codex' ? CODEX_PERMISSION_OPTIONS : PERMISSION_OPTIONS
}

function getDefaultPermissionMode(adapter: SessionAgentAdapter): SessionPermissionMode {
  return adapter === 'codex' ? 'codex-default' : 'claude-ask'
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
