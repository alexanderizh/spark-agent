import type {
  CanvasCapability,
  CanvasNode,
  CanvasNodeType,
  CanvasOperationType,
} from './canvas.types'

export const CANVAS_CAPABILITIES: CanvasCapability[] = [
  {
    id: 'canvas.text-to-image',
    label: '文生图',
    operation: 'text_to_image',
    inputTypes: ['text', 'prompt'],
    outputTypes: ['image'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.image-edit',
    label: '图生图 / 图片编辑',
    operation: 'image_edit',
    inputTypes: ['image', 'text', 'prompt'],
    outputTypes: ['image'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.image-compose',
    label: '多图合成',
    operation: 'image_compose',
    inputTypes: ['image', 'text', 'prompt'],
    outputTypes: ['image'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.storyboard-grid',
    label: '故事板',
    operation: 'storyboard_grid',
    inputTypes: ['image', 'text', 'prompt'],
    outputTypes: ['image'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.panorama-360',
    label: '360 全景图',
    operation: 'panorama_360',
    inputTypes: ['text', 'prompt', 'image'],
    outputTypes: ['image'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.text-generate',
    label: '文本生成',
    operation: 'text_generate',
    inputTypes: ['text', 'prompt'],
    outputTypes: ['text'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.prompt-optimize',
    label: 'Prompt 优化',
    operation: 'prompt_optimize',
    inputTypes: ['text', 'prompt'],
    outputTypes: ['prompt'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.image-to-video',
    label: '图片转视频',
    operation: 'image_to_video',
    inputTypes: ['image'],
    outputTypes: ['video'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.video-edit',
    label: '视频编辑',
    operation: 'video_edit',
    inputTypes: ['video', 'image', 'text', 'prompt'],
    outputTypes: ['video'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.video-extend',
    label: '视频扩展',
    operation: 'video_extend',
    inputTypes: ['video', 'text', 'prompt'],
    outputTypes: ['video'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.text-to-audio',
    label: '文生音频',
    operation: 'text_to_audio',
    inputTypes: ['text', 'prompt'],
    outputTypes: ['audio'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.audio-transcribe',
    label: '语音转写',
    operation: 'audio_transcribe',
    inputTypes: ['audio'],
    outputTypes: ['text'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.text-to-video',
    label: '文生视频',
    operation: 'text_to_video',
    inputTypes: ['text', 'prompt', 'image', 'video'],
    outputTypes: ['video'],
    enabled: true,
    paramsSchema: {},
  },
]

export function getCanvasCapability(operation: CanvasOperationType): CanvasCapability | undefined {
  if (operation === 'image_to_image') {
    return CANVAS_CAPABILITIES.find((capability) => capability.operation === 'image_edit')
  }
  return CANVAS_CAPABILITIES.find((capability) => capability.operation === operation)
}

export function isCapabilityRecommended(
  capability: CanvasCapability,
  selectedNodes: CanvasNode[],
): boolean {
  if (selectedNodes.length === 0)
    return capability.operation === 'text_to_image' || capability.operation === 'text_generate'
  const selectedTypes = new Set(selectedNodes.map((node) => node.type))
  return capability.inputTypes.some((type) => selectedTypes.has(type))
}

/** 类型化操作节点的 type 集合（与 CanvasOperationType 一一对应） */
export const OPERATION_NODE_TYPES: ReadonlySet<string> = new Set<CanvasNodeType>([
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
  'text_to_audio',
  'audio_transcribe',
])

/** 判断节点是否为 AI 操作节点（含旧 type:'task'） */
export function isOperationNode(node: { type: CanvasNodeType }): boolean {
  return OPERATION_NODE_TYPES.has(node.type) || node.type === 'task'
}

/**
 * 判断节点是否承载可操作的图片内容。
 *
 * 任务与产物合并后，360 全景图会保留 `panorama_360` 操作类型，而不是退回
 * `image`。图片工具应基于实际内容能力，而不是持久化的节点类型。
 */
export function isCanvasImageContentNode(node: Pick<CanvasNode, 'type' | 'data'>): boolean {
  return node.type === 'image' || Boolean(node.data.panorama360)
}

/** 取操作节点的 operation 名（优先 data.operation，回退 node.type，旧 task 回退 'text_generate'） */
export function nodeOperation(node: {
  type: CanvasNodeType
  data?: { operation?: CanvasOperationType }
}): CanvasOperationType | null {
  if (node.data?.operation) return node.data.operation
  if (OPERATION_NODE_TYPES.has(node.type)) return node.type as CanvasOperationType
  // 旧 task 节点无 operation 时返回 null（渲染时显示「通用任务」）
  return null
}

/** 取操作节点类型的简单 emoji 图标（用于类型化 AI 操作节点的视觉） */
export function operationNodeIcon(op: CanvasOperationType | null): string {
  if (!op) return '⚙️'
  switch (op) {
    case 'text_to_image':
      return '🖼️'
    case 'image_to_image':
    case 'image_edit':
      return '🎨'
    case 'image_compose':
      return '🧩'
    case 'storyboard_grid':
      return '🎞️'
    case 'panorama_360':
      return '🌐'
    case 'text_generate':
      return '📝'
    case 'text_rewrite':
      return '✍️'
    case 'prompt_optimize':
      return '✨'
    case 'text_to_video':
      return '🎬'
    case 'image_to_video':
      return '📹'
    case 'video_edit':
      return '🎞️'
    case 'video_extend':
      return '⏩'
    case 'text_to_audio':
      return '🎵'
    case 'audio_transcribe':
      return '📃'
    default:
      return '⚙️'
  }
}
