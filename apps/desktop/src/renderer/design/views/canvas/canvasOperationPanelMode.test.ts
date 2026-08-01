import { describe, expect, it } from 'vitest'
import {
  resolveCanvasDepthSubmitLabel,
  resolveCanvasOperationPanelMode,
} from './canvasOperationPanelMode'

describe('resolveCanvasOperationPanelMode', () => {
  it('uses a vision-only runtime for image prompt reverse', () => {
    expect(resolveCanvasOperationPanelMode('image_prompt_reverse')).toEqual({
      executionKind: 'text',
      runtimeKind: 'vision_model',
      showPromptEditor: false,
      dedicatedMediaKind: 'image',
      showCustomParams: false,
      showLocalDepthNotice: false,
      submitLabel: '生成提示词',
    })
  })

  it('uses local-only controls for depth video', () => {
    expect(resolveCanvasOperationPanelMode('video_depth_map')).toEqual({
      executionKind: 'local_media',
      runtimeKind: 'none',
      showPromptEditor: false,
      dedicatedMediaKind: 'video',
      showCustomParams: false,
      showLocalDepthNotice: true,
      submitLabel: '生成深度视频',
    })
  })

  it('keeps existing text and cloud media panel behavior', () => {
    expect(resolveCanvasOperationPanelMode('text_generate')).toMatchObject({
      runtimeKind: 'text_full',
      showPromptEditor: true,
      dedicatedMediaKind: null,
      showCustomParams: true,
    })
    expect(resolveCanvasOperationPanelMode('image_to_video')).toMatchObject({
      runtimeKind: 'none',
      showPromptEditor: true,
      dedicatedMediaKind: null,
      showCustomParams: false,
    })
  })

  it('announces the first-use model download before running depth video', () => {
    expect(resolveCanvasDepthSubmitLabel('missing')).toBe('下载模型并运行')
    expect(resolveCanvasDepthSubmitLabel('ready')).toBe('生成深度视频')
    expect(resolveCanvasDepthSubmitLabel('installing')).toBe('正在下载深度模型')
  })
})
