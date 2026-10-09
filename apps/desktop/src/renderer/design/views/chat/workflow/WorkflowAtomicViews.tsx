/**
 * WorkflowAtomicViews — 工作流原子节点（input/route/plan/review/skill/tool/mcp/artifact）
 * 在会话时间线中的紧凑展示。
 *
 * 原子节点经临时 worker 真实派发（合成 id 前缀 `workflow-atomic:`），复用团队派发通道；
 * 直接套用 TeamDispatchCard 会把整段节点 prompt 平铺出来且运行态强制展开。这里按
 * 合成 id 前缀分流到紧凑变体：
 * - 派发卡：一行「节点标题 · 节点类型 · 状态 · 摘要」，默认收起（运行中也收起），
 *   点击展开完整 prompt 保留调试能力；
 * - 成员消息：节点名显示人类可读标题（从同消息的 workflow_progress 块反查 nodeId），
 *   终态内容若为合法 JSON 包 ```json 围栏，复用 MarkdownText 现成代码块渲染。
 *
 * 分流条件只认 `workflow-atomic:` 前缀：真实团队成员 / AutoRouter worker / subagent
 * 的 id 不带该前缀，一律不命中，继续走原有组件，零行为变化。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { TeamA2AReply } from '@spark/protocol'
import { Icons } from '../../../Icons'
import type { UIBlock } from '../../../services/event-mapper'
import './WorkflowAtomicViews.less'

/** 与运行时 workflowAtomicMemberId() 保持一致的合成 id 前缀。 */
export const WORKFLOW_ATOMIC_MEMBER_ID_PREFIX = 'workflow-atomic:'

export function isWorkflowAtomicMemberId(memberAgentId: string): boolean {
  return memberAgentId.startsWith(WORKFLOW_ATOMIC_MEMBER_ID_PREFIX)
}

/** 解析原子 worker 合成 id 里的节点 id；非原子 id 返回 null。 */
export function parseWorkflowAtomicNodeId(memberAgentId: string): string | null {
  if (!isWorkflowAtomicMemberId(memberAgentId)) return null
  const nodeId = memberAgentId.slice(WORKFLOW_ATOMIC_MEMBER_ID_PREFIX.length)
  return nodeId.length > 0 ? nodeId : null
}

const WORKFLOW_ATOMIC_KIND_LABELS: Record<string, string> = {
  input: '输入解析',
  route: '条件路由',
  skill: '技能',
  tool: '工具',
  mcp: 'MCP',
  plan: '计划',
  review: '复核',
  artifact: '产物',
}

export function workflowAtomicKindLabel(kind: string): string {
  return WORKFLOW_ATOMIC_KIND_LABELS[kind] ?? kind
}

export interface WorkflowAtomicNodeMeta {
  nodeId: string
  title: string
  kind: string
}

/** 从消息 blocks 里的 workflow_progress 块建立 nodeId → 节点元信息索引。 */
export function buildWorkflowAtomicNodeMetaIndex(
  blocks: readonly UIBlock[],
): ReadonlyMap<string, WorkflowAtomicNodeMeta> {
  const index = new Map<string, WorkflowAtomicNodeMeta>()
  for (const block of blocks) {
    if (block.kind !== 'workflow_progress') continue
    for (const node of block.nodes) {
      // 后面的快照更新：同 nodeId 以最新（状态/标题都可能刷新）为准
      index.set(node.nodeId, { nodeId: node.nodeId, title: node.title, kind: node.kind })
    }
  }
  return index
}

function formatWorkflowAtomicNodeName(
  nodeId: string,
  meta: WorkflowAtomicNodeMeta | undefined,
): string {
  const title = meta?.title?.trim()
  return title != null && title.length > 0 ? title : `节点 ${nodeId}`
}

const EMPTY_META_INDEX: ReadonlyMap<string, WorkflowAtomicNodeMeta> = new Map()

/**
 * 原子节点元信息上下文：消息行组件（AssistantMessageRows / AgentMsg）持全量 blocks
 * 时提供；未覆盖的渲染面（或纯函数渲染路径）拿空索引，组件回退显示节点 id。
 */
const WorkflowAtomicNodeMetaContext =
  createContext<ReadonlyMap<string, WorkflowAtomicNodeMeta>>(EMPTY_META_INDEX)

