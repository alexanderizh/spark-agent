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
  id: 'image' | 'text' | 'video' | 'audio'
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
      { operation: 'text_to_image', label: '文生图', icon: 'Image' },
      { operation: 'image_edit', label: '图生图 / 编辑', icon: 'Edit' },
      { operation: 'image_compose', label: '多图合成', icon: 'Grid' },
    ],
  },
  {
    id: 'text',
    label: '文本',
    items: [
      { operation: 'text_generate', label: '文本生成', icon: 'FileText' },
      { operation: 'text_rewrite', label: '文本改写', icon: 'Edit' },
      { operation: 'prompt_optimize', label: 'Prompt 优化', icon: 'FileText' },
    ],
  },
  {
    id: 'video',
    label: '视频',
    items: [
      { operation: 'text_to_video', label: '文生视频', icon: 'Video' },
      { operation: 'image_to_video', label: '图生视频', icon: 'Video' },
      { operation: 'video_edit', label: '视频编辑', icon: 'Video' },
      { operation: 'video_extend', label: '视频扩展', icon: 'Video' },
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

export function canvasBaseCreateOperations(): CanvasNodeGenerationMenuItem[] {
  return CANVAS_BASE_CREATE_OPERATION_GROUPS.flatMap((group) => group.items)
}
