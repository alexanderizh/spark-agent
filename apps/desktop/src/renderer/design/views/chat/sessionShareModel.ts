import { NO_PROJECT_WORKSPACE_NAME } from '@spark/protocol'
import type { UIBlock, UIMessage } from '../../services/event-mapper'

/** 长图逻辑宽度兜底，对齐会话内容列的最小阅读宽度。 */
export const SHARE_SHEET_WIDTH = 900
/** 目标导出倍率。在画布尺寸允许时固定 2×，避免跟系统缩放绑在一起忽大忽小。 */
export const SHARE_TARGET_SCALE = 2
/**
 * 低于这个倍率就先丢掉较早的消息，而不是把整段对话缩成糊图。
 * 画布单边上限见 SHARE_MAX_BITMAP_EDGE。
 */
export const SHARE_MIN_CAPTURE_SCALE = 0.8
/** 常见浏览器画布单边安全上限。超过后 toBlob 会直接失败。 */
export const SHARE_MAX_BITMAP_EDGE = 16384

const TOOL_LABELS: Record<string, string> = {
  Read: '读取文件',
  read_file: '读取文件',
  Edit: '编辑文件',
  Write: '写入文件',
  MultiEdit: '编辑文件',
  Bash: '终端',
  bash: '终端',
  run_command: '终端',
  Grep: '搜索',
  Glob: '查找文件',
  WebSearch: '网页搜索',
  WebFetch: '打开网页',
  todo_write: '更新待办',
}

export interface SessionShareAttachment {
  name: string
  previewUrl?: string
}

export interface SessionShareEntry {
  id: string
  role: 'user' | 'assistant'
  name: string
  timeLabel: string
  text: string
  notes: string[]
  attachments: SessionShareAttachment[]
}

export function readLiveShareSheetMetrics(): {
  width: number
  paddingLeft: number
  paddingRight: number
} {
  if (typeof document === 'undefined') {
    return { width: SHARE_SHEET_WIDTH, paddingLeft: 24, paddingRight: 24 }
  }
  const inner = document.querySelector<HTMLElement>('.chat-main-active .chat-stream-inner')
  if (inner == null) {
    return { width: SHARE_SHEET_WIDTH, paddingLeft: 24, paddingRight: 24 }
  }
  const width = inner.getBoundingClientRect().width
  const style = window.getComputedStyle(inner)
  return {
    width: width >= 480 ? Math.round(width) : SHARE_SHEET_WIDTH,
    paddingLeft: Number.parseFloat(style.paddingLeft) || 24,
    paddingRight: Number.parseFloat(style.paddingRight) || 24,
  }
}

export function maxShareSheetCssHeight(): number {
  return Math.floor(SHARE_MAX_BITMAP_EDGE / SHARE_MIN_CAPTURE_SCALE)
}

/** 在目标倍率、画布边长上限之间取安全倍率，保证整张长图都能画出来。 */
export function resolveShareCaptureScale(cssWidth: number, cssHeight: number): number {
  const width = Math.max(1, cssWidth)
  const height = Math.max(1, cssHeight)
  const scale = Math.min(
    SHARE_TARGET_SCALE,
    SHARE_MAX_BITMAP_EDGE / width,
    SHARE_MAX_BITMAP_EDGE / height,
  )
  // 向下取两位，避免四舍五入之后单边超出画布上限。
  const stepped = Math.floor(scale * 100) / 100
  return stepped > 0 ? stepped : scale
}

/**
 * 内容超过清晰度预算时，计算下一轮要省略的较早消息数。
 * 至少保留最新一条，并且每轮都比上一轮多省略，避免测量死循环。
 */
export function nextOmittedMessageCount(
  total: number,
  alreadyOmitted: number,
  scrollHeight: number,
  maxHeight: number,
): number {
  const visible = total - alreadyOmitted
  if (visible <= 1 || scrollHeight <= maxHeight) return alreadyOmitted
  const ratio = maxHeight / Math.max(scrollHeight, 1)
  const keep = Math.max(1, Math.floor(visible * ratio * 0.9))
  const next = total - keep
  if (next <= alreadyOmitted) return Math.min(total - 1, alreadyOmitted + 1)
  return next
}

