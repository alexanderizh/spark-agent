/**
 * 工作流编辑器 Agent 浮层面板（E2-2，M1，对称 CanvasAgentModal 模式）
 *
 * 当前策略（M1 最小闭环，对齐设计稿 D5）：
 *   - 浮层面板承载 ChatPanel（消息渲染/输入区/事件流复用常规会话能力）；
 *   - 工具经 spark_workflow MCP 桥（E2-1）在会话内挂载，无需强制 skill 说明书
 *     （builtin:workflow-architect 随 E2-3 加入并强制绑定）；
 *   - 首轮注入 [工作流绑定] 前缀（workflowId/name/规模 + 工具纪律声明），
 *     图摘要与修复熔断随 E2-3 增强；
 *   - provider/model M1 从渠道列表解析第一个兼容渠道，不做选择器 UI；
 *   - 会话创建不传 workspaceId/agentAdapter/permissionMode，按 agent 配置回退
 *     （同 BoardView 先例）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ManagedAgent,
  ProviderProfile,
  SessionAttachment,
  WorkflowGraph,
} from '@spark/protocol'
import { ChatPanel } from '../../components/ChatPanel'
import { Icons } from '../../Icons'
import {
  getPreferredProviderWithAdapterFallback,
  getProviderAdapterKind,
} from '../../utils/provider-adapter'
import {
  buildWorkflowTurnPrefix,
  circuitBrokenResponse,
  createValidateCircuit,
} from './workflow-agent-turn'
import { useWorkflowToolHost } from './workflow-tool-host'
import type { WorkflowEditorState, WorkflowToolContext } from './workflow.tools'
import './WorkflowAgentPanel.less'

interface Props {
  open: boolean
  onClose: () => void
  /** 当前编辑器状态（workflowId/name/graph 实时引用），由 WorkflowView 传入 */
  editorState: WorkflowEditorState | null
  /** 渠道列表（WorkflowView 已加载，直接透传） */
  providers: ProviderProfile[]
  /** 可用 agent 列表（WorkflowView 已加载，直接透传） */
  agents: ManagedAgent[]
  /** 新工作流落库成功后回调（编辑器切换到新图） */
  onWorkflowCreated: (workflowId: string) => void
  /** 撤销本轮：把编辑器恢复到快照时的图（由 WorkflowView 提供 loadGraphIntoCanvas） */
  onRestoreGraph?: (graph: WorkflowGraph) => void
}

const WORKFLOW_TOOL_PREFIX = 'mcp__spark_workflow__'
const DEFAULT_WORKFLOW_AGENT_ID = 'workflow-architect-agent'
const FALLBACK_WORKFLOW_AGENT_ID = 'platform-manager-agent'
/** 强制绑定的内置技能（E2-3）：工具描述符已含纪律，skill 提供节点目录/铁律/few-shot */
const REQUIRED_WORKFLOW_SKILL_ID = 'builtin:workflow-architect'
/** 每轮回滚快照保留上限 */
const TURN_SNAPSHOT_LIMIT = 5
const CONNECTION_LABELS: Record<string, string> = {
  attached: '工具已连接',
  attaching: '连接中…',
  error: '连接失败',
  detached: '等待连接',
}

/**
 * 跨视图会话持久化：切到左侧任务列表再回来（编辑器整个重建）时，
 * 从 localStorage 恢复上次的生成会话，对话记录不丢。按工作流 id 键控。
 * localStorage 不可用时静默降级（保活退化为单次挂载内）。
 */
const agentSessionStorageKey = (workflowId: string): string =>
  `spark-agent:workflow-agent-session:${workflowId}`

