// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { resolveCanvasOperationPanelNegativePrompt } from './CanvasOperationPanel'

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
})
