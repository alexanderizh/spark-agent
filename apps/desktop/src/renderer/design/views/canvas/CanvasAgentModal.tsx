/**
 * 画布 Agent 对话弹窗（重写版，Phase 3）
 *
 * 真正接入应用内会话能力 + 画布工具桥，且对齐普通对话框的使用方式：
 *   - 延迟建会：弹窗打开只加载 agent / provider 列表 + 配置条，用户点发送时才
 *     workspace:open → session:create → 注入画布上下文 → session:send-turn。
 *     彻底避免"打开即卡死"（旧版一打开就自动发系统消息触发真实 agent 调用）。
 *   - 选择器：Agent / Provider+模型 / 权限模式，可切换并随 session:update 持久化。
 *   - 系统上下文：不再单独发一条 [系统] 消息，而是作为首条用户消息的前缀一次性
 *     注入，零额外 agent 调用。
 *   - useCanvasToolHost：sessionId 就绪后 attach，agent 调 mcp__spark_canvas__*
 *     工具会被回打到这个 hook 执行 store action。
 *   - <ChatPanel>：复用消息流、工具调用卡片、输入区，通过 composer 插槽注入配置条，
 *     通过 onSend 接管发送逻辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent, ProviderProfile, ManagedAgent } from '@spark/protocol'
import { Button } from 'antd'
import { Icons } from '../../Icons'
import { ProviderLogo } from '../../components/ProviderLogo'
import { ChatPanel } from '../../components/ChatPanel'
import { useCanvasToolHost } from './canvas-tool-host'
import type { CanvasToolHostOptions } from './canvas-tool-host'
import {
  isProviderCompatibleWithAdapter,
  getPreferredProviderForAdapter,
} from '../../utils/provider-adapter'
import { getPermissionModeOptions, getValidPermissionMode } from '../../utils/permission-options'
import type { ComposerMenuOption } from '../../utils/permission-options'
import type { CanvasSnapshot } from './canvas.types'
import type { SessionAgentAdapter, SessionPermissionMode } from '@spark/protocol'

interface Props {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  /** 画布 store actions（由 CanvasWorkspaceView 把 useCanvasWorkspace 结果传入） */
  workspace: CanvasToolHostOptions['workspace']
}

/** provider → 模型列表（modelIds 为空时回退 defaultModel） */
function getProviderModels(provider: ProviderProfile | undefined): string[] {
  if (provider == null) return []
  return provider.modelIds.length > 0 ? provider.modelIds : provider.defaultModel ? [provider.defaultModel] : []
}

/** provider → 展示用 vendor（用于 ProviderLogo 图标） */
function resolveProviderVendor(provider: ProviderProfile | undefined) {
  if (provider == null) return null
  // 简化版：用 provider.provider 作为 vendor id 直接交给 ProviderLogo；
  // ProviderLogo 内部 VENDOR_AVATAR_MAP 覆盖 anthropic/openai 等常见厂商，其余回退首字母。
  return {
    id: provider.provider,
    name: provider.name,
    emoji: (provider.name[0] ?? '?').toUpperCase(),
    color: 'var(--text-faint)',
    desc: '',
    logoPath: '',
  }
}

