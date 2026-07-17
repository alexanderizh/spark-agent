import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '../media-model-manifest.js'

describe('Volcengine Ark media manifests', () => {
  it('only exposes Seedance 2.0 web search for text-to-video', () => {
    for (const modelId of [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-0-mini-260615',
    ]) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((item) => item.modelId === modelId)

      for (const capability of manifest?.capabilities ?? []) {
        const properties = capability.paramSchema.properties as
          | Record<string, unknown>
          | undefined
        if (capability.id === 'video.generate') {
          expect(properties?.searchEnabled).toBeDefined()
          expect(capability.defaults?.searchEnabled).toBe(false)
          expect(capability.aliases?.searchEnabled).toBe('enable_search')
        } else {
          expect(properties?.searchEnabled).toBeUndefined()
          expect(capability.defaults?.searchEnabled).toBeUndefined()
          expect(capability.aliases?.searchEnabled).toBeUndefined()
        }
      }
    }
  })

  it('does not expose unsupported Seedance 1.x image-to-video parameters', () => {
    for (const modelId of [
      'doubao-seedance-1-5-pro-251215',
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015',
    ]) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((item) => item.modelId === modelId)
      const imageToVideo = manifest?.capabilities.find(
        (item) => item.id === 'video.image_to_video',
      )
      const properties = imageToVideo?.paramSchema.properties as
        | Record<string, { enum?: string[] }>
        | undefined

      expect(properties?.resolution?.enum).toEqual(['480p', '720p'])
      if (modelId.includes('seedance-1-0-')) {
        expect(properties?.cameraFixed).toBeUndefined()
        expect(imageToVideo?.defaults?.cameraFixed).toBeUndefined()
        expect(imageToVideo?.aliases?.cameraFixed).toBeUndefined()
      }
    }
  })

  it('uses a valid non-1080p default for Seedance 1.0 image-to-video', () => {
    for (const modelId of [
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015',
    ]) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((item) => item.modelId === modelId)
      const generation = manifest?.capabilities.find((item) => item.id === 'video.generate')
      const imageToVideo = manifest?.capabilities.find(
        (item) => item.id === 'video.image_to_video',
      )
      const properties = imageToVideo?.paramSchema.properties as
        | Record<string, unknown>
        | undefined
      const resolution = properties?.resolution as
        | { enum?: string[] }
        | undefined

      expect(generation?.defaults?.resolution).toBe('1080p')
      expect(imageToVideo?.defaults?.resolution).toBe('720p')
      expect(resolution?.enum).toEqual(['480p', '720p'])
    }
  })

  it('uses a minimum-input-safe generated image default for Seedream editing', () => {
    for (const modelId of [
      'doubao-seedream-5-0-lite-260128',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
    ]) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((item) => item.modelId === modelId)
      const generation = manifest?.capabilities.find((item) => item.id === 'image.generate')
      const edit = manifest?.capabilities.find((item) => item.id === 'image.edit')

      expect(generation?.defaults?.maxImages).toBe(15)
      expect(edit?.defaults?.maxImages).toBe(14)
    }
  })
})
