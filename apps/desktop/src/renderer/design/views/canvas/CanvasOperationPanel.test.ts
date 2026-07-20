// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({ Button: 'button' }))
vi.mock('antd', () => ({
  Input: { TextArea: 'textarea' },
  Popover: 'div',
  Select: 'select',
  Tag: 'span',
  Tooltip: 'div',
  message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../Icons', () => ({ Icons: new Proxy({}, { get: () => () => null }) }))
vi.mock('@spark/protocol', () => ({ capabilityForOperation: () => [] }))
vi.mock('./CanvasAgentModal', () => ({
  AgentPickerInline: 'div',
  ProviderModelPickerInline: 'div',
}))
vi.mock('./CanvasMediaInputThumb', () => ({ CanvasMediaInputThumb: 'div' }))
vi.mock('./CanvasMediaInputPickerModal', () => ({ CanvasMediaInputPickerModal: 'div' }))
vi.mock('./canvas.api', () => ({
  canvasApi: { listMediaModels: vi.fn() },
  operationLabel: () => '操作',
}))
vi.mock('./canvas.capabilities', () => ({
  getCanvasCapability: () => ({ inputTypes: [] }),
  isOperationNode: () => false,
  nodeOperation: () => 'text_to_image',
}))
vi.mock('./canvasOperationPresets', () => ({
  mergeCanvasOperationPresetNegativePrompt: (base: string, preset: string) =>
    [base, preset].filter(Boolean).join('\n'),
  mergeCanvasPresetTargetModelParams: (_targetId: string, params: Record<string, unknown>) =>
    params,
  readCanvasOperationPreset: () => ({
    prompt: '',
    negativePrompt: '',
    modelParams: {},
    skillIds: [],
  }),
  readCanvasResolvedPresetTarget: () => ({
    prompt: '',
    negativePrompt: '',
    modelParams: {},
    skillIds: [],
  }),
  resolveCanvasPresetTarget: () => 'text_to_image',
}))

import {
  buildOperationPanelEnumOptions,
  buildOperationPanelEditablePromptDocument,
  buildOperationPanelPromptOwnerNodeIds,
  expandOperationPanelPromptNodeIds,
  isCommonOperationModelParam,
  isGeneratedCanvasFunctionalPrompt,
  buildOperationPanelRunInputNodeIds,
  buildVideoFrameInputRoles,
  mergeDefaultReferenceFrameNodeIds,
  mergeOperationPanelPromptWithInputContext,
  readCanvasOperationPanelTextInputContent,
  readActiveOperationPromptNodeIds,
  resolveOperationPanelActualInputNodes,
  resolveOperationPanelEditablePrompt,
  resolveCanvasOperationPanelNegativePrompt,
  stripGeneratedCanvasFunctionalPromptInput,
} from './CanvasOperationPanel'
import { mergeSeededModelParamDraft } from './canvasModelParamDraftState'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'

describe('CanvasOperationPanel negative prompt inheritance', () => {
  it('merges project-level and operation preset negative prompts', () => {
    expect(
      resolveCanvasOperationPanelNegativePrompt({
        projectNegativePrompt: '不要模糊',
        operationPresetNegativePrompt: '不要水印',
      }),
    ).toBe('不要模糊\n不要水印')
  })

  it('prefers upstream task negative prompts over project defaults before merging preset', () => {
    expect(
      resolveCanvasOperationPanelNegativePrompt({
        sourceNegativePrompts: ['不要人物', '不要模糊'],
        projectNegativePrompt: '不要水印',
        operationPresetNegativePrompt: '不要字幕',
      }),
    ).toBe('不要人物\n不要字幕')
  })

  it('prefers the editable node snapshot over its immutable historical task', () => {
    expect(
      resolveCanvasOperationPanelNegativePrompt({
        nodeNegativePrompt: '当前节点配置',
        taskNegativePrompt: '历史任务配置',
        operationPresetNegativePrompt: '预设约束',
      }),
    ).toBe('当前节点配置\n预设约束')
  })

  it('preserves user-selected param values when async defaults arrive later', () => {
    expect(
      mergeSeededModelParamDraft(
        { aspect_ratio: '16:9', quality: '' },
        { aspect_ratio: '1:1', quality: 'high' },
      ),
    ).toEqual({ aspect_ratio: '16:9', quality: 'high' })
  })

  it('reads connected text node content from backing asset when node data is empty', () => {
    expect(
      readCanvasOperationPanelTextInputContent(
        {
          id: 'node-shot',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text',
          title: '分镜脚本',
          assetId: 'asset-shot',
          parentNodeId: null,
          x: 0,
          y: 0,
          width: 560,
          height: 240,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { text: '', format: 'markdown' },
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T00:00:00.000Z',
        },
        [
          {
            id: 'asset-shot',
            projectId: 'project-1',
            userId: 0,
            type: 'text',
            source: 'ai_generated',
            title: '分镜脚本',
            contentText: '| 镜号 | 画面 |\n| 1 | 夜晚走廊推镜 |',
            metadata: {},
            createdAt: '2026-06-18T00:00:00.000Z',
            updatedAt: '2026-06-18T00:00:00.000Z',
          },
        ],
      ),
    ).toContain('夜晚走廊推镜')
  })

  it('merges upstream text context into operation panel prompt idempotently', () => {
    const merged = mergeOperationPanelPromptWithInputContext(
      '生成镜头视频',
      '【分镜脚本｜分镜脚本】\n| 镜号 | 画面 |\n| 1 | 夜晚走廊推镜 |',
    )
    expect(merged).toContain('画布节点内容')
    expect(merged).toContain('【分镜脚本｜分镜脚本】')
    expect(merged).toContain('夜晚走廊推镜')
    expect(
      mergeOperationPanelPromptWithInputContext(
        merged,
        '【分镜脚本｜分镜脚本】\n| 镜号 | 画面 |\n| 1 | 夜晚走廊推镜 |',
      ),
    ).toBe(merged)
  })

  it('keeps preset and final task prompts out of the editable operation prompt', () => {
    expect(
      resolveOperationPanelEditablePrompt({
        nodePrompt: '',
        upstreamTextContext: '【文本节点｜章节】\n雨夜巷口重逢',
      }),
    ).toBe('')
    expect(
      resolveOperationPanelEditablePrompt({
        nodePrompt: '用户自己的补充要求',
        upstreamTextContext: '',
      }),
    ).toBe('用户自己的补充要求')
  })

  it('hides generated functional prompts and initializes upstream content as a tag', () => {
    const generatedPrompt = [
      '【任务】把下面的场次剧本拆成「精确到秒、超详细」的分镜表。',
      'JSON 顶层结构必须为：{"shots":[]}',
      '【场次剧本】',
      '这段上级正文只能通过 Tag 注入',
    ].join('\n')
    expect(isGeneratedCanvasFunctionalPrompt(generatedPrompt, 'screenplay.to_shot_script')).toBe(
      true,
    )
    expect(
      resolveOperationPanelEditablePrompt({
        nodePrompt: generatedPrompt,
        hideFunctionalPrompt: true,
      }),
    ).toBe('')
    expect(
      stripGeneratedCanvasFunctionalPromptInput(generatedPrompt, 'screenplay.to_shot_script'),
    ).toBe(
      '【任务】把下面的场次剧本拆成「精确到秒、超详细」的分镜表。\nJSON 顶层结构必须为：{"shots":[]}',
    )

    const upstreamNode = {
      id: 'scene-1',
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      type: 'text' as const,
      title: '分片 1 copy',
      assetId: null,
      taskId: null,
      parentNodeId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 0,
      locked: false,
      hidden: false,
      data: { text: '上级正文', pipelineRole: 'screenplay' as const },
      createdAt: '',
      updatedAt: '',
    }
    const mediaNode = {
      ...upstreamNode,
      id: 'image-1',
      type: 'image' as const,
      title: '角色参考图',
      data: { url: 'https://example.com/hero.png' },
    }
    const document = buildOperationPanelEditablePromptDocument({
      document: {
        version: 2,
        blocks: [
          { kind: 'text', id: 'builtin', text: generatedPrompt },
          {
            kind: 'reference',
            id: 'legacy-image',
            source: 'connection',
            sourceNodeId: 'image-1',
            relation: 'reference_image',
            label: '角色参考图',
            order: 0,
          },
        ],
      },
      editablePrompt: '',
      hideFunctionalPrompt: true,
      nodes: [upstreamNode, mediaNode],
      connections: [upstreamNode, mediaNode],
      assets: [],
    })

    expect(document.blocks.some((block) => block.kind === 'text' && block.text.length > 0)).toBe(
      false,
    )
    expect(document.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'reference',
        source: 'connection',
        sourceNodeId: 'scene-1',
        relation: 'screenplay',
        label: '分片 1 copy',
      }),
    )
    expect(document.blocks.at(-1)).toMatchObject({ kind: 'text', text: '' })
    expect(
      document.blocks.some(
        (block) => block.kind === 'reference' && block.sourceNodeId === 'image-1',
      ),
    ).toBe(true)
  })

  it('excludes suppressed tags from active task inputs', () => {
    expect(
      readActiveOperationPromptNodeIds({
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'active',
            source: 'manual',
            sourceNodeId: 'scene-1',
            relation: 'scene',
            label: '场景',
            order: 0,
          },
          {
            kind: 'reference',
            id: 'suppressed',
            source: 'connection',
            sourceNodeId: 'text-2',
            relation: 'generic',
            suppressed: true,
            label: '已移除输入',
            order: 1,
          },
        ],
      }),
    ).toEqual(['scene-1'])
  })

  it('projects unique actual inputs from active bindings, including @ text references', () => {
    const baseNode = {
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      assetId: null,
      taskId: null,
      parentNodeId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 0,
      locked: false,
      hidden: false,
      createdAt: '',
      updatedAt: '',
    }
    const nodes: CanvasNode[] = [
      {
        ...baseNode,
        id: 'image-1',
        type: 'image' as const,
        title: '角色参考图',
        data: { url: 'https://example.com/hero.png' },
      },
      {
        ...baseNode,
        id: 'text-1',
        type: 'text' as const,
        title: '补充资料',
        data: { text: '雨夜氛围' },
      },
      {
        ...baseNode,
        id: 'hidden-text',
        type: 'text' as const,
        title: '隐藏资料',
        hidden: true,
        data: { text: '仍会发送' },
      },
    ]

    expect(
      resolveOperationPanelActualInputNodes(
        [
          {
            id: 'image-ref',
            sourceNodeId: 'image-1',
            origin: 'connection',
            kind: 'image',
            relation: 'reference_image',
            role: 'reference',
            enabled: true,
            order: 0,
          },
          {
            id: 'image-first',
            sourceNodeId: 'image-1',
            origin: 'picker',
            kind: 'image',
            relation: 'first_frame',
            role: 'first_frame',
            enabled: true,
            order: 1,
          },
          {
            id: 'text-manual',
            sourceNodeId: 'text-1',
            origin: 'manual',
            kind: 'text',
            relation: 'generic',
            role: 'input',
            enabled: true,
            order: 2,
            promptBlockId: 'text-block',
          },
          {
            id: 'hidden-manual',
            sourceNodeId: 'hidden-text',
            origin: 'manual',
            kind: 'text',
            relation: 'generic',
            role: 'input',
            enabled: true,
            order: 3,
            promptBlockId: 'hidden-block',
          },
          {
            id: 'text-disabled',
            sourceNodeId: 'missing',
            origin: 'connection',
            kind: 'text',
            relation: 'generic',
            role: 'input',
            enabled: false,
            order: 4,
          },
        ],
        nodes,
      ).map((node) => node.id),
    ).toEqual(['image-1', 'text-1', 'hidden-text'])
  })

  it('frame-role submit keeps only assigned image frames plus non-image inputs', () => {
    expect(
      buildOperationPanelRunInputNodeIds({
        selectedInputNodeIds: ['img-unused', 'video-1'],
        explicitFrameNodeIds: ['img-first', 'img-last'],
        textInputNodeIds: ['text-1'],
        supportsVideoFrameRoles: true,
        mediaInputOptions: [
          { value: 'img-unused', type: 'image' },
          { value: 'video-1', type: 'video' },
          { value: 'img-first', type: 'image' },
          { value: 'img-last', type: 'image' },
        ],
      }),
    ).toEqual(['video-1', 'img-first', 'img-last', 'text-1'])
  })

  it('frame-role submit keeps every assigned reference image instead of clipping to model maxImages', () => {
    expect(
      buildOperationPanelRunInputNodeIds({
        selectedInputNodeIds: ['img-unused', 'video-1'],
        explicitFrameNodeIds: ['img-first', 'img-last', 'img-ref-1', 'img-ref-2', 'img-ref-3'],
        textInputNodeIds: [],
        supportsVideoFrameRoles: true,
        mediaInputOptions: [
          { value: 'img-unused', type: 'image' },
          { value: 'video-1', type: 'video' },
          { value: 'img-first', type: 'image' },
          { value: 'img-last', type: 'image' },
          { value: 'img-ref-1', type: 'image' },
          { value: 'img-ref-2', type: 'image' },
          { value: 'img-ref-3', type: 'image' },
        ],
      }),
    ).toEqual(['video-1', 'img-first', 'img-last', 'img-ref-1', 'img-ref-2', 'img-ref-3'])
  })

  it('frame-role mapping allows one image to be first frame, last frame, and reference', () => {
    expect(buildVideoFrameInputRoles(['img-a'], 'img-a', 'img-a', ['img-a'])).toEqual({
      'img-a': ['first_frame', 'last_frame', 'reference'],
    })
  })

  it('merges upstream connected images into video reference frames without clearing user picks', () => {
    expect(
      mergeDefaultReferenceFrameNodeIds(
        ['manual-ref', 'stale-ref'],
        ['upstream-ref', 'manual-ref'],
        ['manual-ref', 'upstream-ref', 'other-ref'],
      ),
    ).toEqual(['manual-ref', 'upstream-ref'])
  })

  it('non-frame submit preserves selected media inputs', () => {
    expect(
      buildOperationPanelRunInputNodeIds({
        selectedInputNodeIds: ['img-a', 'img-b'],
        explicitFrameNodeIds: [],
        textInputNodeIds: [],
        supportsVideoFrameRoles: false,
        mediaInputOptions: [
          { value: 'img-a', type: 'image' },
          { value: 'img-b', type: 'image' },
        ],
      }),
    ).toEqual(['img-a', 'img-b'])
  })

  it('expands a visible group tag into child image options and binding ownership', () => {
    const baseNode: Omit<CanvasNode, 'id' | 'type' | 'title' | 'parentNodeId' | 'data'> = {
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      assetId: null,
      taskId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 0,
      locked: false,
      hidden: false,
      createdAt: '',
      updatedAt: '',
    }
    const group: CanvasNode = {
      ...baseNode,
      id: 'group-1',
      type: 'group',
      title: '图片组',
      parentNodeId: null,
      data: {},
    }
    const image: CanvasNode = {
      ...baseNode,
      id: 'image-1',
      type: 'image',
      title: '首帧候选',
      parentNodeId: group.id,
      data: { url: 'https://example.com/image-1.png' },
    }
    const snapshot: CanvasSnapshot = {
      project: {} as CanvasSnapshot['project'],
      board: {} as CanvasSnapshot['board'],
      nodes: [group, image],
      edges: [],
      assets: [],
      tasks: [],
    }

    expect(expandOperationPanelPromptNodeIds([group.id], snapshot)).toEqual(['group-1', 'image-1'])
    expect(buildOperationPanelPromptOwnerNodeIds(snapshot).get(image.id)).toEqual([group.id])
  })

  it('keeps unsupported enum draft values visible as disabled options after model switch', () => {
    expect(
      buildOperationPanelEnumOptions(
        {
          enumValues: ['480p', '720p'],
        },
        '1080p',
      ),
    ).toEqual([
      { value: '1080p', label: '1080p', disabled: true, unsupported: true },
      { value: '480p', label: '480p' },
      { value: '720p', label: '720p' },
    ])
  })

  it('keeps common model params visible and hides advanced provider params', () => {
    expect(isCommonOperationModelParam({ name: 'aspectRatio', title: '视频比例' })).toBe(true)
    expect(isCommonOperationModelParam({ name: 'resolution', title: '分辨率' })).toBe(true)
    expect(isCommonOperationModelParam({ name: 'searchEnabled', title: '联网搜索' })).toBe(true)
    expect(isCommonOperationModelParam({ name: 'fps', title: '帧率' })).toBe(true)
    expect(isCommonOperationModelParam({ name: 'watermark', title: '水印' })).toBe(false)
    expect(isCommonOperationModelParam({ name: 'serviceTier', title: '推理档位' })).toBe(false)
    expect(isCommonOperationModelParam({ name: 'returnLastFrame', title: '返回尾帧图' })).toBe(
      false,
    )
  })
})