function buildSystemContext(snapshot: CanvasSnapshot): string {
  const boardCount = snapshot.boards?.length ?? 1
  const activeBoard = snapshot.board.name
  const filmMeta = snapshot.project.metadata?.film as { shotGroups?: unknown[] } | undefined
  const shotGroupCount = filmMeta?.shotGroups?.length ?? 0
  const kindCounts: Record<string, number> = {}
  for (const asset of snapshot.assets) {
    const kind = (asset.metadata?.kind as string) ?? 'other'
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1
  }
  const kindSummary = Object.entries(kindCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join('、')

  return [
    `你是画布项目"${snapshot.project.title}"的 AI 协作助手。`,
    `项目目录：${snapshot.project.rootPath ?? '(未关联)'}`,
    `当前激活画板：「${activeBoard}」（项目共 ${boardCount} 个画板），${snapshot.nodes.length} 个节点 / ${snapshot.assets.length} 个资产 / ${snapshot.tasks.length} 个任务${shotGroupCount > 0 ? ` / ${shotGroupCount} 个分镜分组` : ''}。`,
    kindSummary ? `影视资产构成：${kindSummary}` : '',
    '',
    '你可以使用 mcp__spark_canvas__* 系列工具直接读写当前画布：',
    '- canvas_get_project_summary / canvas_list_nodes / canvas_get_node / canvas_find_nodes — 获取上下文',
    '- canvas_create_text_node / canvas_create_prompt_node / canvas_update_node_data / canvas_patch_nodes / canvas_delete_nodes — 节点 CRUD',
    '- canvas_create_operation_node / canvas_run_operation / canvas_retry_operation — AI 操作节点',
    '- canvas_create_film_asset / canvas_update_film_asset / canvas_search_assets / canvas_insert_asset_to_board — 资产管理',
    '- canvas_create_shot_group / canvas_create_shot_segment / canvas_update_shot_segment — 分镜编排',
    '- canvas_insert_generated_image / canvas_insert_generated_text — 把你生成的图片/文本作为节点插入画布',
    '',
    '请基于以上画布状态协助用户。涉及编辑前先查询当前状态（避免重复或冲突），不确定时简短确认后再操作。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function CanvasAgentModal({ open, onClose, snapshot, workspace }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [draftAgentId, setDraftAgentId] = useState<string>('platform-manager-agent')
  const [draftProviderId, setDraftProviderId] = useState<string>('')
  const [draftModelId, setDraftModelId] = useState<string>('')
  const [draftPermissionMode, setDraftPermissionMode] = useState<SessionPermissionMode>('claude-ask')
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 首条消息建会中（覆盖在面板上，避免重复点击） */
  const [creating, setCreating] = useState(false)
  /** 会话是否正在运行（用于禁用选择器） */
  const [running, setRunning] = useState(false)
  /** 首条消息标记：用于注入系统上下文前缀 */
  const firstTurnRef = useRef(true)

  // useCanvasToolHost 在 sessionId 就绪时 attach、卸载/切换时 detach
  useCanvasToolHost({
    sessionId,
    projectId: snapshot.project.id,
    getSnapshot: useCallback(() => snapshot, [snapshot]),
    workspace,
  })

  // 解析当前生效的 agent / adapter / provider / model / 权限选项
  const activeAgent = useMemo(
    () =>
      agents.find((a) => a.id === draftAgentId) ??
      agents.find((a) => a.id === 'platform-manager-agent') ??
      null,
    [agents, draftAgentId],
  )
  const adapter: SessionAgentAdapter = activeAgent?.agentAdapter ?? 'claude-sdk'
  const compatibleProviders = useMemo(
    () => providers.filter((p) => isProviderCompatibleWithAdapter(p, adapter)),
    [providers, adapter],
  )
  const selectedProvider = useMemo(() => {
    const hit = compatibleProviders.find((p) => p.id === draftProviderId)
    if (hit) return hit
    return getPreferredProviderForAdapter(compatibleProviders, undefined, adapter)
  }, [compatibleProviders, draftProviderId, adapter])
  const modelOptions = useMemo(() => getProviderModels(selectedProvider), [selectedProvider])
  // provider 变化导致当前模型不在可选列表时，回退到 provider 默认模型
  const effectiveModelId = useMemo(() => {
    if (modelOptions.includes(draftModelId)) return draftModelId
    return selectedProvider?.defaultModel ?? modelOptions[0] ?? ''
  }, [draftModelId, modelOptions, selectedProvider])
  const permissionOptions = useMemo(() => getPermissionModeOptions(adapter), [adapter])

  // 弹窗打开：加载 agent + provider 列表（不建会话）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingConfig(true)
    setError(null)
    void (async () => {
      try {
        const [agentRes, providerRes] = await Promise.all([
          window.spark.invoke('agent:list', { includeDisabled: false }),
          window.spark.invoke('provider:list', {}),
        ])
        if (cancelled) return
        const loadedAgents = (agentRes as { agents?: ManagedAgent[] }).agents ?? []
        const loadedProviders = (providerRes as { profiles?: ProviderProfile[] }).profiles ?? []
        setAgents(loadedAgents)
        setProviders(loadedProviders)

        // 默认 agent：内置平台管理
        const defaultAgent =
          loadedAgents.find((a) => a.id === 'platform-manager-agent') ?? loadedAgents[0] ?? null
        const defaultAdapter: SessionAgentAdapter = defaultAgent?.agentAdapter ?? 'claude-sdk'
        if (defaultAgent) setDraftAgentId(defaultAgent.id)

        // 默认 provider / model：按 adapter 选适配的默认 provider
        const compatible = loadedProviders.filter((p) =>
          isProviderCompatibleWithAdapter(p, defaultAdapter),
        )
        const preferred = getPreferredProviderForAdapter(compatible, undefined, defaultAdapter)
        if (preferred) {
          setDraftProviderId(preferred.id)
          setDraftModelId(preferred.defaultModel ?? getProviderModels(preferred)[0] ?? '')
        }
        setDraftPermissionMode(
          getValidPermissionMode(defaultAgent?.permissionMode, defaultAdapter),
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
  }, [open])

  // 关闭弹窗：取消正在运行的 turn（不删 session，保留在历史中）
  useEffect(() => {
    if (open) return
    if (sessionId != null && running) {
      void window.spark.invoke('session:cancel', { sessionId: sessionId as never }).catch(() => {})
    }
    // 重置为全新会话状态（不自动恢复上次会话；session 仍保留在历史列表里）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(null)
    setRunning(false)
    firstTurnRef.current = true
    setError(null)
    // sessionId/running intentionally not in deps：此 effect 仅响应 open 由 true→false，
    // 切换关闭时读取当时的 sessionId/running 闭包值即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 订阅 agent 事件流：跟踪 running 状态（用于禁用选择器）
  useEffect(() => {
    if (sessionId == null) return
    const unsubscribe = window.spark.on('stream:session:agent-event', (event: AgentEvent) => {
      const evt = event as { sessionId?: string; type?: string; status?: string }
      if (evt.sessionId !== sessionId) return
      if (evt.type === 'agent_status') {
        if (evt.status === 'running' || evt.status === 'thinking') {
          setRunning(true)
        } else if (evt.status === 'completed' || evt.status === 'cancelled' || evt.status === 'error') {
          setRunning(false)
        }
      }
    })
    return unsubscribe
  }, [sessionId])

  // 切换 agent：已建会话则 session:update 持久化，并按新 adapter 重算 provider/model/权限
  const handleChangeAgent = useCallback(
    (agentId: string) => {
      const next = agents.find((a) => a.id === agentId)
      if (next == null) return
      setDraftAgentId(agentId)
      const nextAdapter = next.agentAdapter
      // provider 可能不适配新 adapter，重选
      const compatible = providers.filter((p) => isProviderCompatibleWithAdapter(p, nextAdapter))
      const preferred = getPreferredProviderForAdapter(compatible, draftProviderId, nextAdapter)
      if (preferred) {
        setDraftProviderId(preferred.id)
        setDraftModelId(preferred.defaultModel ?? getProviderModels(preferred)[0] ?? '')
      }
      setDraftPermissionMode(getValidPermissionMode(next.permissionMode, nextAdapter))
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', {
            sessionId: sessionId as never,
            agentId,
            permissionMode: getValidPermissionMode(next.permissionMode, nextAdapter),
            ...(preferred ? { providerProfileId: preferred.id, modelId: preferred.defaultModel ?? getProviderModels(preferred)[0] ?? '' } : {}),
          })
          .catch(() => {})
      }
    },
    [agents, providers, draftProviderId, sessionId],
  )

  // 切换 provider+model
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

  // 切换权限模式
  const handleChangePermission = useCallback(
    (mode: SessionPermissionMode) => {
      setDraftPermissionMode(mode)
      if (sessionId != null) {
        void window.spark
          .invoke('session:update', { sessionId: sessionId as never, permissionMode: mode })
          .catch(() => {})
      }
    },
    [sessionId],
  )

  // 发送：首条消息负责建会 + 注入系统上下文
  const handleSend = useCallback(
    async (text: string) => {
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
            permissionMode: draftPermissionMode,
            chatMode: 'agent',
            title: `画布助手 · ${snapshot.project.title}`,
          })
          sid = sessionRes.sessionId
          setSessionId(sid)
        }

        // 首条消息注入画布系统上下文前缀（一次性，零额外 agent 调用）
        let message = text
        if (isFirst && firstTurnRef.current) {
          firstTurnRef.current = false
          message = `[画布上下文]\n${buildSystemContext(snapshot)}\n\n---\n\n${text}`
        }

        await window.spark.invoke('session:send-turn', {
          sessionId: sid as never,
          message,
        })
      } finally {
        setCreating(false)
      }
    },
    [sessionId, snapshot, selectedProvider, effectiveModelId, draftAgentId, draftPermissionMode],
  )

  const contextSummary = useMemo(() => buildSystemContext(snapshot), [snapshot])

  // 配置条（传给 ChatPanel 的 composer 插槽）
  const composerBar = (
    <>
      <AgentPickerInline
        agents={agents}
        selectedId={draftAgentId}
        disabled={running || creating}
        onChange={handleChangeAgent}
      />
      <ProviderModelPickerInline
        providers={compatibleProviders}
        selectedProviderId={selectedProvider?.id ?? ''}
        selectedModelId={effectiveModelId}
        disabled={running || creating}
        onChange={handleChangeProviderModel}
      />
      <PermissionPickerInline
        options={permissionOptions}
        selected={draftPermissionMode}
        disabled={running || creating}
        onChange={handleChangePermission}
      />
    </>
  )

  if (!open) return null

  return (
    <section
      className="canvas-bottom-floating-panel canvas-agent-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="canvas-bottom-floating-head">
        <div>
          <strong className="canvas-agent-title">
            <Icons.Sparkles size={15} />
            画布 Agent 助手
          </strong>
          <span title={contextSummary}>对话操作画布 · 工具已就绪</span>
        </div>
        <Button
          size="small"
          type="text"
          icon={<Icons.X size={14} />}
          aria-label="关闭画布 Agent 助手"
          onClick={onClose}
        />
      </div>

      <div className="canvas-agent-modal">
        <ChatPanel
          sessionId={sessionId}
          loading={loadingConfig || creating}
          error={error}
          composer={composerBar}
          onSend={handleSend}
          contextBadge={
            <>
              <Icons.Layers size={13} />
              <span>已接入画布：{snapshot.project.title} · {snapshot.board.name}</span>
            </>
          }
          emptyState={
            <>
              <Icons.Sparkles size={32} />
              <p>选好 Agent 与模型后发送消息，agent 即可操作画布</p>
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                试试：「列出当前画板的所有节点」「为第一幕创建 3 个镜头片段」「把图片节点 X 的标题改成 Y」「生成一张赛博朋克风格的角色定妆图并插入画布」
              </p>
            </>
          }
          placeholder="输入消息，让 agent 操作画布（Enter 发送，Shift+Enter 换行）"
          toolNamePrefixFilter="mcp__spark_canvas__"
        />
      </div>
    </section>
  )
}

