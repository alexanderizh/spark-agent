import type { CanvasNode, CanvasNodeType } from './canvas.types'

const NUMBERED_TITLE_PREFIX = /^#(\d+)\s+/
const LEGACY_NUMBERED_TITLE_SUFFIX = /\s+#(\d+)$/

const NODE_TYPE_LABELS: Partial<Record<CanvasNodeType, string>> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  text: '文本',
  prompt: 'Prompt',
  group: '分组',
  text_to_image: '文生图',
  image_to_image: '图生图',
  image_edit: '图片编辑',
  image_compose: '多图合成',
  storyboard_grid: '故事板',
  panorama_360: '全景图',
  text_generate: '文本生成',
  text_rewrite: '文本改写',
  prompt_optimize: 'Prompt 优化',
  text_to_video: '文生视频',
  image_to_video: '图生视频',
  video_edit: '视频编辑',
  video_extend: '视频扩展',
  text_to_audio: '文生音频',
  audio_transcribe: '语音转写',
  task: '任务',
}

export function canvasNodeTypeLabel(type: CanvasNodeType): string {
  return NODE_TYPE_LABELS[type] ?? '节点'
}

export function readCanvasNodeNumber(node: Pick<CanvasNode, 'title' | 'data'>): number | null {
  const stored = node.data.nodeSequence
  if (typeof stored === 'number' && Number.isSafeInteger(stored) && stored > 0) return stored

  const title = node.title?.trim()
  if (!title) return null
  const matched = title.match(NUMBERED_TITLE_PREFIX) ?? title.match(LEGACY_NUMBERED_TITLE_SUFFIX)
  const parsed = matched ? Number(matched[1]) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function nextCanvasNodeNumber(nodes: readonly CanvasNode[], boardId: string): number {
  let maxNumber = 0
  for (const node of nodes) {
    if (node.boardId !== boardId || node.hidden) continue
    maxNumber = Math.max(maxNumber, readCanvasNodeNumber(node) ?? 0)
  }
  return maxNumber + 1
}

export function stripCanvasNodeNumber(title: string | null | undefined): string {
  const normalized = title?.trim() ?? ''
  return normalized
    .replace(NUMBERED_TITLE_PREFIX, '')
    .replace(LEGACY_NUMBERED_TITLE_SUFFIX, '')
    .trim()
}

export function formatCanvasNodeTitle(
  nodeNumber: number,
  title: string | null | undefined,
  fallbackTitle = '节点',
): string {
  const contentTitle = stripCanvasNodeNumber(title) || fallbackTitle
  return `#${nodeNumber} ${contentTitle}`
}

export function createCanvasNodeNaming(input: {
  nodes: readonly CanvasNode[]
  boardId: string
  type: CanvasNodeType
  title?: string | null | undefined
}): { nodeNumber: number; title: string } {
  const nodeNumber = nextCanvasNodeNumber(input.nodes, input.boardId)
  return {
    nodeNumber,
    title: formatCanvasNodeTitle(nodeNumber, input.title, canvasNodeTypeLabel(input.type)),
  }
}

export function renameCanvasNode(
  node: Pick<CanvasNode, 'title' | 'data'>,
  title: string | null | undefined,
  fallbackTitle = '节点',
): string {
  const nodeNumber = readCanvasNodeNumber(node)
  return nodeNumber == null
    ? stripCanvasNodeNumber(title) || fallbackTitle
    : formatCanvasNodeTitle(nodeNumber, title, fallbackTitle)
}

export function canvasNodeDownloadName(
  node: Pick<CanvasNode, 'title' | 'data'> | null | undefined,
  artifactTitle: string | null | undefined,
  fallbackTitle: string,
): string {
  const artifactName = stripCanvasNodeNumber(artifactTitle) || fallbackTitle
  const nodeNumber = node ? readCanvasNodeNumber(node) : null
  return nodeNumber == null ? artifactName : `${nodeNumber}-${artifactName}`
}
