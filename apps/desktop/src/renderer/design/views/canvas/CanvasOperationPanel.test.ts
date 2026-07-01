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

import { resolveCanvasOperationPanelNegativePrompt } from './CanvasOperationPanel'
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
})
