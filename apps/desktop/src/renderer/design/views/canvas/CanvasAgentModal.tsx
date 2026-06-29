/**
 * 画布 Agent 对话弹窗
 *
 * 当前策略：
 *   - 只把 canvas project / board id 作为首轮绑定信息注入，避免把 snapshot 文本塞进 prompt；
 *   - 每轮显式激活 builtin:canvas-studio，让 agent 通过实时画布工具拿最新状态；
 *   - 会话级支持附加 Skills，但强制保留 canvas-studio；
 *   - 固定 bypass/full-access，不再暴露权限模式选择；
 *   - 面板支持边框拖拽缩放，消息渲染复用常规会话的 Markdown 能力。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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
import { ProviderLogo } from '../../components/ProviderLogo'
import { ChatPanel } from '../../components/ChatPanel'
import {
  SkillsPickerModal,
  type SkillItemForPicker,
} from '../../components/SkillsPickerModal'
import { useCanvasToolHost } from './canvas-tool-host'
import type { CanvasToolHostOptions } from './canvas-tool-host'
import {
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

type CanvasAgentComposerMenu = 'agent' | 'model'
type CanvasAgentResizeHandle = 'top' | 'left' | 'right' | 'top-left' | 'top-right'
type SkillSummary = SkillItemForPicker
type CanvasAgentProjectCache = {
  sessionId?: string
  firstTurnSent?: boolean
  draftAgentId?: string
  draftProviderId?: string
  draftModelId?: string
  selectedExtraSkillIds?: string[]
}

const REQUIRED_CANVAS_SKILL_ID = 'builtin:canvas-studio'
const DEFAULT_PANEL_WIDTH = 760
const DEFAULT_PANEL_HEIGHT = 560
const MIN_PANEL_WIDTH = 560
const MAX_PANEL_WIDTH = 1120
const MIN_PANEL_HEIGHT = 360
const MAX_PANEL_HEIGHT = 820

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

export function CanvasAgentModal({ open, onClose, snapshot, workspace }: Props) {
  const projectId = snapshot.project.id
  const [fullscreen, setFullscreen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([])
  const [draftAgentId, setDraftAgentId] = useState<string>('platform-manager-agent')
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
    () =>
      agents.find((agent) => agent.id === draftAgentId) ??
      agents.find((agent) => agent.id === 'platform-manager-agent') ??
      null,
    [agents, draftAgentId],
  )
  const adapter: SessionAgentAdapter = activeAgent?.agentAdapter ?? 'claude-sdk'
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
    setSessionId(cached?.sessionId ?? null)
    setDraftAgentId(cached?.draftAgentId ?? 'platform-manager-agent')
    setDraftProviderId(cached?.draftProviderId ?? '')
    setDraftModelId(cached?.draftModelId ?? '')
    setSelectedExtraSkillIds(cached?.selectedExtraSkillIds ?? [])
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

        const defaultAgent =
          loadedAgents.find((agent) => agent.id === 'platform-manager-agent') ??
          loadedAgents[0] ??
          null
        const restoredAgent =
          (cached?.draftAgentId != null
            ? loadedAgents.find((agent) => agent.id === cached.draftAgentId)
            : null) ??
          defaultAgent
        const restoredAgentId = restoredAgent?.id ?? 'platform-manager-agent'
        const restoredAdapter: SessionAgentAdapter = restoredAgent?.agentAdapter ?? 'claude-sdk'
        setDraftAgentId(restoredAgentId)

        const compatible = loadedProviders.filter((provider) =>
          isProviderCompatibleWithAdapter(provider, restoredAdapter),
        )
        const preferred = getPreferredProviderForAdapter(
          compatible,
          cached?.draftProviderId,
          restoredAdapter,
        )
        if (preferred) {
          const providerId = preferred.id
          const providerModels = getProviderModels(preferred)
          const modelId =
            cached?.draftProviderId === preferred.id &&
            cached.draftModelId != null &&
            providerModels.includes(cached.draftModelId)
              ? cached.draftModelId
              : (preferred.defaultModel ?? providerModels[0] ?? '')
          setDraftProviderId(providerId)
          setDraftModelId(modelId)
        } else {
          setDraftProviderId('')
          setDraftModelId('')
        }
        setSelectedExtraSkillIds(
          (cached?.selectedExtraSkillIds ?? []).filter((skillId) =>
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
      draftProviderId,
      draftModelId,
      selectedExtraSkillIds,
    })
  }, [
    draftAgentId,
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
      const nextAdapter = next.agentAdapter
      const compatible = providers.filter((provider) =>
        isProviderCompatibleWithAdapter(provider, nextAdapter),
      )
      const preferred = getPreferredProviderForAdapter(compatible, draftProviderId, nextAdapter)
      if (preferred) {
        setDraftProviderId(preferred.id)
        setDraftModelId(preferred.defaultModel ?? getProviderModels(preferred)[0] ?? '')
      }
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', {
            sessionId: sessionId as never,
            agentId,
            permissionMode: getCanvasPermissionMode(nextAdapter),
            ...(preferred
              ? {
                  providerProfileId: preferred.id,
                  modelId: preferred.defaultModel ?? getProviderModels(preferred)[0] ?? '',
                }
              : {}),
          })
          .catch(() => {})
      }
    },
    [agents, draftProviderId, providers, sessionId],
  )

  const handleChangeProviderModel = useCallback(
    (providerId: string, modelId: string) => {
      setDraftProviderId(providerId)
      setDraftModelId(modelId)
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', {
            sessionId: sessionId as never,
            providerProfileId: providerId,
            modelId,
          })
          .catch(() => {})
      }
    },
    [sessionId],
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
          permissionMode: forcedPermissionMode,
          skillId: REQUIRED_CANVAS_SKILL_ID,
        })
      } finally {
        setCreating(false)
      }
    },
    [
      draftAgentId,
      effectiveModelId,
      effectiveSkillIds,
      forcedPermissionMode,
      updateProjectCache,
      selectedProvider,
      sessionId,
      projectId,
      snapshot,
      syncSessionSkills,
    ],
  )

  const composerBar = (
    <>
      <AgentPickerInline
        agents={agents}
        selectedId={draftAgentId}
        disabled={running || creating}
        open={openMenu === 'agent'}
        onOpenChange={(nextOpen) => setOpenMenu(nextOpen ? 'agent' : null)}
        onChange={handleChangeAgent}
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
      onPointerDown={(event) => event.stopPropagation()}
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
              size="small"
              type="text"
              icon={fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
              aria-label={fullscreen ? '退出全屏' : '全屏对话'}
              onClick={() => setFullscreen((current) => !current)}
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

export function AgentPickerInline({
  agents,
  selectedId,
  disabled,
  open,
  onOpenChange,
  onChange,
}: {
  agents: ManagedAgent[]
  selectedId: string
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (agentId: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => onOpenChange(false), open)
  useEffect(() => {
    if (disabled && open) onOpenChange(false)
  }, [disabled, onOpenChange, open])
  const selected = agents.find((agent) => agent.id === selectedId)
  return (
    <div
      ref={rootRef}
      className={`composer-select composer-agent-picker${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : 'Agent'}
    >
      <span className="composer-select-icon">
        {selected?.builtIn ? <Icons.Code size={13} /> : <Icons.Bot size={13} />}
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || agents.length === 0}
        onClick={() => onOpenChange(!open)}
      >
        <span>{selected?.name ?? '平台管理'}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-agent-menu">
          <div className="composer-menu-group-title">选择 Agent</div>
          {agents.map((agent) => (
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
                  {agent.builtIn ? <Icons.Code size={13} /> : <Icons.Bot size={13} />}
                  <span>{agent.name}</span>
                  {agent.builtIn && <span className="composer-menu-item-tag">内置</span>}
                </span>
                {agent.description && (
                  <span className="composer-menu-item-desc">{agent.description}</span>
                )}
              </span>
              {agent.id === selectedId && <Icons.Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProviderModelPickerInline({
  providers,
  selectedProviderId,
  selectedModelId,
  disabled,
  open,
  onOpenChange,
  onChange,
}: {
  providers: ProviderProfile[]
  selectedProviderId: string
  selectedModelId: string
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (providerId: string, modelId: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => onOpenChange(false), open)
  useEffect(() => {
    if (disabled && open) onOpenChange(false)
  }, [disabled, onOpenChange, open])
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const vendor = resolveProviderVendor(selectedProvider)
  const label = selectedModelId || selectedProvider?.defaultModel || '选择模型'
  return (
    <div
      ref={rootRef}
      className={`composer-select composer-model-picker${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : '供应商模型'}
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
        onClick={() => onOpenChange(!open)}
      >
        <span>{label}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-dropdown-menu composer-model-menu">
          {providers.length === 0 && <div className="composer-menu-empty">未配置</div>}
          {providers.map((provider) => {
            const models = getProviderModels(provider)
            return (
              <div key={provider.id} className="composer-model-group">
                <div className="composer-model-group-title">
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
                      {active && <Icons.Check size={14} />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
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

function useCloseOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const closeIfOutside = (target: EventTarget | null) => {
      if (target instanceof Node && ref.current != null && !ref.current.contains(target)) onClose()
    }
    const handlePointerDown = (event: PointerEvent) => closeIfOutside(event.target)
    const handleFocusIn = (event: FocusEvent) => closeIfOutside(event.target)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('focusin', handleFocusIn, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('focusin', handleFocusIn, true)
    }
  }, [active, onClose, ref])
}
