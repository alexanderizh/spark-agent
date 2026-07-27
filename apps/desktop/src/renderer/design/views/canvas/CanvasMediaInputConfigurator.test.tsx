import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasInputBinding } from '@spark/protocol'
import { CanvasMediaInputConfigurator } from './CanvasMediaInputConfigurator'
import type { CanvasMediaInputModeOption } from './canvasMediaInputMode'

describe('CanvasMediaInputConfigurator', () => {
  it('shows one unified resource tray with explicit mode, role and origin', () => {
    const binding: CanvasInputBinding = {
      id: 'connection:image-1:reference',
      sourceNodeId: 'image-1',
      origin: 'connection',
      kind: 'image',
      relation: 'reference_image',
      role: 'first_frame',
      enabled: true,
      order: 0,
    }
    const html = renderToStaticMarkup(
      <CanvasMediaInputConfigurator
        options={[firstFrameOption()]}
        value="first_frame"
        assignments={[
          {
            sourceNodeId: 'image-1',
            kind: 'image',
            role: 'first_frame',
            order: 0,
            used: true,
          },
        ]}
        bindings={[binding]}
        nodes={[
          {
            id: 'image-1',
            title: '角色定妆图',
            type: 'image',
            assetId: null,
            data: {},
          } as never,
        ]}
        assets={[]}
        variant="panel"
        onChange={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    expect(html).toContain('素材编排')
    expect(html).toContain('1/1 参与生成')
    expect(html).toContain('首帧生成')
    expect(html).toContain('角色定妆图')
    expect(html).toContain('来源：连线')
    expect(html).toContain('首帧')
    expect(html).toContain('aria-label="视频生成模式"')
    expect(html).not.toContain('video.image_to_video')
  })
})

function firstFrameOption(): CanvasMediaInputModeOption {
  return {
    mode: 'first_frame',
    label: '首帧生视频',
    capabilityId: 'video.image_to_video',
    capability: {
      id: 'video.image_to_video',
      label: '首帧生视频',
      input: { required: ['image'], maxImages: 1 },
      rolePolicy: {
        imageRoles: ['first_frame'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      },
      output: { types: ['video'] },
      paramSchema: {},
    },
    rolePolicy: {
      imageRoles: ['first_frame'],
      defaultRoleAssignment: 'first_then_last_then_reference',
    },
  }
}
