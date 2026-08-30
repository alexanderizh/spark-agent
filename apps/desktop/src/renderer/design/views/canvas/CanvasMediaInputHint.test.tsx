// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CanvasMediaInputHint, formatCanvasMediaInputHintText } from './CanvasMediaInputHint'

describe('CanvasMediaInputHint', () => {
  it('formats frame-role usage with overflow warning', () => {
    const hint = formatCanvasMediaInputHintText({
      mode: 'panel',
      maxImages: 2,
      selectedImageCount: 4,
      rolePolicy: {
        imageRoles: ['first_frame', 'last_frame'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      },
    })

    expect(hint).toContain('当前模型声明支持 2 张图片')
    expect(hint).toContain('第一张作为首帧、第二张作为尾帧')
    expect(hint).toContain('已选 4 张')
    expect(hint).toContain('图片超出 2 张，提交校验会阻止任务')
    expect(hint).toContain('建议显式选择')
  })

  it('formats reference-image usage without frame language', () => {
    const hint = formatCanvasMediaInputHintText({
      mode: 'composer',
      maxImages: 9,
      selectedImageCount: 3,
      rolePolicy: {
        imageRoles: ['reference_image'],
        videoRoles: ['reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'all_reference',
      },
      maxVideos: 3,
      selectedVideoCount: 2,
      maxAudios: 3,
      selectedAudioCount: 1,
    })

    expect(hint).toContain('当前模型声明支持 9 张图片')
    expect(hint).toContain('未手动指定时，已选图片均作为参考图')
    expect(hint).toContain('已选 3 张')
    expect(hint).toContain('参考视频 2/3 段')
    expect(hint).toContain('参考音频 1/3 段')
    expect(hint).not.toContain('首帧')
  })

  it('renders compact unsupported-image state without visible hint copy', () => {
    const html = renderToStaticMarkup(
      <CanvasMediaInputHint
        mode="panel"
        maxImages={0}
        selectedImageCount={0}
        rolePolicy={{ videoRoles: ['input_video'], defaultRoleAssignment: 'none' }}
      />,
    )

    expect(html).toContain('canvas-media-input-hint')
    expect(html).toContain('is-unsupported')
    expect(html).not.toContain(['canvas-media-input-hint', 'main'].join('-'))
  })
})
