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
  SessionPermissionMode,
} from '@spark/protocol'
import { Button, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AvatarImage } from '../../components/AvatarImage'
import { ProviderLogo } from '../../components/ProviderLogo'
import { ChatPanel } from '../../components/ChatPanel'
import {
  SkillsPickerModal,
  type SkillItemForPicker,
} from '../../components/SkillsPickerModal'
import {
  getAgentAvatarConfig,
  hasCustomAvatar,
  resolveAvatarSrc,
} from '../../avatar'
import { useCanvasToolHost } from './canvas-tool-host'
import type { CanvasToolHostOptions } from './canvas-tool-host'
import {
  getProviderAdapterKind,
  getPreferredProviderForAdapter,
  isProviderCompatibleWithAdapter,
} from '../../utils/provider-adapter'
import type { CanvasSnapshot } from './canvas.types'

interface Props {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  /** 画布 store actions（由 CanvasWorkspaceView 把 useCanvasWorkspace 结果传入） */
  workspace: CanvasToolHostOptions['workspace']
}

type CanvasAgentComposerMenu = 'agent' | 'adapter' | 'model'
type CanvasAgentResizeHandle = 'top' | 'left' | 'right' | 'top-left' | 'top-right'
type SkillSummary = SkillItemForPicker
type CanvasAgentProjectCache = {
  sessionId?: string
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

/** provider → 模型列表（modelIds 为空时回退 defaultModel） */
function getProviderModels(provider: ProviderProfile | undefined): string[] {
  if (provider == null) return []
  return Array.from(
    new Set(
      [
        provider.defaultModel,
        provider.haikuModel,
        provider.sonnetModel,
        provider.opusModel,
        ...provider.modelIds,
      ]
        .map((model) => model?.trim())
        .filter((model): model is string => Boolean(model)),
    ),
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
  const models = getProviderModels(provider)
  return preferredModelId != null && models.includes(preferredModelId)
    ? preferredModelId
    : (provider.defaultModel ?? models[0] ?? '')
}

function clampPanelWidth(width: number): number {
  return Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width)))
}

function clampPanelHeight(height: number): number {
  return Math.round(Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, height)))
}

function buildCanvasBindingMessage(snapshot: CanvasSnapshot, text: string): string {
  return [
    '[画布绑定]',
    `canvasProjectId: ${snapshot.project.id}`,
    `activeBoardId: ${snapshot.activeBoardId ?? snapshot.board.id}`,
    '',
    `当前会话已启用 ${REQUIRED_CANVAS_SKILL_ID}。`,
    '不要依赖聊天里的旧画布描述；每次需要查看或修改画布时，先调用画布工具获取最新状态。',
    '',
    '---',
    '',
    text,
  ].join('\n')
}

