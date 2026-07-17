import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '../media-model-manifest.js'
import { PROVIDER_PRESETS } from '../provider-presets.js'

describe('xAI media manifests', () => {
  it('registers Grok Imagine Video 1.5 aliases as image-to-video only', () => {
    const modelIds = [
      'grok-imagine-video-1.5',
      'grok-imagine-video-1.5-preview',
      'grok-imagine-video-1.5-2026-05-30',
    ]

    for (const modelId of modelIds) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.modelId === modelId)
      expect(manifest, `missing xAI manifest for ${modelId}`).toBeDefined()
      expect(manifest?.providerKind).toBe('xai')
      expect(manifest?.capabilities.map((capability) => capability.id)).toEqual([
        'video.image_to_video',
      ])
      const schema = manifest?.capabilities[0]?.paramSchema.properties as
        | Record<string, { enum?: unknown[] }>
        | undefined
      expect(schema?.resolution?.enum).toEqual(['480p', '720p', '1080p'])
      expect(manifest?.capabilities[0]?.input.required).toEqual(['image'])
    }

    const preset = PROVIDER_PRESETS.find((entry) => entry.id === 'xai-imagine-video')
    expect(preset?.modelIds).toEqual(expect.arrayContaining(modelIds))
    expect(preset?.mediaModelRefs?.map((reference) => reference.modelId)).toEqual(
      expect.arrayContaining(modelIds),
    )
  })

  it('keeps standard video parameters within documented values', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'xai:grok-imagine-video',
    )
    const generation = manifest?.capabilities.find((entry) => entry.id === 'video.generate')
    const reference = manifest?.capabilities.find(
      (entry) => entry.id === 'video.reference_to_video',
    )
    const schema = generation?.paramSchema.properties as Record<string, { enum?: unknown[] }>

    expect(schema.resolution?.enum).toEqual(['480p', '720p'])
    expect(schema.useLastFrame).toBeUndefined()
    expect(reference?.input.maxImages).toBe(7)
    expect(
      (reference?.paramSchema.properties as Record<string, { maximum?: number }>).durationSeconds
        ?.maximum,
    ).toBe(10)
    expect(
      manifest?.capabilities.find((entry) => entry.id === 'video.image_to_video')?.input.required,
    ).toEqual(['image'])
    const extension = manifest?.capabilities.find((entry) => entry.id === 'video.extend')
    const extensionDuration = (extension?.paramSchema.properties as Record<string, { minimum?: number; maximum?: number }>).durationSeconds
    expect(extensionDuration).toMatchObject({ minimum: 2, maximum: 10 })
  })

  it('exposes all documented image ratios, resolutions, and the three-image edit limit', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'xai:grok-imagine-image')
    const generation = manifest?.capabilities.find((entry) => entry.id === 'image.generate')
    const edit = manifest?.capabilities.find((entry) => entry.id === 'image.edit')
    const properties = generation?.paramSchema.properties as Record<string, { enum?: unknown[]; maximum?: number }>
    expect(properties.aspectRatio?.enum).toEqual([
      '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2',
      '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', 'auto',
    ])
    expect(properties.resolution?.enum).toEqual(['1k', '2k'])
    expect(properties.n?.maximum).toBeUndefined()
    expect(edit?.input.maxImages).toBe(3)
  })

  it('describes xAI TTS with the official endpoint and parameter names', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'xai:grok-tts')
    const properties = manifest?.capabilities[0]?.paramSchema.properties as Record<string, unknown>

    expect(manifest?.invocation.endpoint).toBe('/tts')
    expect(manifest?.invocation.requestTemplate).toMatchObject({
      text: '{{text}}',
      voice_id: '{{voiceId}}',
      output_format: '{{outputFormat}}',
    })
    expect(properties).toHaveProperty('voiceId')
    expect(properties).toHaveProperty('language')
    expect(properties).toHaveProperty('outputFormat')
    expect(properties).not.toHaveProperty('voice')
  })
})
