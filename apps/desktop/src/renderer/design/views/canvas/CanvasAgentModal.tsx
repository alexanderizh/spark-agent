/**
 * 画布 Agent 对话弹窗
 *
 * 当前策略：
 *   - 只把 canvas project / board id 作为首轮绑定信息注入，避免把 snapshot 文本塞进 prompt；
 *   - 每轮显式激活 builtin:canvas-studio，让 agent 通过实时画布工具拿最新状态；
 *   - 会话级支持附加 Skills，但强制保留 canvas-studio；
 *   - 支持 Claude SDK / Codex 运行时，权限固定为对应 bypass/full-access；
 *   - 面板支持边框拖拽缩放，消息渲染复用常规会话的 Markdown 能力。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Dropdown } from 'antd'
import type {
  AgentEvent,
  ManagedAgent,
  ProviderProfile,
  SessionAgentAdapter,
  SessionAttachment,
  SessionListResponse,
  SessionPermissionMode,
} from '@spark/protocol'
import { Button, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AvatarImage } from '../../components/AvatarImage'
import { ProviderLogo } from '../../components/ProviderLogo'
import { ChatPanel, type ChatPanelNodeReference } from '../../components/ChatPanel'
import { SkillsPickerModal, type SkillItemForPicker } from '../../components/SkillsPickerModal'
import { getAgentAvatarConfig, hasCustomAvatar, resolveAvatarSrc } from '../../avatar'
import { useCanvasToolHost } from './canvas-tool-host'
import './CanvasAgentPicker.less'
import type { CanvasToolHostOptions } from './canvas-tool-host'
import {
  getProviderAdapterKind,
  getPreferredProviderForAdapter,
  isProviderCompatibleWithAdapter,
} from '../../utils/provider-adapter'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'
import { buildSelectedNodesContext } from './canvasAgentContextBuilder'
import {
  buildCanvasAgentModelOptions,
  getCanvasAgentProviderModels,
  resolveCanvasAgentModelSelection,
  resolveCanvasAgentProviderModel,
} from './canvas-agent-model-options'

interface Props {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  /** 当前选中节点：每轮注入会话上下文，让 agent 能用 node id 定位用户所指节点 */
  selectedNodes: CanvasNode[]
  /** 画布 store actions（由 CanvasWorkspaceView 把 useCanvasWorkspace 结果传入） */
  workspace: CanvasToolHostOptions['workspace']
  /** 用户显式「添加到 Agent 对话」的引用节点；为空时不注入节点上下文 */
  nodeRefs: CanvasNode[]
  /** 移除单个引用节点 */
  onRemoveNodeRef?: (nodeId: string) => void
  /** 清空全部引用节点 */
  onClearNodeRefs?: () => void
  /** 宽屏切换回调：父组件据此时将侧栏宽度设为屏幕一半 / 恢复原宽 */
  onWideModeChange?: (wide: boolean) => void
}

type CanvasAgentComposerMenu = 'session' | 'agent' | 'model'
type CanvasAgentResizeHandle = 'top' | 'left' | 'right' | 'top-left' | 'top-right'
type SkillSummary = SkillItemForPicker
type CanvasAgentSessionSummary = SessionListResponse['sessions'][number]
type CanvasAgentProjectCache = {
  sessionId?: string | undefined
  firstTurnSent?: boolean
  draftAgentId?: string
  draftAdapter?: SessionAgentAdapter
  draftProviderId?: string
  draftModelId?: string
  selectedExtraSkillIds?: string[]
}

const REQUIRED_CANVAS_SKILL_ID = 'builtin:canvas-studio'
const DEFAULT_CANVAS_AGENT_ID = 'canvas-assistant-agent'
const FALLBACK_CANVAS_AGENT_ID = 'platform-manager-agent'
const CANVAS_AGENT_PREFS_KEY = 'spark-agent:canvas-agent-composer-prefs'
const DEFAULT_PANEL_WIDTH = 760
const DEFAULT_PANEL_HEIGHT = 560
const MIN_PANEL_WIDTH = 560
const MAX_PANEL_WIDTH = 1120
const MIN_PANEL_HEIGHT = 360
const MAX_PANEL_HEIGHT = 820
type ComposerDropdownPlacement = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
const CANVAS_AGENT_ADAPTER_OPTIONS: Array<{ value: SessionAgentAdapter; label: string }> = [
  { value: 'claude-sdk', label: 'Claude SDK' },
  { value: 'codex', label: 'Codex' },
]
const CANVAS_AGENT_ADAPTER_LABELS: Record<SessionAgentAdapter, string> = {
  'claude-sdk': 'Claude SDK',
  claude: 'Claude API',
  codex: 'Codex',
}

function normalizeCanvasAdapter(
  adapter: SessionAgentAdapter | null | undefined,
): SessionAgentAdapter {
  return adapter === 'codex' ? 'codex' : 'claude-sdk'
}

function readCanvasAgentPrefs(): Omit<CanvasAgentProjectCache, 'sessionId' | 'firstTurnSent'> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CANVAS_AGENT_PREFS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as Partial<CanvasAgentProjectCache>
    if (parsed == null || typeof parsed !== 'object') return {}
    return {
      ...(typeof parsed.draftAgentId === 'string' && parsed.draftAgentId.length > 0
        ? { draftAgentId: parsed.draftAgentId }
        : {}),
      ...(parsed.draftAdapter === 'codex' || parsed.draftAdapter === 'claude-sdk'
        ? { draftAdapter: parsed.draftAdapter }
        : {}),
      ...(typeof parsed.draftProviderId === 'string'
        ? { draftProviderId: parsed.draftProviderId }
        : {}),
      ...(typeof parsed.draftModelId === 'string' ? { draftModelId: parsed.draftModelId } : {}),
      ...(Array.isArray(parsed.selectedExtraSkillIds)
        ? {
            selectedExtraSkillIds: parsed.selectedExtraSkillIds.filter(
              (skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0,
            ),
          }
        : {}),
    }
  } catch {
    return {}
  }
}

function writeCanvasAgentPrefs(
  patch: Omit<CanvasAgentProjectCache, 'sessionId' | 'firstTurnSent'>,
): void {
  if (typeof window === 'undefined') return
  try {
    const current = readCanvasAgentPrefs()
    const next = { ...current, ...patch }
    window.localStorage.setItem(CANVAS_AGENT_PREFS_KEY, JSON.stringify(next))
  } catch {
    // Local preference persistence is best effort.
  }
}

const CANVAS_AGENT_DRAFTS_KEY = 'spark-agent:canvas-agent-input-drafts'

function readCanvasAgentDrafts(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CANVAS_AGENT_DRAFTS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed == null || typeof parsed !== 'object') return {}
    const drafts: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') drafts[key] = value
    }
    return drafts
  } catch {
    return {}
  }
}

