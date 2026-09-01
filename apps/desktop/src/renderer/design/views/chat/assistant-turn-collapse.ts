import type { UIBlock, UIMessage } from '../../services/event-mapper'
import { filterDocumentOutputFiles } from './ChatDocumentOutput'
import { filterMediaPresentedFiles } from './PresentedMedia'

export interface AssistantTurnCollapseProjection {
  canCollapse: boolean
  collapsedBlocks: readonly UIBlock[]
}

/**
 * Computes the renderer-only collapsed projection for one assistant turn.
 * `assistant_message.isFinal` identifies the summary block, but the projection
 * remains unavailable until the whole normalized UIMessage is completed.
 */
export function projectAssistantTurnCollapse(
  status: UIMessage['status'] | undefined,
  blocks: readonly UIBlock[],
): AssistantTurnCollapseProjection {
  const summaryBlocks = findFinalSummaryBlocks(blocks)
  const canCollapse =
    status === 'completed' && summaryBlocks.length > 0 && !blocks.some(blocksAutomaticTurnCollapse)

  return {
    canCollapse,
    collapsedBlocks: canCollapse
      ? [...summaryBlocks, ...blocks.filter(isArtifactPresentationBlock)]
      : blocks,
  }
}

/**
 * 自包含的产物展示块：折叠后仍需直接可见的交付物。
 * 覆盖显式交付文件（文档/媒体）、渲染成功的 HTML/图表产物，
 * 以及面向交付结果的汇总卡片（修改文件汇总、建议验证、应用快照）；
 * 系统过程提示（上下文压缩、重试轨迹、checkpoint）与思考/工具日志仍随折叠收起；
 * 无可展示内容的块不保留，避免折叠态出现空卡片。
 */
function isArtifactPresentationBlock(block: UIBlock): boolean {
  switch (block.kind) {
    case 'presented_files':
      return (
        filterDocumentOutputFiles(block.files).length > 0 ||
        filterMediaPresentedFiles(block.files).length > 0
      )
    case 'html_block':
    case 'diagram_block':
      return block.status === 'rendered'
    case 'turn_file_summary':
      return block.files.length > 0
    case 'validation_suggestion':
      return block.summary.trim().length > 0 || block.commands.length > 0
    case 'application_snapshot':
      return block.previewUrl.trim().length > 0
    default:
      return false
  }
}

function findFinalSummaryBlocks(blocks: readonly UIBlock[]): UIBlock[] {
  const hostFinalIndex = findLastIndex(
    blocks,
    (block) =>
      block.kind === 'text' && block.isFinalAnswer === true && block.content.trim().length > 0,
  )
  if (hostFinalIndex >= 0) {
    return collectTrailingBodyRun(blocks, hostFinalIndex, 'text', true)
  }

  const memberFinalIndex = findLastIndex(
    blocks,
    (block) =>
      block.kind === 'team_member_message' &&
      block.isFinalAnswer === true &&
      block.content.trim().length > 0,
  )
  if (memberFinalIndex >= 0) {
    return collectTrailingBodyRun(blocks, memberFinalIndex, 'team_member_message', true)
  }

  // Legacy histories may predate the explicit final-answer hint. Use only the
  // trailing continuous body after the last process block; delivery cards are
  // independent presentation and do not split the summary body.
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block == null || skipsBodyContinuity(block)) continue
    if (block.kind === 'text' && block.content.trim().length > 0) {
      return collectTrailingBodyRun(blocks, index, 'text')
    }
    if (block.kind === 'team_member_message' && block.content.trim().length > 0) {
      return collectTrailingBodyRun(blocks, index, 'team_member_message')
    }
    return []
  }

  return []
}

function collectTrailingBodyRun(
  blocks: readonly UIBlock[],
  endIndex: number,
  kind: 'text' | 'team_member_message',
  explicitAnchor = false,
): UIBlock[] {
  const anchor = blocks[endIndex]
  type SummaryBodyBlock =
    | Extract<UIBlock, { kind: 'text' }>
    | Extract<UIBlock, { kind: 'team_member_message' }>
  const summaryBlocks: SummaryBodyBlock[] = []
  let foundProcessBoundary = false

  for (let index = endIndex; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block == null || skipsBodyContinuity(block)) continue
    if (block.kind !== 'text' && block.kind !== 'team_member_message') {
      foundProcessBoundary = true
      break
    }
    if (block.kind !== kind || block.content.trim().length === 0) {
      foundProcessBoundary = true
      break
    }
    if (
      block.kind === 'team_member_message' &&
      anchor?.kind === 'team_member_message' &&
      (block.dispatchId !== anchor.dispatchId || block.memberAgentId !== anchor.memberAgentId)
    ) {
      break
    }
    summaryBlocks.unshift(block)
  }

  if (explicitAnchor && !foundProcessBoundary) {
    return summaryBlocks.filter((block) => block.isFinalAnswer === true)
  }
  return summaryBlocks
}

function isDeliveryPresentationKind(block: UIBlock): boolean {
  switch (block.kind) {
    case 'presented_files':
    case 'html_block':
    case 'diagram_block':
    case 'turn_file_summary':
    case 'validation_suggestion':
    case 'application_snapshot':
      return true
    default:
      return false
  }
}

/**
 * 时间线不可见块：渲染层不为它们产生任何可见内容（快捷回复仅在输入框上方展示、
 * present_files 工具调用被时间线隐藏，见 ChatView 的 renderBlocks 与 isHiddenTimelineBlock）。
 * 它们既不是过程日志也不占正文位置，不应切断最终正文的连续性。
 */
function isTimelineInvisibleBlock(block: UIBlock): boolean {
  if (block.kind === 'quick_replies') return true
  return block.kind === 'tool_call' && block.toolName.toLowerCase().endsWith('present_files')
}

/** 不参与正文连续性判定的块：独立交付展示卡 + 时间线不可见块。 */
function skipsBodyContinuity(block: UIBlock): boolean {
  return isDeliveryPresentationKind(block) || isTimelineInvisibleBlock(block)
}

function findLastIndex(blocks: readonly UIBlock[], predicate: (block: UIBlock) => boolean): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block != null && predicate(block)) return index
  }
  return -1
}

function blocksAutomaticTurnCollapse(block: UIBlock): boolean {
  switch (block.kind) {
    case 'text':
    case 'thinking':
    case 'terminal':
    case 'team_member_message':
      return block.isStreaming
    case 'tool_call':
      return block.status === 'pending' || block.status === 'running'
    case 'subagent':
      return block.status === 'running' || block.status === 'paused'
    case 'team_dispatch':
      return block.state === 'pending' || block.state === 'working'
    case 'workflow_progress':
      return block.runStatus === 'working'
    case 'goal_iteration_divider':
      return block.state === 'running'
    case 'html_block':
    case 'diagram_block':
      return block.status === 'pending'
    case 'plan_proposed':
    case 'permission_request':
    case 'cancelled':
      return true
    case 'goal_contract':
      return block.state === 'pending'
    case 'user_question':
      return !block.answered
    case 'error':
      return true
    case 'runtime_signal':
      return block.level !== 'info'
    default:
      return false
  }
}
