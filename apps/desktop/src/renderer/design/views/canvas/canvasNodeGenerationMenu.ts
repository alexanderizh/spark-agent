import type { CanvasOperationType } from './canvas.types'

export type CanvasNodeGenerationMenuIcon =
  | 'Image'
  | 'Grid'
  | 'Globe'
  | 'Edit'
  | 'FileText'
  | 'Video'
  | 'Audio'

export type CanvasNodeGenerationMenuItem = {
  operation: CanvasOperationType
  label: string
  icon: CanvasNodeGenerationMenuIcon
}

export type CanvasNodeGenerationMenuGroup = {
  id: 'image' | 'video' | 'audio'
  label: string
  items: CanvasNodeGenerationMenuItem[]
}

export const CANVAS_FUNCTIONAL_MENU_LABEL = '影视创作'
export const CANVAS_BASE_TASK_MENU_LABEL = '基础任务'

export const CANVAS_FUNCTIONAL_CREATE_OPERATIONS: CanvasNodeGenerationMenuItem[] = [
  { operation: 'storyboard_grid', label: '故事板', icon: 'Grid' },
  { operation: 'panorama_360', label: '360 全景图', icon: 'Globe' },
]

export const CANVAS_BASE_CREATE_OPERATION_GROUPS: CanvasNodeGenerationMenuGroup[] = [
  {
    id: 'image',
    label: '图像',
    items: [
      // 文生图 / 图生图 / 编辑 / 多图合成已合并为单一「图片生成」容器（text_to_image），
      // 运行时按所选模式 + 参考图数量反推 image.generate / image.edit 与实际 operation。
      { operation: 'text_to_image', label: '图片生成', icon: 'Image' },
      { operation: 'image_prompt_reverse', label: '图片反推', icon: 'FileText' },
    ],
  },
  {
    id: 'video',
    label: '视频',
    items: [
      { operation: 'text_to_video', label: '视频生成', icon: 'Video' },
      { operation: 'video_depth_map', label: '深度视频转换', icon: 'Video' },
      { operation: 'extract_audio', label: '分离音频', icon: 'Audio' },
    ],
  },
  {
    id: 'audio',
    label: '音频',
    items: [
      { operation: 'text_to_audio', label: '文生音频', icon: 'Audio' },
      { operation: 'audio_transcribe', label: '语音转写', icon: 'Audio' },
    ],
  },
]

/** 右键菜单当前开放的基础任务分组；音频能力保留定义，待生成链路支持后再显示。 */
export const CANVAS_VISIBLE_BASE_CREATE_OPERATION_GROUPS =
  CANVAS_BASE_CREATE_OPERATION_GROUPS.filter((group) => group.id !== 'audio')

/** 右键菜单使用的扁平基础任务列表；保留分组定义供其他入口按类别展示。 */
export function canvasVisibleBaseCreateOperations(): CanvasNodeGenerationMenuItem[] {
  return CANVAS_VISIBLE_BASE_CREATE_OPERATION_GROUPS.flatMap((group) => group.items)
}

export function canvasBaseCreateOperations(): CanvasNodeGenerationMenuItem[] {
  return CANVAS_BASE_CREATE_OPERATION_GROUPS.flatMap((group) => group.items)
}