export function buildSessionShareFileName(title: string, at: Date): string {
  const safe =
    title
      .trim()
      .replace(/[\\/:*?"<>|\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '会话'
  const year = at.getFullYear()
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `SparkWork-${safe}-${year}-${month}-${day}.png`
}

export function buildSessionShareCaption(input: {
  workspaceName?: string | null | undefined
  shownCount: number
  totalCount: number
  generatedAt: Date
}): string {
  const workspace = normalizeWorkspaceName(input.workspaceName)
  const count =
    input.shownCount < input.totalCount
      ? `最近 ${input.shownCount} / ${input.totalCount} 条`
      : `${input.totalCount} 条消息`
  const when = input.generatedAt.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return [workspace, count, when].filter(Boolean).join('  ·  ')
}

export function buildSessionShareEntries(
  messages: UIMessage[],
  options: { generatedAt?: Date; assistantFallbackName?: string } = {},
): SessionShareEntry[] {
  const generatedAt = options.generatedAt ?? new Date()
  const assistantFallbackName = options.assistantFallbackName?.trim() || 'SparkWork'
  return messages.flatMap((message) => {
    const entry = projectMessage(message, generatedAt, assistantFallbackName)
    return entry == null ? [] : [entry]
  })
}

function projectMessage(
  message: UIMessage,
  generatedAt: Date,
  assistantFallbackName: string,
): SessionShareEntry | null {
  const textParts: string[] = []
  const notes: string[] = []
  const toolCounts = new Map<string, number>()
  const changedFiles: string[] = []
  let fileSummary: string | null = null
  let errorCount = 0

  for (const block of message.blocks) {
    collectBlock(block, textParts, notes, toolCounts, changedFiles, (summary) => {
      fileSummary = summary
    }, () => {
      errorCount += 1
    })
  }

  if (toolCounts.size > 0) {
    const parts = [...toolCounts.entries()]
      .slice(0, 6)
      .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    const extra = toolCounts.size > 6 ? ` 等 ${toolCounts.size} 类` : ''
    notes.unshift(`调用 ${parts.join('、')}${extra}`)
  }
  if (fileSummary) notes.push(fileSummary)
  else if (changedFiles.length > 0) {
    const preview = changedFiles.slice(0, 3).join('、')
    const extra = changedFiles.length > 3 ? ` 等 ${changedFiles.length} 个` : ''
    notes.push(`文件改动 ${preview}${extra}`)
  }
  if (message.status === 'streaming') notes.push('仍在生成')
  else if (message.status === 'cancelled' && !notes.some((note) => note.includes('已停止'))) {
    notes.push('已停止')
  } else if (message.status === 'error' && errorCount === 0) {
    notes.push('本轮出错')
  }

  const text = textParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n')
  const attachments = (message.attachments ?? []).map((attachment) => {
    const previewUrl = usablePreview(attachment.previewUrl)
    return {
      name: attachment.name?.trim() || baseName(attachment.path) || '附件',
      ...(previewUrl != null ? { previewUrl } : {}),
    }
  })

  if (text.length === 0 && notes.length === 0 && attachments.length === 0) return null

  return {
    id: message.id,
    role: message.role,
    name: message.role === 'user' ? '我' : message.agentName?.trim() || assistantFallbackName,
    timeLabel: formatShareMessageTime(message.timestamp, generatedAt),
    text,
    notes: notes.slice(0, 8),
    attachments,
  }
}

function collectBlock(
  block: UIBlock,
  textParts: string[],
  notes: string[],
  toolCounts: Map<string, number>,
  changedFiles: string[],
  setFileSummary: (summary: string) => void,
  countError: () => void,
): void {
  switch (block.kind) {
    case 'text':
      textParts.push(block.content)
      return
    case 'plan_proposed':
      if (block.plan.trim().length > 0) textParts.push(`**执行方案**\n\n${block.plan.trim()}`)
      return
    case 'tool_call': {
      const label = labelForTool(block.toolName)
      toolCounts.set(label, (toolCounts.get(label) ?? 0) + 1)
      return
    }
    case 'turn_file_summary':
      setFileSummary(
        block.files.length > 0
          ? `改动 ${block.files.length} 个文件 · +${block.totalAdds} −${block.totalDels}`
          : `代码改动 · +${block.totalAdds} −${block.totalDels}`,
      )
      return
    case 'file_change':
      changedFiles.push(baseName(block.path))
      return
    case 'error':
      countError()
      if (notes.filter((note) => note.startsWith('出错')).length < 2) {
        notes.push(`出错 · ${clip(block.title || block.message)}`)
      }
      return
    case 'cancelled':
      notes.push(clip(block.message || '已停止'))
      return
    case 'diagram_block':
      notes.push(block.title.trim() ? `图表 · ${clip(block.title, 80)}` : '图表')
      return
    case 'html_block':
      notes.push(block.title.trim() ? `页面 · ${clip(block.title, 80)}` : '页面')
      return
    case 'subagent':
      notes.push(clip(`${block.name}：${block.resultSummary || block.progressSummary || block.task}`))
      return
    case 'presented_files':
      if (block.files.length > 0) {
        const names = block.files
          .slice(0, 3)
          .map((file) => file.title?.trim() || baseName(file.path))
        const extra = block.files.length > 3 ? ` 等 ${block.files.length} 个` : ''
        notes.push(`交付 ${names.join('、')}${extra}`)
      }
      return
    case 'goal_contract':
      notes.push(`目标 · ${clip(block.objective, 180)}`)
      return
    case 'goal_iteration_divider':
      if (block.resultSummary?.trim()) notes.push(`第 ${block.iteration} 轮 · ${clip(block.resultSummary)}`)
      return
    default:
      return
  }
}

function labelForTool(toolName: string): string {
  const short = toolName.replace(/^mcp__[^_]+__/, '').replace(/^functions\./, '')
  return TOOL_LABELS[short] ?? TOOL_LABELS[toolName] ?? humanize(short)
}

function humanize(name: string): string {
  const text = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text || name
}

function formatShareMessageTime(iso: string | undefined, now: Date): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeWorkspaceName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? ''
  if (trimmed.length === 0 || trimmed === NO_PROJECT_WORKSPACE_NAME) return null
  return trimmed
}

function usablePreview(url: string | undefined): string | undefined {
  if (!url) return undefined
  return /^(data:|blob:|https?:|safe-file:)/i.test(url) ? url : undefined
}

function baseName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}
