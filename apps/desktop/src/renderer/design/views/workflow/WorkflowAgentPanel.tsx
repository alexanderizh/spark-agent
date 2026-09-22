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
import { isProviderCompatibleWithAdapter } from '../../utils/provider-adapter'
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

export function WorkflowAgentPanel({
  open,
  onClose,
  editorState,
  providers,
  agents,
  onWorkflowCreated,
  onRestoreGraph,
}: Props): React.ReactNode | null {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const editorStateRef = useRef<WorkflowEditorState | null>(editorState)
  /** 修复熔断（E2-3）：同轮内 validate 连续失败 ≥3 次后暂停校验/落库，新 turn 重置 */
  const validateCircuit = useRef(createValidateCircuit(3)).current
  /** 每轮回滚快照（turnId → 提交前的图深拷贝），供「撤销本轮」恢复 */
  const turnSnapshotsRef = useRef(new Map<string, WorkflowGraph>())
  const [canUndoTurn, setCanUndoTurn] = useState(false)

  // 同步最新编辑器状态（工具 handler 异步回调里读实时图）；对齐 canvas-tool-host 的 useEffect 模式
  useEffect(() => {
    editorStateRef.current = editorState
  }, [editorState])

  // M1 无选择器 UI：优先内置工作流 agent，未找到时回退平台管理 agent（普通推导，成本可忽略）
  const resolvedAgentId = agents.some((agent) => agent.id === DEFAULT_WORKFLOW_AGENT_ID)
    ? DEFAULT_WORKFLOW_AGENT_ID
    : FALLBACK_WORKFLOW_AGENT_ID

  const selectedProvider = useMemo<ProviderProfile | null>(() => {
    return (
      providers.find((provider) => isProviderCompatibleWithAdapter(provider, 'claude-sdk')) ?? null
    )
  }, [providers])

  const toolContext = useMemo<WorkflowToolContext>(
    () => ({
      getEditorState: () => editorStateRef.current,
      createWorkflow: async ({ name, graph }) => {
        const res = await window.spark.invoke('workflow:create', { name, graph })
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
      onWorkflowCreated: (workflowId) => onWorkflowCreated(workflowId),
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
            chatMode: 'agent',
            title: `工作流助手 · ${editorStateRef.current.name}`,
          })
          sid = sessionRes.sessionId
          setSessionId(sid)
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
      />
    </div>
  )
}