function readCanvasAgentDraft(projectId: string): string {
  return readCanvasAgentDrafts()[projectId] ?? ''
}

function writeCanvasAgentDraft(projectId: string, text: string): void {
  if (typeof window === 'undefined') return
  try {
    const drafts = readCanvasAgentDrafts()
    if (text.length === 0) {
      delete drafts[projectId]
    } else {
      drafts[projectId] = text
    }
    const keys = Object.keys(drafts)
    if (keys.length === 0) {
      window.localStorage.removeItem(CANVAS_AGENT_DRAFTS_KEY)
    } else {
      window.localStorage.setItem(CANVAS_AGENT_DRAFTS_KEY, JSON.stringify(drafts))
    }
  } catch {
    // 草稿持久化是 best effort，失败不影响输入
  }
}

function pickCanvasAgent(
  agents: ManagedAgent[],
  preferredId: string | null | undefined,
): ManagedAgent | null {
  return (
    (preferredId != null ? agents.find((agent) => agent.id === preferredId) : undefined) ??
    agents.find((agent) => agent.id === DEFAULT_CANVAS_AGENT_ID) ??
    agents.find((agent) => agent.id === FALLBACK_CANVAS_AGENT_ID) ??
    agents[0] ??
    null
  )
}

/** provider → 展示用 vendor（用于 ProviderLogo 图标） */
function resolveProviderVendor(provider: ProviderProfile | undefined) {
  if (provider == null) return null
  return {
    id: provider.provider,
    name: provider.name,
    emoji: (provider.name[0] ?? '?').toUpperCase(),
    color: 'var(--text-faint)',
    desc: '',
    logoPath: '',
  }
}

function getCanvasPermissionMode(adapter: SessionAgentAdapter): SessionPermissionMode {
  return adapter === 'codex' ? 'codex-full-access' : 'claude-bypass'
}

function resolveProviderModel(
  provider: ProviderProfile,
  preferredModelId: string | undefined,
): string {
  return resolveCanvasAgentProviderModel(provider, preferredModelId)
}

function clampPanelWidth(width: number): number {
  return Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width)))
}

function clampPanelHeight(height: number): number {
  return Math.round(Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, height)))
}

function buildCanvasBindingMessage(
  snapshot: CanvasSnapshot,
  text: string,
  selectedNodes: CanvasNode[] = [],
): string {
  const nodesContext = buildSelectedNodesContext(selectedNodes)
  return [
    '[画布绑定]',
    `canvasProjectId: ${snapshot.project.id}`,
    `activeBoardId: ${snapshot.activeBoardId ?? snapshot.board.id}`,
    '',
    `当前会话已启用 ${REQUIRED_CANVAS_SKILL_ID}。`,
    '不要依赖聊天里的旧画布描述；每次需要查看或修改画布时，先调用画布工具获取最新状态。',
    '',
    nodesContext ? `---\n${nodesContext}\n---` : '---',
    '',
    text,
  ].join('\n')
}

function summarizeCanvasContext(snapshot: CanvasSnapshot): string {
  return `${snapshot.project.title} · ${snapshot.board.name} · ${snapshot.nodes.length} 节点 / ${snapshot.assets.length} 资产 / ${snapshot.tasks.length} 任务`
}

function formatCanvasSessionDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getCanvasSessionLabel(
  session: CanvasAgentSessionSummary | undefined,
  fallback = '新建会话',
): string {
  const title = session?.title?.trim()
  return title && title.length > 0 ? title : fallback
}

function useComposerDropdownPlacement(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  estimatedMenuHeight: number,
  estimatedMenuWidth: number,
): ComposerDropdownPlacement {
  const [placement, setPlacement] = useState<ComposerDropdownPlacement>('bottomLeft')

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') return
    const anchor = ref.current
    if (anchor == null) return

    const updatePlacement = () => {
      const gutter = 12
      const rect = anchor.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const availableLeft = rect.right - gutter
      const availableRight = viewportWidth - rect.left - gutter
      const availableTop = rect.top - gutter
      const availableBottom = viewportHeight - rect.bottom - gutter
      const horizontal: 'Left' | 'Right' =
        availableRight >= estimatedMenuWidth || availableRight >= availableLeft ? 'Left' : 'Right'
      const vertical: 'top' | 'bottom' =
        availableBottom >= estimatedMenuHeight || availableBottom >= availableTop ? 'bottom' : 'top'
      setPlacement(`${vertical}${horizontal}` as ComposerDropdownPlacement)
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [estimatedMenuHeight, estimatedMenuWidth, open, ref])

  return placement
}

