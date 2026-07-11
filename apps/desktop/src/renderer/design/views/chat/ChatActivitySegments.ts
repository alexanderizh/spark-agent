import type { UIBlock } from '../../services/event-mapper'
import { filterDocumentOutputFiles } from './ChatDocumentOutput'

export type ToolLogGroupKind = 'read' | 'write' | 'command' | 'tool'

export type ChatActivityBlock = Extract<
  UIBlock,
  { kind: 'thinking' | 'tool_call' | 'terminal' | 'file_change' | 'checkpoint' }
>

export type ChatActivityTimelineItem =
  | {
      kind: 'activity'
      key: string
      blocks: ChatActivityBlock[]
      sealed: boolean
    }
  | {
      kind: 'content'
      key: string
      block: UIBlock
    }

function normalizeToolName(name: string): string {
  return name
    .replace(/^functions__/, '')
    .replace(/^mcp__[^_]+__/, '')
    .toLowerCase()
}

export function getToolLogGroupKind(
  block: UIBlock,
  surface: 'main' | 'inspector',
): ToolLogGroupKind | null {
  if (block.kind === 'terminal') return surface === 'inspector' ? 'command' : null
  if (block.kind !== 'tool_call') return null
  const name = normalizeToolName(block.toolName)
  if (
    name === 'todo_write' ||
    block.toolName === 'mcp__spark_team__agent_dispatch' ||
    name.endsWith('present_files')
  ) {
    return null
  }
  if (
    name === 'bash' ||
    name === 'run_command' ||
    name.includes('shell') ||
    name.includes('terminal')
  ) {
    return 'command'
  }
  if (
    name === 'read' ||
    name === 'read_file' ||
    name === 'grep' ||
    name === 'grep_files' ||
    name === 'list' ||
    name === 'ls' ||
    name.includes('search')
  ) {
    return 'read'
  }
  if (
    name === 'edit' ||
    name === 'edit_file' ||
    name === 'write' ||
    name === 'write_file' ||
    name === 'apply_patch' ||
    name.includes('replace')
  ) {
    return 'write'
  }
  return 'tool'
}

export function isChatActivityBlock(block: UIBlock): block is ChatActivityBlock {
  if (block.kind === 'thinking' || block.kind === 'terminal' || block.kind === 'checkpoint') {
    return true
  }
  if (block.kind === 'file_change') return block.diff != null && block.diff.trim().length > 0
  return block.kind === 'tool_call' && getToolLogGroupKind(block, 'main') != null
}

function stableBlockIdentity(block: UIBlock, fallbackOrdinal: number): string {
  if ((block.kind === 'thinking' || block.kind === 'text') && block.segmentId != null) {
    return `${block.kind}:${block.segmentId}`
  }
  if ('toolCallId' in block && typeof block.toolCallId === 'string') {
    const prefix =
      block.kind === 'terminal' ? 'terminal' : block.kind === 'tool_call' ? 'tool' : block.kind
    return `${prefix}:${block.toolCallId}`
  }
  if (block.kind === 'checkpoint') return `checkpoint:${block.checkpointId}`
  if (block.kind === 'file_change') return `file:${block.path}`
  return `${block.kind}-index:${fallbackOrdinal}`
}

function uniqueTimelineKey(baseKey: string, occurrences: Map<string, number>): string {
  const occurrence = (occurrences.get(baseKey) ?? 0) + 1
  occurrences.set(baseKey, occurrence)
  return occurrence === 1 ? baseKey : `${baseKey}:${occurrence}`
}

export function splitChatActivitySegments(blocks: UIBlock[]): ChatActivityTimelineItem[] {
  const items: ChatActivityTimelineItem[] = []
  const keyOccurrences = new Map<string, number>()
  let activity: Extract<ChatActivityTimelineItem, { kind: 'activity' }> | null = null
  let activityOrdinal = 0
  let contentOrdinal = 0

  blocks.forEach((block) => {
    if (
      block.kind === 'context_ledger' ||
      (block.kind === 'file_change' && (block.diff == null || block.diff.trim().length === 0)) ||
      (block.kind === 'presented_files' && filterDocumentOutputFiles(block.files).length === 0)
    ) {
      return
    }

    if (isChatActivityBlock(block)) {
      if (activity == null) {
        activityOrdinal += 1
        activity = {
          kind: 'activity',
          key: uniqueTimelineKey(
            `activity:${stableBlockIdentity(block, activityOrdinal)}`,
            keyOccurrences,
          ),
          blocks: [],
          sealed: false,
        }
        items.push(activity)
      }
      activity.blocks.push(block)
      return
    }

    if (activity != null) activity.sealed = true
    activity = null
    contentOrdinal += 1
    items.push({
      kind: 'content',
      key: uniqueTimelineKey(
        `content:${stableBlockIdentity(block, contentOrdinal)}`,
        keyOccurrences,
      ),
      block,
    })
  })

  return items
}

export function isChatActivitySegmentRunning(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'thinking') return block.isStreaming
    if (block.kind === 'tool_call') return block.status === 'pending' || block.status === 'running'
    if (block.kind === 'terminal') return block.isStreaming
    return false
  })
}

export function summarizeChatActivitySegment(blocks: UIBlock[]): string {
  const counts: Record<ToolLogGroupKind, number> = {
    read: 0,
    command: 0,
    write: 0,
    tool: 0,
  }
  const commandToolCallIds = new Set<string>()
  const changedPaths = new Set<string>()
  let hasThinking = false

  for (const block of blocks) {
    if (block.kind === 'thinking') {
      hasThinking = true
      continue
    }
    if (block.kind === 'file_change') {
      changedPaths.add(block.path)
      continue
    }
    if (block.kind === 'terminal') {
      if (!commandToolCallIds.has(block.toolCallId)) {
        counts.command += 1
        commandToolCallIds.add(block.toolCallId)
      }
      continue
    }
    if (block.kind !== 'tool_call') continue
    const kind = getToolLogGroupKind(block, 'main')
    if (kind == null) continue
    if (kind === 'command') {
      if (!commandToolCallIds.has(block.toolCallId)) counts.command += 1
      commandToolCallIds.add(block.toolCallId)
    } else {
      counts[kind] += 1
    }
  }

  if (counts.write === 0) counts.write = changedPaths.size

  const parts = [
    counts.read > 0 ? `查看了 ${counts.read} 个文件` : '',
    counts.command > 0 ? `运行了 ${counts.command} 条命令` : '',
    counts.write > 0 ? `修改了 ${counts.write} 个文件` : '',
    counts.tool > 0 ? `调用了 ${counts.tool} 个工具` : '',
    hasThinking ? '进行了思考' : '',
  ].filter(Boolean)

  return parts.join(' · ') || '活动记录'
}
