import type { CanvasNode, CanvasNodeData } from './canvas.types'

/**
 * 节点子类型切换：底层 node.type 保持稳定，仅切换 data 层子类型字段。
 * 见 canvasNodeSubtypeSwitch 的设计：图片靠 panorama360 + pipelineRole 判定，
 * 文本靠 format + pipelineRole 判定。
 */

export type ImageNodeSubtype = 'plain' | 'panorama360' | 'design_card' | 'keyframe'
export type TextNodeSubtype = 'plain' | 'markdown' | 'screenplay' | 'chapter' | 'style_bible'

export type CanvasNodeDataPatch = {
  [K in keyof CanvasNodeData]?: CanvasNodeData[K] | undefined
}

export type SubtypeSwitchOption = {
  value: string
  label: string
  /** 切换到该子类型时需合并写入的 data 片段；undefined 字段由 updateNodeData 清除 */
  apply: CanvasNodeDataPatch
}

export function getImageNodeSubtype(data: CanvasNodeData): ImageNodeSubtype {
  if (data.panorama360) return 'panorama360'
  if (data.pipelineRole === 'design_card') return 'design_card'
  if (data.pipelineRole === 'keyframe') return 'keyframe'
  return 'plain'
}

export function getTextNodeSubtype(data: CanvasNodeData): TextNodeSubtype {
  if (data.pipelineRole === 'screenplay') return 'screenplay'
  if (data.pipelineRole === 'chapter') return 'chapter'
  if (data.pipelineRole === 'style_bible') return 'style_bible'
  if (data.format === 'markdown') return 'markdown'
  return 'plain'
}

export const IMAGE_SUBTYPE_OPTIONS: SubtypeSwitchOption[] = [
  { value: 'plain', label: '普通上传图', apply: { pipelineRole: undefined, panorama360: undefined } },
  {
    value: 'panorama360',
    label: '360 全景',
    apply: { panorama360: { projection: 'equirectangular' } },
  },
  {
    value: 'design_card',
    label: '设定图卡',
    apply: { pipelineRole: 'design_card', panorama360: undefined },
  },
  { value: 'keyframe', label: '关键帧', apply: { pipelineRole: 'keyframe' } },
]

export const TEXT_SUBTYPE_OPTIONS: SubtypeSwitchOption[] = [
  { value: 'plain', label: '普通文本', apply: { format: 'plain', pipelineRole: undefined } },
  { value: 'markdown', label: 'Markdown', apply: { format: 'markdown', pipelineRole: undefined } },
  { value: 'screenplay', label: '剧本', apply: { pipelineRole: 'screenplay' } },
  { value: 'chapter', label: '章节', apply: { pipelineRole: 'chapter' } },
  { value: 'style_bible', label: '设定', apply: { pipelineRole: 'style_bible' } },
]

// 仅内容文本/图片节点支持子类型切换。prompt 节点有专属 data.format='prompt' 身份，
// 按 text 切换会覆盖该身份，故不参与；需求也只要求图片/文本两类。
const SWITCHABLE_TYPES = new Set<CanvasNode['type']>(['image', 'text'])

export function isSubtypeSwitchable(node: CanvasNode | undefined | null): boolean {
  if (!node) return false
  return SWITCHABLE_TYPES.has(node.type)
}

export function getNodeSubtypeOptions(node: CanvasNode): SubtypeSwitchOption[] {
  return node.type === 'image' ? IMAGE_SUBTYPE_OPTIONS : TEXT_SUBTYPE_OPTIONS
}

export function getNodeCurrentSubtype(node: CanvasNode): string {
  return node.type === 'image'
    ? getImageNodeSubtype(node.data)
    : getTextNodeSubtype(node.data)
}
