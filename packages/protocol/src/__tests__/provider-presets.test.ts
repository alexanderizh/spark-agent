import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '../media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from '../media-config.js'
import { getProviderPresetById, PROVIDER_PRESETS } from '../provider-presets.js'

describe('provider presets', () => {
  it('gives every video-capable preset and manifest at least the 30 minute default timeout', () => {
    for (const preset of PROVIDER_PRESETS) {
      const supportsVideo =
        preset.modelType === 'video' ||
        preset.mediaCapabilities?.some((capability) => capability.startsWith('video.')) === true
      if (!supportsVideo) continue
      expect(preset.mediaDefaults?.timeoutMs, preset.id).toBeGreaterThanOrEqual(
        DEFAULT_VIDEO_POLL_TIMEOUT_MS,
      )
    }
    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      if (!manifest.domains.includes('video') || manifest.invocation.mode !== 'async_polling')
        continue
      expect(manifest.invocation.polling?.timeoutMs, manifest.id).toBeGreaterThanOrEqual(
        DEFAULT_VIDEO_POLL_TIMEOUT_MS,
      )
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
      mediaCapabilities: expect.arrayContaining(['image.generate', 'image.edit', 'video.generate']),
      mediaModelRefs: expect.arrayContaining([
        expect.objectContaining({ manifestId: 'agnes:agnes-image-2.0-flash' }),
        expect.objectContaining({ manifestId: 'agnes:agnes-video-v2.0' }),
      ]),
    })
  })

  it('keeps image provider defaults aligned with each default model schema', () => {
    expect(getProviderPresetById('apimart-images')?.mediaDefaults?.timeoutMs).toBe(600_000)
    expect(getProviderPresetById('bailian-images')?.mediaDefaults?.image).toEqual({
      size: '2K',
      n: 1,
    })
    expect(getProviderPresetById('volcengine-seedream-image')?.mediaDefaults?.image).toMatchObject({
      size: '2K',
    })
    expect(
      getProviderPresetById('volcengine-seedream-image')?.mediaDefaults?.image,
    ).not.toHaveProperty('resolution')

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
      mediaModelRefs: [{ manifestId: 'xai:grok-tts', modelId: 'grok-tts', enabled: true }],
      mediaDefaults: { audio: { voice: 'eve', format: 'mp3' } },
    })
  })
})