// ─── 内联轻量选择器（复用 composer-select / composer-menu CSS） ────────────────

function AgentPickerInline({
  agents,
  selectedId,
  disabled,
  onChange,
}: {
  agents: ManagedAgent[]
  selectedId: string
  disabled?: boolean
  onChange: (agentId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)
  const selected = agents.find((a) => a.id === selectedId)
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
        onClick={() => setOpen((v) => !v)}
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
                setOpen(false)
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

function ProviderModelPickerInline({
  providers,
  selectedProviderId,
  selectedModelId,
  disabled,
  onChange,
}: {
  providers: ProviderProfile[]
  selectedProviderId: string
  selectedModelId: string
  disabled?: boolean
  onChange: (providerId: string, modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)
  const selectedProvider =
    providers.find((p) => p.id === selectedProviderId) ?? providers[0]
  const vendor = resolveProviderVendor(selectedProvider)
  const label = selectedModelId || selectedProvider?.defaultModel || '选择模型'
  return (
    <div
      ref={rootRef}
      className={`composer-select composer-model-picker${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : '供应商模型'}
    >
      <span className="composer-select-icon">
        {vendor ? <ProviderLogo vendor={vendor} size={18} shape="rounded" /> : <Icons.Sparkles size={13} />}
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || providers.length === 0}
        onClick={() => setOpen((v) => !v)}
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
                        setOpen(false)
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

function PermissionPickerInline({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: ComposerMenuOption[]
  selected: SessionPermissionMode
  disabled?: boolean
  onChange: (mode: SessionPermissionMode) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)
  const active = options.find((o) => o.value === selected) ?? options[0]
  return (
    <div
      ref={rootRef}
      className={`composer-select composer-menu-select tone-${active?.tone ?? 'default'}${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : '权限模式'}
    >
      <span className="composer-select-icon">
        <Icons.Shield size={13} />
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{active?.label ?? '权限'}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`composer-menu-item tone-${option.tone ?? 'default'} ${option.value === selected ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                onChange(option.value)
              }}
            >
              <span className="composer-menu-item-copy">
                <span className="composer-menu-item-label">{option.label}</span>
                {option.description && (
                  <span className="composer-menu-item-desc">{option.description}</span>
                )}
              </span>
              {option.value === selected && <Icons.Check size={14} />}
            </button>
          ))}
        </div>
      )}
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
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [active, onClose, ref])
}
