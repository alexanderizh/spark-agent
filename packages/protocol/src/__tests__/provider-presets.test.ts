import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '../media-model-manifest.js'
import { getProviderPresetById } from '../provider-presets.js'

describe('provider presets', () => {
  it('allows APIMart video tasks to run for up to 30 minutes', () => {
    for (const id of [
      'apimart-video-veo3',
      'apimart-video-sora2',
      'apimart-video-collection',
    ]) {
      expect(getProviderPresetById(id)?.mediaDefaults?.polling?.timeoutMs).toBe(1_800_000)
    }
  })

  it('uses the Coding Plan OpenAI-compatible endpoint for Volcengine Ark', () => {
    expect(getProviderPresetById('volcengine-ark-openai')).toMatchObject({
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      codexApiKind: 'responses',
      defaultModel: 'glm-5.2',
      modelIds: expect.arrayContaining(['glm-5.2']),
    })
    expect(getProviderPresetById('volcengine-ark-anthropic')).toMatchObject({
      defaultModel: 'glm-5.2',
      modelIds: expect.arrayContaining(['glm-5.2']),
    })
    expect(getProviderPresetById('volcengine-ark-seed21')).toMatchObject({
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      codexApiKind: 'chat',
      sourceUrls: expect.arrayContaining([
        'https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1569618?lang=zh',
      ]),
    })
  })

  it('exposes Agnes as a unified multimodal preset with media manifests', () => {
    expect(getProviderPresetById('agnes-ai')).toMatchObject({
      apiEndpoint: 'https://apihub.agnes-ai.com/v1',
      defaultModel: 'agnes-2.0-flash',
      modelType: 'multimodal',
      mediaProvider: 'agnes',
      mediaCapabilities: expect.arrayContaining([
        'image.generate',
        'image.edit',
        'video.generate',
      ]),
      mediaModelRefs: expect.arrayContaining([
        expect.objectContaining({ manifestId: 'agnes:agnes-image-2.0-flash' }),
        expect.objectContaining({ manifestId: 'agnes:agnes-video-v2.0' }),
      ]),
    })
  })

  it('keeps image provider defaults aligned with each default model schema', () => {
    expect(getProviderPresetById('bailian-images')?.mediaDefaults?.image).toEqual({
      size: '2K',
      n: 1,
    })
    expect(getProviderPresetById('volcengine-seedream-image')?.mediaDefaults?.image).toMatchObject({
      size: '2K',
    })
    expect(getProviderPresetById('volcengine-seedream-image')?.mediaDefaults?.image).not.toHaveProperty(
      'resolution',
    )

    const xaiPreset = getProviderPresetById('xai-imagine-image')
    if (!xaiPreset) throw new Error('xai image preset not found')
    const xaiManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === xaiPreset.mediaModelRefs?.[0]?.manifestId,
    )
    if (!xaiManifest) throw new Error('xai image manifest not found')
    const schemaProperties = xaiManifest.capabilities[0]?.paramSchema.properties ?? {}
    for (const defaultName of Object.keys(xaiPreset.mediaDefaults?.image ?? {})) {
      expect(schemaProperties).toHaveProperty(defaultName)
    }
  })

  it('wires xAI TTS to its manifest with provider-compatible defaults', () => {
    expect(getProviderPresetById('xai-tts')).toMatchObject({
      mediaModelRefs: [
        { manifestId: 'xai:grok-tts', modelId: 'grok-tts', enabled: true },
      ],
      mediaDefaults: { audio: { voice: 'eve', format: 'mp3', speed: 1 } },
    })
  })
})
