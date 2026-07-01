/**
 * 画布 AI 操作的图标 + 颜色映射（Phase 4 视觉统一）。
 *
 * 旧版所有 10+ 个 AI 操作都用同一个 Sparkles，毫无区分；现在按类型分图标 +
 * 4 类语义色（图像蓝 / 文本绿 / 音频紫 / 视频橙），便于扫视分辨。
 */
import type { ReactNode } from 'react'
import { Icons } from '../../Icons'
import type { CanvasOperationType } from './canvas.types'

export type OperationCategory = 'image' | 'text' | 'audio' | 'video'

export interface OperationVisual {
  icon: ReactNode
  category: OperationCategory
  /** 用于 CSS 类名：canvas-op-color-image 等 */
  colorClass: string
}

/** 同尺寸生产图标，统一用 15px */
const ICON_SIZE = 15

export function getOperationVisual(operation: CanvasOperationType): OperationVisual {
  switch (operation) {
    case 'text_to_image':
      return {
        icon: <Icons.ImagePlus size={ICON_SIZE} />,
        category: 'image',
        colorClass: 'canvas-op-color-image',
      }
    case 'image_to_image':
      return {
        icon: <Icons.Refresh size={ICON_SIZE} />,
        category: 'image',
        colorClass: 'canvas-op-color-image',
      }
    case 'image_edit':
      return {
        icon: <Icons.Brush size={ICON_SIZE} />,
        category: 'image',
        colorClass: 'canvas-op-color-image',
      }
    case 'image_compose':
      return {
        icon: <Icons.Combine size={ICON_SIZE} />,
        category: 'image',
        colorClass: 'canvas-op-color-image',
      }
    case 'storyboard_grid':
      return {
        icon: <Icons.Grid size={ICON_SIZE} />,
        category: 'image',
        colorClass: 'canvas-op-color-image',
      }
    case 'panorama_360':
      return {
        icon: <Icons.Globe size={ICON_SIZE} />,
        category: 'image',
        colorClass: 'canvas-op-color-image',
      }
    case 'text_generate':
      return {
        icon: <Icons.FileText size={ICON_SIZE} />,
        category: 'text',
        colorClass: 'canvas-op-color-text',
      }
    case 'text_rewrite':
      return {
        icon: <Icons.RotateCw size={ICON_SIZE} />,
        category: 'text',
        colorClass: 'canvas-op-color-text',
      }
    case 'prompt_optimize':
      return {
        icon: <Icons.Wand size={ICON_SIZE} />,
        category: 'text',
        colorClass: 'canvas-op-color-text',
      }
    case 'text_to_audio':
      return {
        icon: <Icons.Mic size={ICON_SIZE} />,
        category: 'audio',
        colorClass: 'canvas-op-color-audio',
      }
    case 'audio_transcribe':
      return {
        icon: <Icons.AudioLines size={ICON_SIZE} />,
        category: 'audio',
        colorClass: 'canvas-op-color-audio',
      }
    case 'text_to_video':
      return {
        icon: <Icons.Film size={ICON_SIZE} />,
        category: 'video',
        colorClass: 'canvas-op-color-video',
      }
    case 'image_to_video':
      return {
        icon: <Icons.Play size={ICON_SIZE} />,
        category: 'video',
        colorClass: 'canvas-op-color-video',
      }
    case 'video_edit':
      return {
        icon: <Icons.Scissors size={ICON_SIZE} />,
        category: 'video',
        colorClass: 'canvas-op-color-video',
      }
    case 'video_extend':
      return {
        icon: <Icons.Play size={ICON_SIZE} />,
        category: 'video',
        colorClass: 'canvas-op-color-video',
      }
  }
}