function summarizeCanvasContext(snapshot: CanvasSnapshot): string {
  return `${snapshot.project.title} · ${snapshot.board.name} · ${snapshot.nodes.length} 节点 / ${snapshot.assets.length} 资产 / ${snapshot.tasks.length} 任务`
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
        availableBottom >= estimatedMenuHeight || availableBottom >= availableTop
          ? 'bottom'
          : 'top'
      setPlacement(
        `${vertical}${horizontal}` as ComposerDropdownPlacement,
      )
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

export function CanvasAgentModal({ open, onClose, snapshot, workspace }: Props) {
  const projectId = snapshot.project.id
  const [fullscreen, setFullscreen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
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
  const sessionCacheRef = useRef<Map<string, CanvasAgentProjectCache>>(new Map())

  useCanvasToolHost({
    sessionId,
    projectId: snapshot.project.id,
    getSnapshot: useCallback(() => snapshot, [snapshot]),
    workspace,
  })

  const activeAgent = useMemo(
    () => pickCanvasAgent(agents, draftAgentId),
    [agents, draftAgentId],
  )
  const adapter = draftAdapter
  const forcedPermissionMode = useMemo(() => getCanvasPermissionMode(adapter), [adapter])
  const compatibleProviders = useMemo(
    () => providers.filter((provider) => isProviderCompatibleWithAdapter(provider, adapter)),
    [providers, adapter],
  )
  const selectedProvider = useMemo(() => {
    const hit = compatibleProviders.find((provider) => provider.id === draftProviderId)
    if (hit) return hit
    return getPreferredProviderForAdapter(compatibleProviders, undefined, adapter)
  }, [compatibleProviders, draftProviderId, adapter])
  const modelOptions = useMemo(() => getProviderModels(selectedProvider), [selectedProvider])
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

  const updateProjectCache = useCallback(
    (patch: CanvasAgentProjectCache) => {
      const current = sessionCacheRef.current.get(projectId) ?? {}
      sessionCacheRef.current.set(projectId, { ...current, ...patch })
    },
    [projectId],
  )

  useEffect(() => {
    const cached = sessionCacheRef.current.get(projectId)
    const prefs = readCanvasAgentPrefs()
    setSessionId(cached?.sessionId ?? null)
    setDraftAgentId(prefs.draftAgentId ?? cached?.draftAgentId ?? DEFAULT_CANVAS_AGENT_ID)
    setDraftAdapter(normalizeCanvasAdapter(prefs.draftAdapter ?? cached?.draftAdapter))
    setDraftProviderId(prefs.draftProviderId ?? cached?.draftProviderId ?? '')
    setDraftModelId(prefs.draftModelId ?? cached?.draftModelId ?? '')
    setSelectedExtraSkillIds(prefs.selectedExtraSkillIds ?? cached?.selectedExtraSkillIds ?? [])
    setRunning(false)
    firstTurnRef.current = cached?.firstTurnSent !== true
    setError(null)
  }, [projectId])

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
        const loadedSkills = ((skillRes as { skills?: SkillSummary[] }).skills ?? []).map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: Boolean(skill.enabled),
        }))
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
            loadedSkills.some((skill) => skill.id === skillId && skillId !== REQUIRED_CANVAS_SKILL_ID),
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
    if (sessionId == null) return
    void syncSessionSkills(sessionId, effectiveSkillIds).catch(() => {})
  }, [effectiveSkillIds, sessionId, syncSessionSkills])

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

  const handleChangeAdapter = useCallback(
    (nextAdapter: SessionAgentAdapter) => {
      const normalizedAdapter = normalizeCanvasAdapter(nextAdapter)
      if (normalizedAdapter === adapter) return
      setDraftAdapter(normalizedAdapter)
      const preferred = getPreferredProviderForAdapter(providers, draftProviderId, normalizedAdapter)
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
            agentAdapter: normalizedAdapter,
            permissionMode: getCanvasPermissionMode(normalizedAdapter),
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
    [adapter, draftModelId, draftProviderId, providers, sessionId],
  )

  const handleChangeProviderModel = useCallback(
    (providerId: string, modelId: string) => {
      const provider = providers.find((item) => item.id === providerId)
      const nextAdapter =
        provider != null ? normalizeCanvasAdapter(getProviderAdapterKind(provider)) : adapter
      const nextModelId = provider != null ? resolveProviderModel(provider, modelId) : modelId
      setDraftAdapter(nextAdapter)
      setDraftProviderId(providerId)
      setDraftModelId(nextModelId)
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', {
            sessionId: sessionId as never,
            providerProfileId: providerId,
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
          setSessionId(sid)
          updateProjectCache({
            sessionId: sid,
            firstTurnSent: false,
          })
        }

        await syncSessionSkills(sid as string, effectiveSkillIds)

        let message = text
        if (isFirst && firstTurnRef.current) {
          firstTurnRef.current = false
          updateProjectCache({
            sessionId: sid as string,
            firstTurnSent: true,
          })
          message = buildCanvasBindingMessage(snapshot, text)
        }

        await window.spark.invoke('session:send-turn', {
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
      selectedProvider,
      sessionId,
      snapshot,
      syncSessionSkills,
    ],
  )

  const composerBar = (
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
      <AdapterPickerInline
        selectedAdapter={adapter}
        disabled={running || creating}
        open={openMenu === 'adapter'}
        onOpenChange={(nextOpen) => setOpenMenu(nextOpen ? 'adapter' : null)}
        onChange={handleChangeAdapter}
      />
      <ProviderModelPickerInline
        providers={compatibleProviders}
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

  if (!open) return null

  return (
    <section
      className={`canvas-bottom-floating-panel canvas-agent-panel${fullscreen ? ' is-fullscreen' : ''}${resizing ? ' is-resizing' : ''}`}
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

      <div className="canvas-bottom-floating-head">
        <div>
          <strong className="canvas-agent-title">
            <Icons.Sparkles size={15} />
            画布 Agent 助手
          </strong>
          <span title={contextSummary}>实时取数 · 固定全权模式 · 画布 skill 常驻</span>
        </div>
        <div className="canvas-agent-head-actions">
          <Tooltip title={fullscreen ? '退出全屏' : '全屏对话'}>
            <Button
              size="middle"
              type="text"
              icon={fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
              aria-label={fullscreen ? '退出全屏' : '全屏对话'}
              onClick={() => setFullscreen((current) => !current)}
            />
          </Tooltip>
          <Button
            size="middle"
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
          composer={composerBar}
          onSend={handleSend}
          agents={agents}
          fallbackAssistant={fallbackAssistant}
          contextBadge={
            <>
              <Icons.Layers size={13} />
              <span>
                已接入画布：{snapshot.project.title} · {snapshot.board.name}
              </span>
            </>
          }
          emptyState={
            <>
              <Icons.Sparkles size={32} />
              <p>选好 Agent、模型和附加 Skills 后发送消息，agent 会通过实时画布工具操作项目</p>
              <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                试试：「先读取当前画板摘要，再列出第一幕相关节点」「为第一幕创建 3 个镜头片段」「生成一张赛博朋克风格的角色定妆图并插入画布」
              </p>
            </>
          }
          placeholder="输入消息，让 agent 读取最新画布后再执行（Enter 发送，Shift+Enter 换行）"
          toolNamePrefixFilter="mcp__spark_canvas__"
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
      <Icons.Code size={13} />
    ) : (
      <Icons.Bot size={13} />
    )
  return (
    <Dropdown
      menu={{ items: [] }}
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
                {agent.id === selectedId && <Icons.Check size={14} className="composer-menu-check" />}
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
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const vendor = resolveProviderVendor(selectedProvider)
  const label = selectedModelId || selectedProvider?.defaultModel || '选择模型'
  const menuHeight = Math.min(
    420,
    24 + providers.reduce((sum, provider) => sum + 36 + getProviderModels(provider).length * 34, 0),
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
          {providers.map((provider) => {
            const models = getProviderModels(provider)
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
                {models.map((modelId) => {
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
                      <span>{modelId}</span>
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
            <ProviderLogo vendor={vendor} size={18} shape="rounded" />
          ) : (
            <Icons.Sparkles size={13} />
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
      <button type="button" className="composer-select-trigger" disabled={disabled} onClick={onClick}>
        <span>{extraCount > 0 ? `Skills ${count}` : 'Skills'}</span>
        <Icons.ChevronDown size={12} />
      </button>
    </div>
  )
}