const readPersistedAgentSession = (workflowId: string | null): string | null => {
  if (workflowId == null) return null
  try {
    const raw = localStorage.getItem(agentSessionStorageKey(workflowId))
    return raw != null && raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

const writePersistedAgentSession = (workflowId: string, sid: string): void => {
  try {
    localStorage.setItem(agentSessionStorageKey(workflowId), sid)
  } catch {
    // 静默降级
  }
}

const clearPersistedAgentSession = (workflowId: string | null): void => {
  if (workflowId == null) return
  try {
    localStorage.removeItem(agentSessionStorageKey(workflowId))
  } catch {
    // 静默降级
  }
}

export function WorkflowAgentPanel({
  open,
  onClose,
  editorState,
  providers,
  agents,
  onWorkflowCreated,
  onRestoreGraph,
}: Props): React.ReactNode | null {
  const initialWorkflowId = editorState?.workflowId ?? null
  // 跨视图保活：重建时从持久化恢复上次会话（切任务列表再回来的场景）
  const [sessionId, setSessionId] = useState<string | null>(() =>
    readPersistedAgentSession(initialWorkflowId),
  )
  const [creating, setCreating] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const editorStateRef = useRef<WorkflowEditorState | null>(editorState)
  /**
   * 当前会话归属的工作流 id（面板常驻后需显式换绑）：
   * 用户切到另一条工作流时旧会话上下文属于旧图，必须重置；
   * 恢复的持久化会话天然归属 initialWorkflowId（key 即按它存储）。
   */
  const sessionOwnerRef = useRef<string | null>(initialWorkflowId)
  /** 修复熔断（E2-3）：同轮内 validate 连续失败 ≥3 次后暂停校验/落库，新 turn 重置。
   * 用 useState 惰性持有可变对象（引用稳定），避开 useRef(...).current 的渲染期解构。 */
  const [validateCircuit] = useState(() => createValidateCircuit(3))
  /** 每轮回滚快照（turnId → 提交前的图深拷贝），供「撤销本轮」恢复 */
  const turnSnapshotsRef = useRef(new Map<string, WorkflowGraph>())
  const [canUndoTurn, setCanUndoTurn] = useState(false)

  // 同步最新编辑器状态（工具 handler 异步回调里读实时图）；对齐 canvas-tool-host 的 useEffect 模式
  useEffect(() => {
    editorStateRef.current = editorState
  }, [editorState])

  // 换绑守卫：编辑器已切到另一条工作流而会话仍归属旧图时，重置会话与本轮快照。
  const boundWorkflowId = editorState?.workflowId ?? null
  useEffect(() => {
    if (sessionId == null) return
    if (sessionOwnerRef.current === boundWorkflowId) return
    clearPersistedAgentSession(sessionOwnerRef.current)
    setSessionId(null)
    sessionOwnerRef.current = null
    turnSnapshotsRef.current.clear()
    setCanUndoTurn(false)
    validateCircuit.reset()
  }, [boundWorkflowId, sessionId, validateCircuit])

  // 会话持久化：会话或归属变化即写入（AI 生成新图认领后 boundWorkflowId 跟进，写入新 key）
  useEffect(() => {
    if (sessionId == null) return
    const owner = sessionOwnerRef.current
    if (owner == null) return
    writePersistedAgentSession(owner, sessionId)
  }, [sessionId, boundWorkflowId])

  /**
   * 延迟装载恢复：重建后编辑器 workflowId 异步到达（WorkflowView 的 activeId 首帧为 null，
   * workflow:list 返回后才 set），持久化会话不能只赌 useState 初始化器读到真实 id——
   * 否则真实重建路径（切任务列表再回来）会随首帧 null 永久丢失会话（2026-09-25 GUI 实测）。
   * 只在 null→id 过渡补读一次；编辑器内换绑（id→id）仍由换绑守卫全权重置，语义不变。
   */
  const prevBoundWorkflowIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevBoundWorkflowIdRef.current
    prevBoundWorkflowIdRef.current = boundWorkflowId
    if (prev !== null || boundWorkflowId == null) return
    if (sessionId != null) return
    const restored = readPersistedAgentSession(boundWorkflowId)
    if (restored == null) return
    setSessionId(restored)
    sessionOwnerRef.current = boundWorkflowId
  }, [boundWorkflowId, sessionId])

  // M1 无选择器 UI：优先内置工作流 agent，未找到时回退平台管理 agent（普通推导，成本可忽略）
  const resolvedAgentId = agents.some((agent) => agent.id === DEFAULT_WORKFLOW_AGENT_ID)
    ? DEFAULT_WORKFLOW_AGENT_ID
    : FALLBACK_WORKFLOW_AGENT_ID

  // M1 无选择器 UI：助手不设固定引擎——claude-sdk 优先，无匹配渠道时跨引擎回退
  // （OpenAI 格式渠道如 DeepSeek 走 codex 档；会话侧会按选中 provider 自动校准引擎）。
  // 曾因只认 claude-sdk 导致 OpenAI 格式渠道永远报「尚未找到可用模型渠道」（2026-09-25 实测暴露）。
  const selectedProvider = useMemo<ProviderProfile | null>(
    () => getPreferredProviderWithAdapterFallback(providers, undefined, 'claude-sdk') ?? null,
    [providers],
  )

  const toolContext = useMemo<WorkflowToolContext>(
    () => ({
      getEditorState: () => editorStateRef.current,
      createWorkflow: async ({ name, graph }) => {
        const res = await window.spark.invoke('workflow:create', { name, graph })
        // 新图即本会话产物：落库瞬间就认领归属，不依赖调用方记得回调 onWorkflowCreated，
        // 否则编辑器随后切到新 id 会被换绑守卫误清会话。归属变更后由持久化 effect 写入新 key。
        sessionOwnerRef.current = res.workflow.id
        return { workflowId: res.workflow.id, updatedAt: res.workflow.updatedAt }
      },
      updateWorkflow: async ({ id, name, graph }) => {
        const res = await window.spark.invoke('workflow:update', {
          id,
          ...(name != null ? { name } : {}),
          graph,
        })
        return { updatedAt: res.workflow.updatedAt }
      },
      getWorkflowUpdatedAt: async (id) => {
        const res = await window.spark.invoke('workflow:get', { id })
        return res.workflow?.updatedAt ?? null
      },
      validateGraph: async (graph) => {
        // 熔断：本轮连续失败达到上限后不再真调，直接返回熔断响应（E2-3）
        if (validateCircuit.isTripped()) return circuitBrokenResponse(3)
        const result = await window.spark.invoke('workflow:validate', { graph })
        validateCircuit.record(result.ok)
        return result
      },
      onWorkflowCreated: (workflowId) => {
        // 首轮会话常建于落库前（workflowId 为 null），新图生成后由本回调认领，避免换绑守卫误清会话。
        sessionOwnerRef.current = workflowId
        onWorkflowCreated(workflowId)
      },
    }),
    [onWorkflowCreated, validateCircuit],
  )

  const toolHost = useWorkflowToolHost({ sessionId, context: toolContext })

  const handleSend = useCallback(
    async (text: string, _attachments: SessionAttachment[]) => {
      if (editorStateRef.current == null) {
        throw new Error('工作流编辑器尚未就绪，无法启动 Agent。')
      }
      if (selectedProvider == null) {
        throw new Error('尚未找到可用模型渠道：请先在「模型」页配置并启用至少一个渠道。')
      }
      try {
        setCreating(true)
        setSendError(null)
        // 新 turn：重置修复熔断（E2-3 §3 同轮计数）
        validateCircuit.reset()
        let sid = sessionId
        if (sid == null) {
          const sessionRes = await window.spark.invoke('session:create', {
            providerProfileId: selectedProvider.id,
            agentId: resolvedAgentId,
            // 按选中渠道的引擎显式指定 adapter：DeepSeek 等 OpenAI 格式渠道走 codex 档。
            // 缺省回退 agent 默认引擎（claude）会导致 CLAUDE_MODEL_NOT_FOUND（2026-09-25 实测暴露）。
            agentAdapter: getProviderAdapterKind(selectedProvider),
            chatMode: 'agent',
            title: `工作流助手 · ${editorStateRef.current.name}`,
          })
          sid = sessionRes.sessionId
          setSessionId(sid)
          sessionOwnerRef.current = editorStateRef.current?.workflowId ?? null
        }
        // 强制绑定 workflow-architect 技能（对称画布 syncSessionSkills：session 级替换）
        await window.spark.invoke('skill-config:update', {
          scope: 'session',
          scopeRef: sid,
          skillIds: [REQUIRED_WORKFLOW_SKILL_ID],
          disabledSkillIds: [],
        })
        await toolHost.ensureAttached(sid)
        // 每轮前缀注入（反上下文腐化）：元信息 + 图摘要 + 工具纪律；熔断激活时附带熔断声明
        const state = editorStateRef.current
        const message = `${buildWorkflowTurnPrefix(state, {
          circuitBroken: validateCircuit.isTripped(),
        })}

---

${text}`
        // 回滚快照：本轮提交前的图深拷贝（turnId 关联，供「撤销本轮」）
        const snapshot = JSON.parse(JSON.stringify(state.graph)) as WorkflowGraph
        const turnResult = await window.spark.invoke('session:submit-turn', {
          sessionId: sid as never,
          message,
          providerProfileId: selectedProvider.id,
          skillId: REQUIRED_WORKFLOW_SKILL_ID,
          skillIds: [REQUIRED_WORKFLOW_SKILL_ID],
        })
        turnSnapshotsRef.current.set(turnResult.turnId, snapshot)
        while (turnSnapshotsRef.current.size > TURN_SNAPSHOT_LIMIT) {
          const oldest = turnSnapshotsRef.current.keys().next().value
          if (oldest == null) break
          turnSnapshotsRef.current.delete(oldest)
        }
        setCanUndoTurn(true)
      } catch (sendError) {
        setSendError(sendError instanceof Error ? sendError.message : String(sendError))
        throw sendError
      } finally {
        setCreating(false)
      }
    },
    [resolvedAgentId, selectedProvider, sessionId, toolHost, validateCircuit],
  )

  /** 撤销本轮：恢复到最近一次提交前的图（E2-3 checkpoint） */
  const handleUndoLastTurn = useCallback(() => {
    const entries = Array.from(turnSnapshotsRef.current.entries())
    const last = entries.at(-1)
    if (last == null) return
    const [, snapshot] = last
    turnSnapshotsRef.current.delete(last[0])
    setCanUndoTurn(turnSnapshotsRef.current.size > 0)
    onRestoreGraph?.(snapshot)
  }, [onRestoreGraph])

  if (!open) return null

  const activeAgent = agents.find((agent) => agent.id === resolvedAgentId) ?? null
  const fallbackAssistant = {
    agentId: activeAgent?.id ?? resolvedAgentId,
    agentName: activeAgent?.name ?? '工作流助手',
  }

  return (
    <div className="workflow-agent-panel" role="dialog" aria-label="工作流 AI 助手">
      <div className="workflow-agent-panel-header">
        <div className="workflow-agent-panel-title">
          <Icons.Sparkles size={14} />
          <span>工作流 AI 助手</span>
          <button
            type="button"
            className="workflow-agent-panel-undo"
            disabled={!canUndoTurn}
            title="撤销最近一轮 Agent 的图修改（恢复到该轮提交前的状态）"
            onClick={handleUndoLastTurn}
          >
            <Icons.Undo2 size={12} />
            撤销本轮
          </button>
          <span
            className={`workflow-agent-connection is-${toolHost.status}`}
            title={toolHost.error ?? undefined}
          >
            {CONNECTION_LABELS[toolHost.status] ?? toolHost.status}
          </span>
        </div>
        <button
          type="button"
          className="workflow-agent-panel-close"
          aria-label="关闭"
          onClick={onClose}
        >
          <Icons.X size={14} />
        </button>
      </div>
      <ChatPanel
        hideAssistantAvatar
        sessionId={sessionId}
        loading={creating}
        error={sendError}
        onSend={handleSend}
        initialInput={draftInput}
        onDraftChange={setDraftInput}
        agents={agents}
        fallbackAssistant={fallbackAssistant}
        contextBadge={
          <>
            <Icons.Layers size={12} />
            <span className="workflow-agent-context-copy">
              {editorState?.name ?? '未打开工作流'}
              {editorState != null && ` · ${editorState.graph.nodes.length} 节点`}
            </span>
            <span className={`workflow-agent-connection is-${toolHost.status}`}>
              {CONNECTION_LABELS[toolHost.status] ?? toolHost.status}
            </span>
          </>
        }
        toolNamePrefixFilter={WORKFLOW_TOOL_PREFIX}
        toolCallDisplay="summary"
        placeholder="描述你想生成或修改的工作流…"
        voiceInput
      />
    </div>
  )
}
