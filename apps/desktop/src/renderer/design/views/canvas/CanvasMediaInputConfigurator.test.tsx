import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasInputBinding } from '@spark/protocol'
import { CanvasMediaInputConfigurator } from './CanvasMediaInputConfigurator'
import type { CanvasMediaInputModeOption } from './canvasMediaInputMode'

vi.mock('@lobehub/ui', () => ({ Button: 'button' }))
vi.mock('antd', () => ({
  Select: ({
    options = [],
    classNames: _classNames,
    ...props
  }: {
    options?: Array<{ value: string; label: string; disabled?: boolean }>
    classNames?: unknown
  }) => (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Segmented: ({
    value,
    options = [],
    ...props
  }: {
    value?: string
    options?: Array<{ value: string; label: string }>
  }) => (
    <div data-segmented-value={value} {...props}>
      {options.map((option) => (
        <span key={option.value} data-segmented-option={option.value}>
          {option.label}
        </span>
      ))}
    </div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

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

  it('offers only the canvas pick button when the task has no media input', () => {
    const html = renderToStaticMarkup(
      <CanvasMediaInputConfigurator
        options={[firstFrameOption()]}
        value="first_frame"
        assignments={[]}
        bindings={[]}
        nodes={[]}
        assets={[]}
        variant="composer"
        onChange={vi.fn()}
        onMove={vi.fn()}
        onQuickPick={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="从画布选择输入素材"')
    expect(html).toContain('从画布选择')
    expect(html).not.toContain('本地上传')
  })

  it('keeps a supported multimodal reference mode selectable before media is added', () => {
    const referenceOption: CanvasMediaInputModeOption = {
      mode: 'reference',
      label: '全能参考',
      capabilityId: 'video.reference_to_video',
      capability: {
        id: 'video.reference_to_video',
        label: '全能参考',
        input: { required: [] },
        rolePolicy: {
          imageRoles: ['reference_image'],
          videoRoles: ['reference_video'],
          audioRoles: ['reference_audio'],
          defaultRoleAssignment: 'all_reference',
        },
        output: { types: ['video'] },
        paramSchema: {},
      },
      rolePolicy: {
        imageRoles: ['reference_image'],
        videoRoles: ['reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'all_reference',
      },
    }
    const html = renderToStaticMarkup(
      <CanvasMediaInputConfigurator
        options={[referenceOption]}
        value="reference"
        assignments={[]}
        bindings={[]}
        nodes={[]}
        assets={[]}
        variant="panel"
        onChange={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    expect(html).toContain('value="reference"')
    expect(html).toContain('全能参考')
    expect(html).not.toContain('value="reference" disabled')
  })

  it('renders unified image generation modes with image-specific labels and aria-label', () => {
    const html = renderToStaticMarkup(
      <CanvasMediaInputConfigurator
        options={[
          imageOption('text', 'image.generate', '文生图'),
          imageOption('reference', 'image.edit', '图生图 / 编辑'),
        ]}
        value="reference"
        assignments={[]}
        bindings={[]}
        nodes={[]}
        assets={[]}
        variant="panel"
        onChange={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    expect(html).toContain('文生图')
    expect(html).toContain('图生图 / 编辑')
    expect(html).toContain('aria-label="图片生成模式"')
    // 不得泄露视频专属文案
    expect(html).not.toContain('文生视频')
    expect(html).not.toContain('全能参考')
    expect(html).not.toContain('aria-label="视频生成模式"')
  })

  it('merges video edit and extend into one mode with an edit/extend sub-toggle', () => {    const html = renderToStaticMarkup(
      <CanvasMediaInputConfigurator
        options={[videoSourceOption('edit', 'video.edit'), videoSourceOption('extend', 'video.extend')]}
        value="extend"
        assignments={[]}
        bindings={[]}
        nodes={[]}
        assets={[]}
        variant="panel"
        onChange={vi.fn()}
        onMove={vi.fn()}
      />,
    )

    // Select 合并为单一「视频编辑 / 延长」条目，extend 不再作为独立 Select 项。
    expect(html).toContain('视频编辑 / 延长')
    expect(html).not.toContain('视频编辑</option>')
    expect(html).not.toContain('<option value="extend"')
    // 子开关存在，且反映当前真实模式 extend。
    expect(html).toContain('aria-label="视频编辑或延长"')
    expect(html).toContain('data-segmented-value="extend"')
    expect(html).toContain('data-segmented-option="edit"')
    expect(html).toContain('data-segmented-option="extend"')
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

function videoSourceOption(
  mode: 'edit' | 'extend',
  capabilityId: 'video.edit' | 'video.extend',
): CanvasMediaInputModeOption {
  const label = mode === 'edit' ? '视频编辑' : '视频延长'
  return {
    mode,
    label,
    capabilityId,
    capability: {
      id: capabilityId,
      label,
      input: { required: ['video'], maxVideos: 1 },
      rolePolicy: {
        videoRoles: ['input_video', 'reference_video'],
        defaultRoleAssignment: 'none',
      },
      output: { types: ['video'] },
      paramSchema: {},
    },
    rolePolicy: {
      videoRoles: ['input_video', 'reference_video'],
      defaultRoleAssignment: 'none',
    },
  }
}

function imageOption(
  mode: 'text' | 'reference',
  capabilityId: 'image.generate' | 'image.edit',
  label: string,
): CanvasMediaInputModeOption {
  const hasReference = mode === 'reference'
  return {
    mode,
    label,
    capabilityId,
    capability: {
      id: capabilityId,
      label,
      input: { required: hasReference ? ['image'] : [], ...(hasReference ? { maxImages: 6 } : {}) },
      rolePolicy: hasReference
        ? { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
        : { defaultRoleAssignment: 'none' },
      output: { types: ['image'] },
      paramSchema: {},
    },
    rolePolicy: hasReference
      ? { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
      : { defaultRoleAssignment: 'none' },
  }
}
