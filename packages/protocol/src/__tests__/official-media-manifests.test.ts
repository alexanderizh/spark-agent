import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS, MediaModelManifestSchema } from '../media-model-manifest.js'
import { validateMediaModelManifestSemantics } from '../media-model-manifest-validation.js'

const openAiIds = [
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'gpt-image-1.5',
  'gpt-image-1.5-2025-12-16',
  'gpt-image-1',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
  'sora-2',
  'sora-2-2025-10-06',
  'sora-2-2025-12-08',
  'sora-2-pro',
  'sora-2-pro-2025-10-06',
]

const googleIds = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-lite-generate-preview',
  'gemini-omni-flash-preview',
  'lyria-3-clip-preview',
  'lyria-3-pro-preview',
]

describe('official OpenAI and Google media manifests', () => {
  it('registers every full model id under its own provider namespace', () => {
    const openAi = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (manifest) => manifest.providerKind === 'openai-images',
    )
    const google = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (manifest) => manifest.providerKind === 'google-generative-ai',
    )

    expect(openAi.map((manifest) => manifest.modelId)).toEqual(openAiIds)
    expect(google.map((manifest) => manifest.modelId)).toEqual(googleIds)
    expect(openAi.map((manifest) => manifest.id)).toEqual(
      openAiIds.map((modelId) => `openai-images:${modelId}`),
    )
    expect(google.map((manifest) => manifest.id)).toEqual(
      googleIds.map((modelId) => `google-generative-ai:${modelId}`),
    )
  })

  it('does not merge or replace same-name manifests from other providers', () => {
    const official = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'openai-images:gpt-image-2',
    )
    const apimart = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'apimart:gpt-image-2',
    )

    expect(official?.providerKind).toBe('openai-images')
    expect(apimart?.providerKind).toBe('apimart')
    expect(official).not.toBe(apimart)
    const googleOmni = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'google-generative-ai:gemini-omni-flash-preview',
    )
    const legacyOmni = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'omni:gemini-omni-flash-preview',
    )
    expect(googleOmni?.providerKind).toBe('google-generative-ai')
    expect(legacyOmni?.providerKind).toBe('omni')
    expect(googleOmni).not.toBe(legacyOmni)
  })

  it('keeps shut-down models out and exposes required capabilities', () => {
    const officialIds = new Set([
      ...openAiIds.map((modelId) => `openai-images:${modelId}`),
      ...googleIds.map((modelId) => `google-generative-ai:${modelId}`),
    ])
    const official = BUILTIN_MEDIA_MODEL_MANIFESTS.filter((manifest) =>
      officialIds.has(manifest.id),
    )

    expect(official).toHaveLength(25)
    expect(official.some((manifest) => manifest.modelId === 'dall-e-3')).toBe(false)
    expect(official.some((manifest) => manifest.modelId === 'veo-3.0-generate-001')).toBe(false)
    expect(
      official
        .find((manifest) => manifest.modelId === 'gpt-image-2')
        ?.capabilities.map((item) => item.id),
    ).toEqual(['image.generate', 'image.edit'])
    expect(
      official.find((manifest) => manifest.modelId === 'lyria-3-pro-preview')?.capabilities[0]?.id,
    ).toBe('audio.music')
    const gptImage2Schema = official.find(
      (manifest) => manifest.modelId === 'gpt-image-2',
    )?.capabilities.find((capability) => capability.id === 'image.generate')?.paramSchema as {
      properties?: { background?: { enum?: string[] } }
    }
    const gptImage2EditSchema = official.find(
      (manifest) => manifest.modelId === 'gpt-image-2',
    )?.capabilities.find((capability) => capability.id === 'image.edit')?.paramSchema as {
      properties?: { inputFidelity?: unknown }
    }
    const imagenFastSchema = official.find(
      (manifest) => manifest.modelId === 'imagen-4.0-fast-generate-001',
    )?.capabilities[0]?.paramSchema as {
      properties?: { imageSize?: { enum?: string[] } }
    }
    expect(gptImage2Schema.properties?.background?.enum).toEqual(['auto', 'opaque'])
    expect(gptImage2EditSchema.properties).not.toHaveProperty('inputFidelity')
    expect(imagenFastSchema.properties?.imageSize?.enum).toEqual(['1K'])
  })

  it('exposes separate OpenAI image and Sora presets for the configuration page', async () => {
    const { getProviderPresetById } = await import('../provider-presets.js')
    const imagePreset = getProviderPresetById('openai-images')
    const videoPreset = getProviderPresetById('openai-sora-video')

    expect(imagePreset).toMatchObject({
      modelType: 'image',
      mediaProvider: 'openai-images',
      mediaCapabilities: ['image.generate', 'image.edit'],
    })
    expect(imagePreset?.mediaModelRefs?.every((ref) => ref.modelId?.startsWith('gpt-image-') || ref.modelId === 'chatgpt-image-latest')).toBe(true)
    expect(videoPreset).toMatchObject({
      modelType: 'video',
      mediaProvider: 'openai-images',
      mediaCapabilities: ['video.generate', 'video.image_to_video'],
    })
    expect(videoPreset?.mediaModelRefs?.every((ref) => ref.modelId?.startsWith('sora-'))).toBe(true)
    expect(getProviderPresetById('google-omni-video')?.mediaProvider).toBe('omni')
    expect(getProviderPresetById('google-gemini-omni-video')?.mediaProvider).toBe(
      'google-generative-ai',
    )
  })

  it('passes manifest structure and semantic validation', () => {
    const manifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (manifest) =>
        manifest.providerKind === 'openai-images' ||
        manifest.providerKind === 'google-generative-ai',
    )
    for (const manifest of manifests) {
      expect(MediaModelManifestSchema.safeParse(manifest).success, manifest.id).toBe(true)
      expect(validateMediaModelManifestSemantics(manifest), manifest.id).toEqual([])
    }
  })
})
