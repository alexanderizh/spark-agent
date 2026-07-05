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
  nodeOperation: () => 'text_to_image',
}))
vi.mock('./canvasOperationPresets', () => ({
  mergeCanvasOperationPresetNegativePrompt: (base: string, preset: string) =>
    [base, preset].filter(Boolean).join('\n'),
  readCanvasOperationPreset: () => ({ prompt: '', negativePrompt: '', modelParams: {}, skillIds: [] }),
}))

import {
  buildOperationPanelRunInputNodeIds,
  mergeOperationPanelPromptWithInputContext,
  readCanvasOperationPanelTextInputContent,
  resolveCanvasOperationPanelNegativePrompt,
} from './CanvasOperationPanel'
import { mergeSeededModelParamDraft } from './canvasModelParamDraftState'

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
})