export function WorkflowAtomicNodeMetaProvider({
  blocks,
  children,
}: {
  blocks: readonly UIBlock[]
  children: ReactNode
}) {
  const metaIndex = useMemo(() => buildWorkflowAtomicNodeMetaIndex(blocks), [blocks])
  return (
    <WorkflowAtomicNodeMetaContext.Provider value={metaIndex}>
      {children}
    </WorkflowAtomicNodeMetaContext.Provider>
  )
}

export function useWorkflowAtomicNodeMeta(
  memberAgentId: string,
): { nodeId: string; meta: WorkflowAtomicNodeMeta | null; displayName: string } | null {
  const metaIndex = useContext(WorkflowAtomicNodeMetaContext)
  const nodeId = parseWorkflowAtomicNodeId(memberAgentId)
  if (nodeId == null) return null
  const meta = metaIndex.get(nodeId) ?? null
  return { nodeId, meta, displayName: formatWorkflowAtomicNodeName(nodeId, meta ?? undefined) }
}

/**
 * 原子节点输出的 JSON 代码块包装：内容整体是合法 JSON 时补 ```json 围栏，
 * 交给 MarkdownText 现成的 MarkdownCodeBlock（高亮/复制/折叠）。
 * 纯渲染层变换——落库事件与下游节点的 upstream inputs 均不受影响。
 * 流式期间不包装（由调用方保证），避免半截 JSON 误判与流式闪烁。
 */
export function wrapWorkflowAtomicJsonContent(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length === 0) return content
  if (trimmed.startsWith('```')) return content
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return content
  try {
    JSON.parse(trimmed)
  } catch {
    return content
  }
  return `\`\`\`json\n${trimmed}\n\`\`\``
}

function firstSummaryLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return ''
}

function dispatchSummary(instruction: string, reply: TeamA2AReply | undefined): string {
  const replyLine = reply != null ? firstSummaryLine(reply.content) : ''
  if (replyLine.length > 0 && replyLine !== '{' && replyLine !== '[') return replyLine
  return firstSummaryLine(instruction)
}

/**
 * 原子节点派发的紧凑调用卡（替代 TeamDispatchCard 的原子分支）：
 * 与工作流进度块信息对齐，默认收起（运行中也收起），点击展开完整节点 prompt。
 */
export function WorkflowAtomicDispatchView({
  block,
}: {
  block: Extract<UIBlock, { kind: 'team_dispatch' }>
}) {
  const metaInfo = useWorkflowAtomicNodeMeta(block.memberAgentId)
  const [expanded, setExpanded] = useState(false)
  const running = block.state === 'pending' || block.state === 'working'
  const failed = block.state === 'failed' || block.state === 'canceled'
  const nodeTitle = metaInfo?.displayName ?? block.memberAgentId
  const kindLabel = metaInfo?.meta != null ? workflowAtomicKindLabel(metaInfo.meta.kind) : null
  const summary = dispatchSummary(block.task.instruction, block.reply)
  const ChevronIcon = expanded ? Icons.ChevronDown : Icons.ChevronRight

  return (
    <div className={`workflow-atomic-dispatch${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="workflow-atomic-dispatch-head"
        aria-expanded={expanded}
        title={`${nodeTitle} · 工作流节点`}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="workflow-atomic-dispatch-icon" aria-hidden="true">
          <Icons.WorkflowSimple size={13} />
        </span>
        <span className="workflow-atomic-dispatch-title">{nodeTitle}</span>
        {kindLabel != null && <span className="workflow-atomic-dispatch-kind">{kindLabel}</span>}
        {running && <Icons.Spinner size={12} className="workflow-atomic-dispatch-spinner" />}
        {block.state === 'completed' && (
          <Icons.Check
            size={12}
            className="workflow-atomic-dispatch-state is-done"
            aria-label="已完成"
          />
        )}
        {failed && (
          <Icons.X
            size={12}
            className="workflow-atomic-dispatch-state is-failed"
            aria-label={block.state === 'canceled' ? '已取消' : '失败'}
          />
        )}
        {!expanded && summary.length > 0 && (
          <span className="workflow-atomic-dispatch-summary">{summary}</span>
        )}
        <ChevronIcon size={11} className="workflow-atomic-dispatch-chevron" />
      </button>
      {expanded && (
        <div className="workflow-atomic-dispatch-detail">
          <div className="workflow-atomic-dispatch-detail-head">节点指令</div>
          <div className="workflow-atomic-dispatch-instruction">{block.task.instruction}</div>
          {failed && block.reply?.error?.message != null && (
            <div className="workflow-atomic-dispatch-error">{block.reply.error.message}</div>
          )}
        </div>
      )}
    </div>
  )
}
