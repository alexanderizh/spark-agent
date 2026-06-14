import type { CanvasCapability, CanvasNode, CanvasOperationType } from './canvas.types'

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
    id: 'canvas.image-to-image',
    label: '图生图',
    operation: 'image_to_image',
    inputTypes: ['image'],
    outputTypes: ['image'],
    enabled: true,
    paramsSchema: {},
  },
  {
    id: 'canvas.image-edit',
    label: '图片编辑',
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
    inputTypes: ['text', 'prompt'],
    outputTypes: ['video'],
    enabled: true,
    paramsSchema: {},
  },
]

export function getCanvasCapability(operation: CanvasOperationType): CanvasCapability | undefined {
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
