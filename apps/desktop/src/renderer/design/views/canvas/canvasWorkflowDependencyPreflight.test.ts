import { describe, expect, it } from 'vitest'
import { checkCanvasWorkflowDependencies } from './canvasWorkflowDependencyPreflight'

describe('checkCanvasWorkflowDependencies', () => {
  it('accepts configured text and media capabilities', () => {
    const issues = checkCanvasWorkflowDependencies({
      requiredCapabilities: ['text_generate', 'text_to_image'],
      requiredProviders: [],
      textProviders: [
        { id: 'text-1', modelType: 'text', modelIds: ['gpt-5'], defaultModel: 'gpt-5' },
      ],
      mediaProviders: [{ providerProfileId: 'media-1', mediaCapabilities: ['image.generate'] }],
    })
    expect(issues).toEqual([])
  })

  it('does not treat text-to-image as a text-provider-only operation', () => {
    const issues = checkCanvasWorkflowDependencies({
      requiredCapabilities: ['text_to_image'],
      requiredProviders: [],
      textProviders: [
        { id: 'text-1', modelType: 'text', modelIds: ['gpt-5'], defaultModel: 'gpt-5' },
      ],
      mediaProviders: [],
    })

    expect(issues).toEqual([expect.stringMatching(/text_to_image/)])
  })

  it('reports missing capability and exact provider/model references', () => {
    const issues = checkCanvasWorkflowDependencies({
      requiredCapabilities: ['image_to_video'],
      requiredProviders: [
        { nodeLabel: '生成视频', providerProfileId: 'missing-provider', modelId: 'video-model' },
      ],
      textProviders: [],
      mediaProviders: [],
    })
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/image_to_video/),
        expect.stringMatching(/missing-provider/),
      ]),
    )
  })
})