export function CanvasAgentModal({
  open,
  onClose,
  snapshot,
  selectedNodes,
  workspace,
  nodeRefs,
  onRemoveNodeRef,
  onClearNodeRefs,
  onWideModeChange,
}: Props) {
  const projectId = snapshot.project.id
  const [fullscreen, setFullscreen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [projectSessions, setProjectSessions] = useState<CanvasAgentSessionSummary[]>([])
  const projectWorkspaceIdRef = useRef<string | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([])
  const [draftAgentId, setDraftAgentId] = useState<string>(DEFAULT_CANVAS_AGENT_ID)
  const [draftAdapter, setDraftAdapter] = useState<SessionAgentAdapter>('claude-sdk')
  const [draftProviderId, setDraftProviderId] = useState<string>('')
  const [draftModelId, setDraftModelId] = useState<string>('')
  const [selectedExtraSkillIds, setSelectedExtraSkillIds] = useState<string[]>([])
  const [skillPickerDraft, setSkillPickerDraft] = useState<string[]>([])
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState(false)
  const [openMenu, setOpenMenu] = useState<CanvasAgentComposerMenu | null>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT)
  const [resizing, setResizing] = useState(false)
  const firstTurnRef = useRef(true)
  const manualSessionChoiceRef = useRef(false)
  const appliedRuntimeSessionRef = useRef<string | null>(null)
  const sessionCacheRef = useRef<Map<string, CanvasAgentProjectCache>>(new Map())
  const [draftInput, setDraftInput] = useState(() => readCanvasAgentDraft(projectId))
  // 渲染期同步最新值，供防抖/卸载 flush 取值，避免 closure 陷阱
  const draftPersistRef = useRef({ projectId, draftInput })
  draftPersistRef.current = { projectId, draftInput }
  const prevProjectIdRef = useRef(projectId)

  useCanvasToolHost({
    sessionId,
    projectId: snapshot.project.id,
    getSnapshot: useCallback(() => snapshot, [snapshot]),
    workspace,
  })

  const activeAgent = useMemo(() => pickCanvasAgent(agents, draftAgentId), [agents, draftAgentId])
  const adapter = draftAdapter
  const forcedPermissionMode = useMemo(() => getCanvasPermissionMode(adapter), [adapter])
  const selectedProvider = useMemo(() => {
    const hit = providers.find((provider) => provider.id === draftProviderId)
    if (hit) return hit
    return getPreferredProviderForAdapter(providers, undefined, adapter)
  }, [providers, draftProviderId, adapter])
  const modelOptions = useMemo(
    () => getCanvasAgentProviderModels(selectedProvider),
    [selectedProvider],
  )
  const effectiveModelId = useMemo(() => {
    if (modelOptions.includes(draftModelId)) return draftModelId
    return selectedProvider?.defaultModel ?? modelOptions[0] ?? ''
  }, [draftModelId, modelOptions, selectedProvider])
  const effectiveSkillIds = useMemo(
    () =>
      Array.from(
        new Set([
          REQUIRED_CANVAS_SKILL_ID,
          ...selectedExtraSkillIds.filter((skillId) => skillId !== REQUIRED_CANVAS_SKILL_ID),
        ]),
      ),
    [selectedExtraSkillIds],
  )
  const selectableSkills = useMemo(
    () => availableSkills.filter((skill) => skill.id !== REQUIRED_CANVAS_SKILL_ID),
    [availableSkills],
  )
  const contextSummary = useMemo(() => summarizeCanvasContext(snapshot), [snapshot])
  const fallbackAssistant = useMemo(
    () => ({
      agentId: activeAgent?.id ?? draftAgentId,
      agentName: activeAgent?.name ?? '画布助手',
    }),
    [activeAgent, draftAgentId],
  )
  const panelStyle = useMemo<CSSProperties | undefined>(
    () =>
      fullscreen
        ? undefined
        : {
            width: panelWidth,
            height: panelHeight,
          },
    [fullscreen, panelHeight, panelWidth],
  )

  const syncSessionSkills = useCallback(async (sid: string, skillIds: string[]) => {
    await window.spark.invoke('skill-config:update', {
      scope: 'session',
      scopeRef: sid,
      skillIds,
      disabledSkillIds: [],
    })
  }, [])

  const applySessionRuntimeDraft = useCallback(
    (session: CanvasAgentSessionSummary) => {
      setDraftAgentId(session.agentId || DEFAULT_CANVAS_AGENT_ID)
      const nextAdapter = normalizeCanvasAdapter(session.agentAdapter)
      setDraftAdapter(nextAdapter)
      const sessionProvider = providers.find(
        (provider) => provider.id === session.providerProfileId,
      )
      if (sessionProvider && isProviderCompatibleWithAdapter(sessionProvider, nextAdapter)) {
        setDraftProviderId(sessionProvider.id)
        setDraftModelId(resolveProviderModel(sessionProvider, session.modelId ?? undefined))
        return
      }
      const fallbackProvider = getPreferredProviderForAdapter(providers, undefined, nextAdapter)
      if (fallbackProvider) {
        setDraftProviderId(fallbackProvider.id)
        setDraftModelId(resolveProviderModel(fallbackProvider, undefined))
      }
    },
    [providers],
  )

  const refreshProjectSessions = useCallback(async () => {
    const rootPath = snapshot.project.rootPath
    if (!rootPath) {
      setProjectSessions([])
      return
    }
    setSessionsLoading(true)
    try {
      const wsRes = await window.spark.invoke('workspace:open', { rootPath })
      const workspaceId = wsRes.workspace.id
      projectWorkspaceIdRef.current = workspaceId
      const sessionRes = await window.spark.invoke('session:list', {
        workspaceId,
        includeArchived: false,
        limit: 50,
      })
      setProjectSessions(sessionRes.sessions)
    } catch (err) {
      console.warn('加载画布项目会话失败', err)
      setProjectSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [snapshot.project.rootPath])

  const updateProjectCache = useCallback(
    (patch: CanvasAgentProjectCache) => {
      const current = sessionCacheRef.current.get(projectId) ?? {}
      sessionCacheRef.current.set(projectId, { ...current, ...patch })
    },
    [projectId],
  )

  useEffect(() => {
    const prevId = prevProjectIdRef.current
    if (prevId !== projectId) {
      // 切项目：先 flush 旧项目未落盘草稿（此时 closure 的 draftInput 仍是旧项目值）
      writeCanvasAgentDraft(prevId, draftInput)
      prevProjectIdRef.current = projectId
    }
    const cached = sessionCacheRef.current.get(projectId)
    const prefs = readCanvasAgentPrefs()
    manualSessionChoiceRef.current = false
    appliedRuntimeSessionRef.current = null
    setSessionId(cached?.sessionId ?? null)
    setProjectSessions([])
    setDraftAgentId(prefs.draftAgentId ?? cached?.draftAgentId ?? DEFAULT_CANVAS_AGENT_ID)
    setDraftAdapter(normalizeCanvasAdapter(prefs.draftAdapter ?? cached?.draftAdapter))
    setDraftProviderId(prefs.draftProviderId ?? cached?.draftProviderId ?? '')
    setDraftModelId(prefs.draftModelId ?? cached?.draftModelId ?? '')
    setSelectedExtraSkillIds(prefs.selectedExtraSkillIds ?? cached?.selectedExtraSkillIds ?? [])
    setDraftInput(readCanvasAgentDraft(projectId))
    setRunning(false)
    firstTurnRef.current = cached?.firstTurnSent !== true
    setError(null)
    // draftInput 用于切项目时 flush 旧项目草稿，故不放入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 草稿防抖落盘（300ms），用 ref 取最新值避免 closure 陷阱
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeCanvasAgentDraft(draftPersistRef.current.projectId, draftPersistRef.current.draftInput)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [draftInput, projectId])

  // 卸载时 flush 最新草稿（离开画布工作区等场景）
  useEffect(() => {
    return () => {
      writeCanvasAgentDraft(draftPersistRef.current.projectId, draftPersistRef.current.draftInput)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refreshProjectSessions()
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingConfig(true)
    setError(null)
    void (async () => {
      try {
        const [agentRes, providerRes, skillRes] = await Promise.all([
          window.spark.invoke('agent:list', { includeDisabled: false }),
          window.spark.invoke('provider:list', {}),
          window.spark.invoke('skill:list', {}),
        ])
        if (cancelled) return
        const loadedAgents = (agentRes as { agents?: ManagedAgent[] }).agents ?? []
        const loadedProviders = (providerRes as { profiles?: ProviderProfile[] }).profiles ?? []
        const loadedSkills = ((skillRes as { skills?: SkillSummary[] }).skills ?? []).map(
          (skill) => ({
            id: skill.id,
            name: skill.name,
            enabled: Boolean(skill.enabled),
          }),
        )
        setAgents(loadedAgents)
        setProviders(loadedProviders)
        setAvailableSkills(loadedSkills)
        const cached = sessionCacheRef.current.get(projectId)
        const prefs = readCanvasAgentPrefs()

        const preferredAgentId = prefs.draftAgentId ?? cached?.draftAgentId
        const restoredAgent = pickCanvasAgent(loadedAgents, preferredAgentId)
        const restoredAgentId = restoredAgent?.id ?? DEFAULT_CANVAS_AGENT_ID
        const preferredProviderId = prefs.draftProviderId ?? cached?.draftProviderId
        const cachedProvider =
          preferredProviderId != null
            ? loadedProviders.find((provider) => provider.id === preferredProviderId)
            : null
        const restoredAdapterSource =
          prefs.draftAdapter ??
          cached?.draftAdapter ??
          (cachedProvider != null
            ? getProviderAdapterKind(cachedProvider)
            : restoredAgent?.agentAdapter)
        const restoredAdapter = normalizeCanvasAdapter(restoredAdapterSource)
        setDraftAgentId(restoredAgentId)
        setDraftAdapter(restoredAdapter)

        const compatible = loadedProviders.filter((provider) =>
          isProviderCompatibleWithAdapter(provider, restoredAdapter),
        )
        const preferred = getPreferredProviderForAdapter(
          compatible,
          preferredProviderId,
          restoredAdapter,
        )
        if (preferred) {
          const providerId = preferred.id
          const modelId = resolveProviderModel(
            preferred,
            preferredProviderId === preferred.id
              ? (prefs.draftModelId ?? cached?.draftModelId)
              : undefined,
          )
          setDraftProviderId(providerId)
          setDraftModelId(modelId)
        } else {
          setDraftProviderId('')
          setDraftModelId('')
        }
        setSelectedExtraSkillIds(
          (prefs.selectedExtraSkillIds ?? cached?.selectedExtraSkillIds ?? []).filter((skillId) =>
            loadedSkills.some(
              (skill) => skill.id === skillId && skillId !== REQUIRED_CANVAS_SKILL_ID,
            ),
          ),
        )

        if (loadedProviders.length === 0) {
          setError('未配置任何模型供应商，请先到「Providers」中添加。')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载配置失败')
        }
      } finally {
        if (!cancelled) setLoadingConfig(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (open) return
    setFullscreen(false)
    setOpenMenu(null)
    setSkillPickerOpen(false)
    setSkillPickerDraft([])
    setResizing(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (sessionId == null) return
    const unsubscribe = window.spark.on('stream:session:agent-event', (event: AgentEvent) => {
      const evt = event as { sessionId?: string; type?: string; status?: string }
      if (evt.sessionId !== sessionId) return
      if (evt.type === 'agent_status') {
        if (evt.status === 'running' || evt.status === 'thinking') {
          setRunning(true)
        } else if (
          evt.status === 'completed' ||
          evt.status === 'cancelled' ||
          evt.status === 'error'
        ) {
          setRunning(false)
        }
      }
    })
    return unsubscribe
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    const unsubscribeCreated = window.spark.on('stream:session:created', (payload) => {
      const created = payload.session
      if (
        created == null ||
        created.archivedAt != null ||
        !created.workspaceIds.includes(projectWorkspaceIdRef.current ?? '')
      ) return
      setProjectSessions((current) => [
        created,
        ...current.filter((session) => session.id !== created.id),
      ])
    })
    const unsubscribeRenamed = window.spark.on(
      'stream:session:renamed',
      (payload: { sessionId: string; title: string }) => {
        setProjectSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId ? { ...session, title: payload.title } : session,
          ),
        )
      },
    )
    const unsubscribeAgentEvent = window.spark.on(
      'stream:session:agent-event',
      (event: AgentEvent) => {
        if (event.type !== 'agent_status') return
        const status = (event as { status?: string }).status
        const terminal = status === 'completed' || status === 'cancelled' || status === 'error'
        const running = status === 'running' || status === 'thinking' || status === 'waiting_user'
        if (!terminal && !running) return
        setProjectSessions((current) =>
          current.map((session) => {
            if (session.id !== event.sessionId) return session
            if (terminal)
              return session.status === 'running' ? { ...session, status: 'idle' } : session
            return session.status === 'running' ? session : { ...session, status: 'running' }
          }),
        )
      },
    )
    return () => {
      unsubscribeCreated()
      unsubscribeRenamed()
      unsubscribeAgentEvent()
    }
  }, [open, refreshProjectSessions])

  useEffect(() => {
    if (sessionId == null) return
    void syncSessionSkills(sessionId, effectiveSkillIds).catch(() => {})
  }, [effectiveSkillIds, sessionId, syncSessionSkills])

  useEffect(() => {
    if (sessionId == null || providers.length === 0) return
    if (appliedRuntimeSessionRef.current === sessionId) return
    const selected = projectSessions.find((session) => session.id === sessionId)
    if (selected == null) return
    applySessionRuntimeDraft(selected)
    appliedRuntimeSessionRef.current = sessionId
  }, [applySessionRuntimeDraft, projectSessions, providers.length, sessionId])

  useEffect(() => {
    if (!open || sessionId != null || manualSessionChoiceRef.current) return
    const latest = projectSessions.find((session) => session.archivedAt == null)
    if (latest == null) return
    setSessionId(latest.id)
    setRunning(latest.status === 'running')
    firstTurnRef.current = (latest.turnCount ?? latest.messageCount) === 0
    applySessionRuntimeDraft(latest)
    appliedRuntimeSessionRef.current = providers.length > 0 ? latest.id : null
    updateProjectCache({
      sessionId: latest.id,
      firstTurnSent: (latest.turnCount ?? latest.messageCount) > 0,
    })
  }, [
    applySessionRuntimeDraft,
    open,
    projectSessions,
    providers.length,
    sessionId,
    updateProjectCache,
  ])

  useEffect(() => {
    updateProjectCache({
      ...(sessionId != null ? { sessionId } : {}),
      firstTurnSent: !firstTurnRef.current,
      draftAgentId,
      draftAdapter,
      draftProviderId,
      draftModelId,
      selectedExtraSkillIds,
    })
    writeCanvasAgentPrefs({
      draftAgentId,
      draftAdapter,
      draftProviderId,
      draftModelId,
      selectedExtraSkillIds,
    })
  }, [
    draftAgentId,
    draftAdapter,
    draftModelId,
    draftProviderId,
    projectId,
    selectedExtraSkillIds,
    sessionId,
    updateProjectCache,
  ])

  const handleSelectSession = useCallback(
    (nextSessionId: string | null) => {
      if (running || creating) return
      manualSessionChoiceRef.current = true
      setOpenMenu(null)
      setError(null)
      if (nextSessionId == null) {
        setSessionId(null)
        setRunning(false)
        appliedRuntimeSessionRef.current = null
        firstTurnRef.current = true
        updateProjectCache({
          sessionId: undefined,
          firstTurnSent: false,
        })
        return
      }
      const selected = projectSessions.find((session) => session.id === nextSessionId)
      setSessionId(nextSessionId)
      setRunning(selected?.status === 'running')
      firstTurnRef.current = selected == null
        ? false
        : (selected.turnCount ?? selected.messageCount) === 0
      if (selected != null) {
        applySessionRuntimeDraft(selected)
        appliedRuntimeSessionRef.current = providers.length > 0 ? selected.id : null
        updateProjectCache({
          sessionId: selected.id,
          firstTurnSent: (selected.turnCount ?? selected.messageCount) > 0,
        })
      }
    },
    [
      applySessionRuntimeDraft,
      creating,
      projectSessions,
      providers.length,
      running,
      updateProjectCache,
    ],
  )

  useEffect(
    () => () => {
      document.body.classList.remove('canvas-agent-panel-resizing')
    },
    [],
  )

  const handleChangeAgent = useCallback(
    (agentId: string) => {
      const next = agents.find((agent) => agent.id === agentId)
      if (next == null) return
      setDraftAgentId(agentId)
      const nextAdapter = normalizeCanvasAdapter(next.agentAdapter)
      setDraftAdapter(nextAdapter)
      const compatible = providers.filter((provider) =>
        isProviderCompatibleWithAdapter(provider, nextAdapter),
      )
      const preferred = getPreferredProviderForAdapter(compatible, draftProviderId, nextAdapter)
      const modelId = preferred ? resolveProviderModel(preferred, draftModelId) : ''
      if (preferred) {
        setDraftProviderId(preferred.id)
        setDraftModelId(modelId)
      } else {
        setDraftProviderId('')
        setDraftModelId('')
      }
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', {
            sessionId: sessionId as never,
            agentId,
            agentAdapter: nextAdapter,
            permissionMode: getCanvasPermissionMode(nextAdapter),
            ...(preferred
              ? {
                  providerProfileId: preferred.id,
                  modelId,
                }
              : {}),
          })
          .catch(() => {})
      }
    },
    [agents, draftModelId, draftProviderId, providers, sessionId],
  )

  const handleChangeProviderModel = useCallback(
    (providerId: string, modelId: string) => {
      const selection = resolveCanvasAgentModelSelection({
        providers,
        providerId,
        modelId,
        fallbackAdapter: adapter,
      })
      const nextAdapter = normalizeCanvasAdapter(selection.adapter)
      const nextModelId = selection.modelId
      setDraftAdapter(nextAdapter)
      setDraftProviderId(selection.providerId)
      setDraftModelId(nextModelId)
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', {
            sessionId: sessionId as never,
            providerProfileId: selection.providerId,
            modelId: nextModelId,
            agentAdapter: nextAdapter,
            permissionMode: getCanvasPermissionMode(nextAdapter),
          })
          .catch(() => {})
      }
    },
    [adapter, providers, sessionId],
  )

  const openSkillsPicker = useCallback(() => {
    setOpenMenu(null)
    setSkillPickerDraft(selectedExtraSkillIds)
    setSkillPickerOpen(true)
  }, [selectedExtraSkillIds])

  const handleResizeStart = useCallback(
    (handle: CanvasAgentResizeHandle) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (fullscreen || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startY = event.clientY
      const startWidth = panelWidth
      const startHeight = panelHeight
      const body = document.body
      setResizing(true)
      body.classList.add('canvas-agent-panel-resizing')

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        const deltaY = moveEvent.clientY - startY
        if (handle === 'left' || handle === 'top-left') {
          setPanelWidth(clampPanelWidth(startWidth - deltaX))
        }
        if (handle === 'right' || handle === 'top-right') {
          setPanelWidth(clampPanelWidth(startWidth + deltaX))
        }
        if (handle === 'top' || handle === 'top-left' || handle === 'top-right') {
          setPanelHeight(clampPanelHeight(startHeight - deltaY))
        }
      }

      const handlePointerUp = () => {
        setResizing(false)
        body.classList.remove('canvas-agent-panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [fullscreen, panelHeight, panelWidth],
  )

  const handleSend = useCallback(
    async (text: string, attachments: SessionAttachment[]) => {
      const rootPath = snapshot.project.rootPath
      if (!rootPath) {
        throw new Error('画布项目未关联目录，无法启动 agent。请先保存项目到磁盘。')
      }
      if (selectedProvider == null || effectiveModelId.length === 0) {
        throw new Error('请先选择供应商和模型。')
      }

      try {
        setCreating(true)
        let sid = sessionId
        const isFirst = sid == null
        if (sid == null) {
          const wsRes = await window.spark.invoke('workspace:open', { rootPath })
          const sessionRes = await window.spark.invoke('session:create', {
            providerProfileId: selectedProvider.id,
            workspaceId: wsRes.workspace.id,
            modelId: effectiveModelId,
            agentId: draftAgentId,
            agentAdapter: adapter,
            permissionMode: forcedPermissionMode,
            chatMode: 'agent',
            title: `画布助手 · ${snapshot.project.title}`,
          })
          sid = sessionRes.sessionId
          if (sessionRes.session != null) {
            setProjectSessions((current) => [
              sessionRes.session,
              ...current.filter((session) => session.id !== sessionRes.session.id),
            ])
          } else {
            await refreshProjectSessions()
          }
          setSessionId(sid)
          updateProjectCache({
            sessionId: sid,
            firstTurnSent: false,
          })
        }

        await syncSessionSkills(sid as string, effectiveSkillIds)

        let message = text
        // 以用户显式引用的节点为准（右键「添加到 Agent 对话」）；为空时不注入节点上下文
        const nodesContext = buildSelectedNodesContext(nodeRefs)
        if (isFirst && firstTurnRef.current) {
          firstTurnRef.current = false
          updateProjectCache({
            sessionId: sid as string,
            firstTurnSent: true,
          })
          message = buildCanvasBindingMessage(snapshot, text, nodeRefs)
        } else if (nodesContext) {
          // 后续轮：有引用节点时注入，让 agent 能用 node id 定位用户所指节点
          message = `${nodesContext}\n\n---\n\n${text}`
        }

        await window.spark.invoke('session:submit-turn', {
          sessionId: sid as never,
          message,
          ...(attachments.length > 0 ? { attachments } : {}),
          providerProfileId: selectedProvider.id,
          modelId: effectiveModelId,
          agentId: draftAgentId,
          agentAdapter: adapter,
          permissionMode: forcedPermissionMode,
          skillId: REQUIRED_CANVAS_SKILL_ID,
        })
      } finally {
        setCreating(false)
      }
    },
    [
      adapter,
      draftAgentId,
      effectiveModelId,
      effectiveSkillIds,
      forcedPermissionMode,
      updateProjectCache,
      refreshProjectSessions,
      selectedProvider,
      nodeRefs,
      sessionId,
      snapshot,
      syncSessionSkills,
    ],
  )

  const selectedProjectSession = useMemo(
    () => projectSessions.find((session) => session.id === sessionId),
    [projectSessions, sessionId],
  )

  // 头部会话选择器（单独渲染在标题与操作按钮之间）
  const headerSessionPicker = (
    <SessionPickerInline
      sessions={projectSessions}
      selectedSessionId={sessionId}
      loading={sessionsLoading}
      disabled={running || creating}
      open={openMenu === 'session'}
      onOpenChange={(nextOpen) => setOpenMenu(nextOpen ? 'session' : null)}
      onChange={handleSelectSession}
    />
  )

  // 底部参数行：Agent / 模型 / 技能选择器
  const composerBelowBar = (
    <>
      <AgentPickerInline
        agents={agents}
        selectedId={draftAgentId}
        fallbackLabel="画布助手"
        disabled={running || creating}
        open={openMenu === 'agent'}
        onOpenChange={(nextOpen) => setOpenMenu(nextOpen ? 'agent' : null)}
        onChange={handleChangeAgent}
      />
      <ProviderModelPickerInline
        providers={providers}
        selectedProviderId={selectedProvider?.id ?? ''}
        selectedModelId={effectiveModelId}
        disabled={running || creating}
        open={openMenu === 'model'}
        onOpenChange={(nextOpen) => setOpenMenu(nextOpen ? 'model' : null)}
        onChange={handleChangeProviderModel}
      />
      <SkillPickerInline
        count={effectiveSkillIds.length}
        extraCount={selectedExtraSkillIds.length}
        disabled={running || creating}
        onClick={openSkillsPicker}
      />
    </>
  )

  return (
    <section
      className={`canvas-bottom-floating-panel canvas-agent-panel canvas-agent-side-panel-inner${!open ? ' is-collapsed' : ''}${fullscreen ? ' is-fullscreen' : ''}${resizing ? ' is-resizing' : ''}`}
      style={panelStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {!fullscreen && (
        <>
          <div
            className="canvas-agent-resize-handle canvas-agent-resize-handle-top"
            onPointerDown={handleResizeStart('top')}
          />
          <div
            className="canvas-agent-resize-handle canvas-agent-resize-handle-left"
            onPointerDown={handleResizeStart('left')}
          />
          <div
            className="canvas-agent-resize-handle canvas-agent-resize-handle-right"
            onPointerDown={handleResizeStart('right')}
          />
          <div
            className="canvas-agent-resize-handle canvas-agent-resize-handle-top-left"
            onPointerDown={handleResizeStart('top-left')}
          />
          <div
            className="canvas-agent-resize-handle canvas-agent-resize-handle-top-right"
            onPointerDown={handleResizeStart('top-right')}
          />
        </>
      )}

      <div className="canvas-bottom-floating-head canvas-agent-head-minimal">
        
        <div className="canvas-agent-head-composer">{headerSessionPicker}</div>
        <div className="canvas-agent-head-actions">
          <Tooltip title={fullscreen ? '恢复宽度' : '展开到半屏'}>
            <Button
              size="small"
              type="text"
              icon={fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
              aria-label={fullscreen ? '恢复宽度' : '展开到半屏'}
              onClick={() => setFullscreen((current) => {
                const next = !current
                onWideModeChange?.(next)
                return next
              })}
            />
          </Tooltip>
          <Button
            size="small"
            type="text"
            icon={<Icons.X size={14} />}
            aria-label="关闭画布 Agent 助手"
            onClick={onClose}
          />
        </div>
      </div>

      <div className="canvas-agent-modal">
        <ChatPanel
          sessionId={sessionId}
          loading={loadingConfig}
          error={error}
          onSend={handleSend}
          initialInput={draftInput}
          onDraftChange={setDraftInput}
          composerBelow={composerBelowBar}
          agents={agents}
          fallbackAssistant={fallbackAssistant}
          persistedSessionStatus={selectedProjectSession?.status ?? null}
          contextBadge={
            <>
              <Icons.Layers size={12} />
              <span title={contextSummary}>
                {snapshot.project.title} · {snapshot.board.name}
                {nodeRefs.length > 0 && ` · 已引用 ${nodeRefs.length} 节点`}
              </span>
            </>
          }
          nodeReferences={nodeRefs.map((node) => {
            const ref: ChatPanelNodeReference = { id: node.id, type: node.type }
            if (node.title) ref.title = node.title
            return ref
          })}
          {...(onRemoveNodeRef ? { onRemoveNodeReference: onRemoveNodeRef } : {})}
          {...(onClearNodeRefs ? { onClearNodeReferences: onClearNodeRefs } : {})}
          emptyState={
            <>
              <Icons.Sparkles size={32} />
              <p>选好 Agent、模型和附加 Skills 后发送消息，agent 会通过实时画布工具操作项目</p>
              <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                试试：「先读取当前画板摘要，再列出第一幕相关节点」「为第一幕创建 3
                个镜头片段」「生成一张赛博朋克风格的角色定妆图并插入画布」
              </p>
            </>
          }
          placeholder="输入消息，让 agent 操作画布..."
          toolNamePrefixFilter="mcp__spark_canvas__"
          hideToolCalls
          hideToolInputOutput
        />
      </div>

      <SkillsPickerModal
        visible={skillPickerOpen}
        skills={selectableSkills}
        selectedIds={skillPickerDraft}
        onChange={(ids) => setSkillPickerDraft(ids)}
        onConfirm={() => {
          setSelectedExtraSkillIds(skillPickerDraft)
          setSkillPickerOpen(false)
        }}
        onClose={() => {
          setSkillPickerDraft(selectedExtraSkillIds)
          setSkillPickerOpen(false)
        }}
      />
    </section>
  )
}

function CanvasAdapterIcon({ adapter }: { adapter: SessionAgentAdapter }) {
  if (adapter === 'claude' || adapter === 'claude-sdk') {
    return (
      <svg
        className="adapter-brand-icon adapter-brand-claude"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M12 5.4v13.2M7.3 7.3l9.4 9.4M5.4 12h13.2M7.3 16.7l9.4-9.4" />
        <path d="M9.1 5.9l5.8 12.2M5.9 14.9l12.2-5.8M5.9 9.1l12.2 5.8M9.1 18.1l5.8-12.2" />
      </svg>
    )
  }
  return (
    <svg className="adapter-brand-icon adapter-brand-codex" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <path
        className="codex-cloud"
        d="M8.5 8.4c.9-2.1 4.2-2.7 5.7-.9 2.5-.2 4.1 1.4 4.1 3.5 0 2.4-1.8 4.1-4.4 4.1H8.8c-2 0-3.4-1.2-3.4-3 0-1.6 1.1-2.8 3.1-3.7Z"
      />
      <path className="codex-prompt" d="M9 10.2 10.8 12 9 13.8M12.5 14h3" />
    </svg>
  )
}

function SessionPickerInline({
  sessions,
  selectedSessionId,
  loading,
  disabled,
  open,
  onOpenChange,
  onChange,
}: {
  sessions: CanvasAgentSessionSummary[]
  selectedSessionId: string | null
  loading?: boolean
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (sessionId: string | null) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = sessions.find((session) => session.id === selectedSessionId)
  const menuHeight = Math.min(360, 72 + Math.max(sessions.length, 1) * 42)
  const placement = useComposerDropdownPlacement(rootRef, open, menuHeight, 300)
  const label = selected ? getCanvasSessionLabel(selected) : '新建会话'
  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      trigger={['click']}
      placement={placement}
      onOpenChange={(nextOpen) => {
        if (disabled) {
          onOpenChange(false)
          return
        }
        onOpenChange(nextOpen)
      }}
      popupRender={() => (
        <div className="composer-menu composer-session-menu">
          <div className="composer-menu-group-title">项目会话</div>
          <button
            type="button"
            className={`composer-menu-item canvas-session-new ${selectedSessionId == null ? 'active' : ''}`}
            onClick={() => {
              onOpenChange(false)
              onChange(null)
            }}
          >
            <span className="composer-menu-item-copy">
              <span className="composer-menu-item-label">
                <Icons.MessageSquarePlus size={13} />
                <span>新建会话</span>
              </span>
              <span className="composer-menu-item-desc">从空白上下文开始操作当前画布</span>
            </span>
            {selectedSessionId == null && <Icons.Check size={14} className="composer-menu-check" />}
          </button>
          <div className="composer-menu-divider" />
          {loading && <div className="composer-menu-empty">正在加载...</div>}
          {!loading && sessions.length === 0 && (
            <div className="composer-menu-empty">暂无项目会话</div>
          )}
          {!loading &&
            sessions.map((session) => {
              const active = session.id === selectedSessionId
              const date = formatCanvasSessionDate(session.updatedAt)
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`composer-menu-item canvas-session-item ${active ? 'active' : ''}`}
                  onClick={() => {
                    onOpenChange(false)
                    onChange(session.id)
                  }}
                >
                  <span className="composer-menu-item-copy">
                    <span className="composer-menu-item-label">
                      <Icons.MessageSquare size={13} />
                      <span>{getCanvasSessionLabel(session, '未命名会话')}</span>
                      {session.status === 'running' && (
                        <span className="composer-menu-item-tag">运行中</span>
                      )}
                    </span>
                    <span className="composer-menu-item-desc">
                      {session.messageCount} 条消息{date ? ` · ${date}` : ''}
                    </span>
                  </span>
                  {active && <Icons.Check size={14} className="composer-menu-check" />}
                </button>
              )
            })}
        </div>
      )}
    >
      <div
        ref={rootRef}
        className={`composer-select composer-session-picker${disabled ? ' is-disabled' : ''}`}
        title={disabled ? '会话运行中不可切换' : '项目会话'}
        style={{ ['--composer-menu-max-height' as string]: `${menuHeight}px` }}
      >
        <span className="composer-select-icon">
          {selected ? <Icons.MessageSquare size={13} /> : <Icons.MessageSquarePlus size={13} />}
        </span>
        <button type="button" className="composer-select-trigger" disabled={disabled}>
          <span>{loading && selected == null ? '加载会话...' : label}</span>
          <Icons.ChevronDown size={12} />
        </button>
      </div>
    </Dropdown>
  )
}

export function AdapterPickerInline({
  selectedAdapter,
  disabled,
  open,
  openOnHover = false,
  onOpenChange,
  onChange,
}: {
  selectedAdapter: SessionAgentAdapter
  disabled?: boolean
  open: boolean
  openOnHover?: boolean
  onOpenChange: (open: boolean) => void
  onChange: (adapter: SessionAgentAdapter) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const placement = useComposerDropdownPlacement(rootRef, open, 180, 220)
  const normalizedAdapter = normalizeCanvasAdapter(selectedAdapter)
  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      trigger={openOnHover ? ['hover'] : ['click']}
      placement={placement}
      onOpenChange={(nextOpen) => {
        if (disabled) {
          onOpenChange(false)
          return
        }
        onOpenChange(nextOpen)
      }}
      popupRender={() => (
        <div className="composer-menu composer-adapter-menu">
          <div className="composer-menu-group-title">运行时</div>
          {CANVAS_AGENT_ADAPTER_OPTIONS.map((option) => {
            const active = option.value === normalizedAdapter
            return (
              <button
                key={option.value}
                type="button"
                className={`composer-menu-item ${active ? 'active' : ''}`}
                onClick={() => {
                  onOpenChange(false)
                  onChange(option.value)
                }}
              >
                <span className="composer-menu-item-copy">
                  <span className="composer-menu-item-label">
                    <CanvasAdapterIcon adapter={option.value} />
                    <span>{option.label}</span>
                  </span>
                </span>
                {active && <Icons.Check size={14} className="composer-menu-check" />}
              </button>
            )
          })}
        </div>
      )}
    >
      <div
        ref={rootRef}
        className={`composer-select composer-adapter-picker${disabled ? ' is-disabled' : ''}`}
        title={disabled ? '会话运行中不可切换' : '运行时'}
      >
        <span className="composer-select-icon">
          <CanvasAdapterIcon adapter={normalizedAdapter} />
        </span>
        <button
          type="button"
          className="composer-select-trigger"
          disabled={disabled}
          onClick={() => {
            if (openOnHover) onOpenChange(true)
          }}
        >
          <span>{CANVAS_AGENT_ADAPTER_LABELS[normalizedAdapter]}</span>
          <Icons.ChevronDown size={12} />
        </button>
      </div>
    </Dropdown>
  )
}

export function AgentPickerInline({
  agents,
  selectedId,
  disabled,
  fallbackLabel = '平台管理',
  open,
  openOnHover = false,
  onOpenChange,
  onChange,
}: {
  agents: ManagedAgent[]
  selectedId: string
  disabled?: boolean
  fallbackLabel?: string
  open: boolean
  openOnHover?: boolean
  onOpenChange: (open: boolean) => void
  onChange: (agentId: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = agents.find((agent) => agent.id === selectedId)
  const placement = useComposerDropdownPlacement(rootRef, open, 320, 280)
  const menuHeight = Math.min(360, 52 + agents.length * 44)
  const triggerIcon =
    selected && hasCustomAvatar(selected.metadata) ? (
      <AvatarImage
        className="composer-agent-picker-avatar"
        src={resolveAvatarSrc(getAgentAvatarConfig(selected.metadata, selected.id, selected.name))}
        seed={selected.id}
        name={selected.name}
        alt={`${selected.name} 头像`}
      />
    ) : selected?.builtIn ? (
      <Icons.Code size={11} />
    ) : (
      <Icons.Bot size={11} />
    )
  return (
    <Dropdown
      menu={{ items: [] }}
      overlayClassName="canvas-agent-picker-dropdown"
      open={open}
      trigger={openOnHover ? ['hover'] : ['click']}
      placement={placement}
      onOpenChange={(nextOpen) => {
        if (disabled || agents.length === 0) {
          onOpenChange(false)
          return
        }
        onOpenChange(nextOpen)
      }}
      popupRender={() => (
        <div className="composer-menu composer-agent-menu">
          <div className="composer-menu-group-title">选择 Agent</div>
          {agents.map((agent) => {
            const agentHasAvatar = hasCustomAvatar(agent.metadata)
            return (
              <button
                key={agent.id}
                type="button"
                className={`composer-menu-item ${agent.id === selectedId ? 'active' : ''}`}
                onClick={() => {
                  onOpenChange(false)
                  onChange(agent.id)
                }}
              >
                <span className="composer-menu-item-copy">
                  <span className="composer-menu-item-label">
                    {agentHasAvatar ? (
                      <AvatarImage
                        className="composer-menu-avatar"
                        src={resolveAvatarSrc(
                          getAgentAvatarConfig(agent.metadata, agent.id, agent.name),
                        )}
                        seed={agent.id}
                        name={agent.name}
                        alt={`${agent.name} 头像`}
                      />
                    ) : agent.builtIn ? (
                      <Icons.Code size={13} />
                    ) : (
                      <Icons.Bot size={13} />
                    )}
                    <span>{agent.name}</span>
                    {agent.builtIn && <span className="composer-menu-item-tag">内置</span>}
                  </span>
                  {agent.description && (
                    <span className="composer-menu-item-desc">{agent.description}</span>
                  )}
                </span>
                {agent.id === selectedId && (
                  <Icons.Check size={14} className="composer-menu-check" />
                )}
              </button>
            )
          })}
        </div>
      )}
    >
      <div
        ref={rootRef}
        className={`composer-select composer-agent-picker${disabled ? ' is-disabled' : ''}`}
        title={disabled ? '会话运行中不可切换' : 'Agent'}
        style={{ ['--composer-menu-max-height' as string]: `${menuHeight}px` }}
      >
        <span className="composer-select-icon">{triggerIcon}</span>
        <button
          type="button"
          className="composer-select-trigger"
          disabled={disabled || agents.length === 0}
          onClick={() => {
            if (openOnHover) onOpenChange(true)
          }}
        >
          <span>{selected?.name ?? fallbackLabel}</span>
          <Icons.ChevronDown size={12} />
        </button>
      </div>
    </Dropdown>
  )
}

export function ProviderModelPickerInline({
  providers,
  selectedProviderId,
  selectedModelId,
  disabled,
  open,
  openOnHover = false,
  onOpenChange,
  onChange,
}: {
  providers: ProviderProfile[]
  selectedProviderId: string
  selectedModelId: string
  disabled?: boolean
  open: boolean
  openOnHover?: boolean
  onOpenChange: (open: boolean) => void
  onChange: (providerId: string, modelId: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const vendor = resolveProviderVendor(selectedProvider)
  const label = selectedModelId || selectedProvider?.defaultModel || '选择模型'
  const modelGroups = useMemo(() => buildCanvasAgentModelOptions(providers), [providers])
  const menuHeight = Math.min(
    420,
    24 + modelGroups.reduce((sum, group) => sum + 36 + group.models.length * 34, 0),
  )
  const placement = useComposerDropdownPlacement(rootRef, open, menuHeight, 320)
  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      trigger={openOnHover ? ['hover'] : ['click']}
      placement={placement}
      onOpenChange={(nextOpen) => {
        if (disabled || providers.length === 0) {
          onOpenChange(false)
          return
        }
        onOpenChange(nextOpen)
      }}
      popupRender={() => (
        <div className="composer-menu composer-dropdown-menu composer-model-menu">
          {providers.length === 0 && <div className="composer-menu-empty">未配置</div>}
          {modelGroups.map(({ provider, models }) => {
            const groupVendor = resolveProviderVendor(provider)
            return (
              <div key={provider.id} className="composer-model-group">
                <div className="composer-model-group-title">
                  {groupVendor && (
                    <span className="composer-model-group-icon">
                      <ProviderLogo vendor={groupVendor} size={14} shape="rounded" />
                    </span>
                  )}
                  <span>{provider.name}</span>
                </div>
                {models.map(({ modelId, label: modelLabel }) => {
                  const active = provider.id === selectedProviderId && modelId === selectedModelId
                  return (
                    <button
                      key={`${provider.id}:${modelId}`}
                      type="button"
                      className={`composer-menu-item ${active ? 'active' : ''}`}
                      onClick={() => {
                        onOpenChange(false)
                        onChange(provider.id, modelId)
                      }}
                    >
                      <span>{modelLabel}</span>
                      {active && <Icons.Check size={14} className="composer-menu-check" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    >
      <div
        ref={rootRef}
        className={`composer-select composer-model-picker${disabled ? ' is-disabled' : ''}`}
        title={disabled ? '会话运行中不可切换' : '供应商模型'}
        style={{ ['--composer-menu-max-height' as string]: `${menuHeight}px` }}
      >
        <span className="composer-select-icon">
          {vendor ? (
            <ProviderLogo vendor={vendor} size={16} shape="circle" />
          ) : (
            <Icons.Sparkles size={11} />
          )}
        </span>
        <button
          type="button"
          className="composer-select-trigger"
          disabled={disabled || providers.length === 0}
          onClick={() => {
            if (openOnHover) onOpenChange(true)
          }}
        >
          <span>{label}</span>
          <Icons.ChevronDown size={12} />
        </button>
      </div>
    </Dropdown>
  )
}

function SkillPickerInline({
  count,
  extraCount,
  disabled,
  onClick,
}: {
  count: number
  extraCount: number
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <div
      className={`composer-select composer-skill-picker${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : '附加 Skills'}
    >
      <span className="composer-select-icon">
        <Icons.Skills size={13} />
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled}
        onClick={onClick}
      >
        <span>{extraCount > 0 ? `Skills ${count}` : 'Skills'}</span>
        <Icons.ChevronDown size={12} />
      </button>
    </div>
  )
}
