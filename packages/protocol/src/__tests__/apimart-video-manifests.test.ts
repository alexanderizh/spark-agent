import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '../media-model-manifest.js'
import { inferRolePolicy } from '../media-config.js'
import { apimartVideoInputContracts } from '../apimart-video-input-contracts.js'

describe('APIMart video manifests', () => {
  it('describes Seedance 1.5 Pro first-and-last-frame input as two images', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'apimart:doubao-seedance-1-5-pro-apimart',
    )
    const capability = manifest?.capabilities.find((entry) => entry.id === 'video.image_to_video')

    expect(capability?.input.maxImages).toBe(2)
    expect(capability && inferRolePolicy(capability).imageRoles).toEqual([
      'first_frame',
      'last_frame',
    ])
  })

  it('uses documented multimodal input limits instead of a shared one-image fallback', () => {
    for (const modelId of [
      'doubao-seedance-2.0',
      'doubao-seedance-2-0-fast',
      'doubao-seedance-2-0-mini',
    ]) {
      expectInput(modelId, 'video.reference_to_video', {
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
      })
      const imageToVideo = findCapability(modelId, 'video.image_to_video')
      if (!imageToVideo) throw new Error(`missing ${modelId}/video.image_to_video`)
      expect(imageToVideo.input.maxImages).toBe(2)
      expect(inferRolePolicy(imageToVideo).imageRoles).toEqual(['first_frame', 'last_frame'])
    }

    for (const modelId of ['happyhorse-1.0', 'happyhorse-1.1']) {
      expectInput(modelId, 'video.reference_to_video', { maxImages: 9 })
    }
    expectInput('happyhorse-1.0', 'video.edit', { maxImages: 5, maxVideos: 1 })

    for (const modelId of ['viduq3', 'viduq3-mix']) {
      expectInput(modelId, 'video.reference_to_video', { maxImages: 7 })
    }
    expectInput('grok-imagine-1.5-video-apimart', 'video.reference_to_video', {
      maxImages: 7,
    })
    expectInput('veo3', 'video.reference_to_video', { maxImages: 3 })
    expectInput('pixverse-v6', 'video.reference_to_video', { maxImages: 7 })
    expectInput('gemini-omni-flash-preview', 'video.reference_to_video', {
      maxImages: 16,
      maxVideos: 1,
    })
    expectInput('Omni-Flash-Ext', 'video.reference_to_video', {
      maxImages: 3,
      maxVideos: 1,
    })
    expectInput('wan2.7-r2v', 'video.reference_to_video', {
      maxImages: 5,
      maxVideos: 5,
    })
    expectInput('wan2.7-videoedit', 'video.edit', { maxImages: 4, maxVideos: 1 })
  })

  it('does not guess a one-image limit for an unknown APIMart model', () => {
    expect(apimartVideoInputContracts('custom-apimart-video').map((entry) => entry.id)).toEqual([
      'video.generate',
    ])
  })

  it('keeps frame limits separate from reference-image limits', () => {
    expect(findCapability('skyreels-v4-fast', 'video.image_to_video')?.input.maxImages).toBe(2)
    expect(findCapability('skyreels-v4-fast', 'video.reference_to_video')?.input.maxImages).toBe(15)
    expect(findCapability('veo3.1-fast', 'video.image_to_video')?.input.maxImages).toBe(2)
    expect(findCapability('veo3.1-fast', 'video.reference_to_video')?.input.maxImages).toBe(3)
    expect(findCapability('Omni-Flash-Ext', 'video.image_to_video')?.input.maxImages).toBe(1)
    expect(findCapability('Omni-Flash-Ext', 'video.reference_to_video')?.input.maxImages).toBe(3)
  })

  it('keeps documented first/last-frame counts model-specific', () => {
    for (const modelId of [
      'doubao-seedance-2.0',
      'doubao-seedance-2-0-fast',
      'doubao-seedance-2-0-mini',
      'veo3.1-quality',
      'MiniMax-Hailuo-02',
      'doubao-seedance-1-0-pro-quality',
      'kling-v2-6',
      'kling-v3',
      'kling-video-o1',
      'viduq3-pro',
      'viduq3-turbo',
      'wan2.7',
    ]) {
      const capability = findCapability(modelId, 'video.image_to_video')
      expect(capability?.input.maxImages, modelId).toBeGreaterThanOrEqual(2)
      expect(capability && inferRolePolicy(capability).imageRoles, modelId).toEqual(
        expect.arrayContaining(['first_frame', 'last_frame']),
      )
    }

    for (const modelId of [
      'sora-2',
      'sora-2-pro',
      'doubao-seedance-1-0-pro-fast',
      'MiniMax-Hailuo-2.3',
      'wan2.5-preview',
      'wan2.6',
      'kling-3.0-turbo',
    ]) {
      const capability = findCapability(modelId, 'video.image_to_video')
      expect(capability?.input.maxImages, modelId).toBe(1)
      expect(capability && inferRolePolicy(capability).imageRoles, modelId).toEqual([
        'first_frame',
      ])
    }
  })

  it('does not inject duration into Omni Flash reference-video requests', () => {
    const reference = findCapability('Omni-Flash-Ext', 'video.reference_to_video')
    const frame = findCapability('Omni-Flash-Ext', 'video.image_to_video')

    expect(reference?.defaults?.durationSeconds).toBeUndefined()
    expect(frame?.defaults?.durationSeconds).toBe(6)
  })

  it('keeps prompt requirements model- and mode-specific', () => {
    expect(
      findCapability('doubao-seedance-2.0', 'video.reference_to_video')?.input.required,
    ).toEqual([])
    expect(findCapability('doubao-seedance-2.0', 'video.image_to_video')?.input.required).toEqual([
      'image',
    ])
    expect(findCapability('happyhorse-1.0', 'video.image_to_video')?.input.required).toEqual([
      'image',
    ])
    expect(findCapability('viduq3-pro', 'video.image_to_video')?.input.required).toEqual(['image'])
    expect(findCapability('wan2.5-preview', 'video.image_to_video')?.input.required).toEqual([
      'image',
    ])
    expect(findCapability('wan2.7-videoedit', 'video.edit')?.input.required).toEqual(['video'])
    expect(
      findCapability('gemini-omni-flash-preview', 'video.reference_to_video')?.input.required,
    ).toEqual([])
  })

  it('uses the current Sora 2 duration and resolution contract', () => {
    for (const modelId of ['sora-2', 'sora-2-pro']) {
      const properties = findCapability(modelId, 'video.generate')?.paramSchema.properties as
        | Record<string, { enum?: unknown[] }>
        | undefined
      expect(properties?.durationSeconds?.enum).toEqual([4, 8, 12, 16, 20])
      expect(properties?.resolution?.enum).toEqual(
        modelId === 'sora-2' ? ['720p'] : ['720p', '1024p', '1080p'],
      )
    }
  })

  it('uses the current Seedance 2.0 duration, resolution, and audio defaults', () => {
    const standard = findCapability('doubao-seedance-2.0', 'video.generate')
    const fast = findCapability('doubao-seedance-2-0-fast', 'video.generate')
    const mini = findCapability('doubao-seedance-2-0-mini', 'video.generate')
    const standardProperties = standard?.paramSchema.properties as Record<
      string,
      { minimum?: number; enum?: unknown[] }
    >
    const fastProperties = fast?.paramSchema.properties as Record<
      string,
      { minimum?: number; enum?: unknown[] }
    >
    const miniProperties = mini?.paramSchema.properties as Record<
      string,
      { minimum?: number; enum?: unknown[] }
    >

    expect(standardProperties.durationSeconds).toMatchObject({ minimum: 4 })
    expect(standardProperties.resolution?.enum).toEqual(['480p', '720p', '1080p', '4k'])
    expect(standard?.defaults).toMatchObject({ resolution: '720p', generate_audio: true })
    expect(fastProperties.durationSeconds).toMatchObject({ minimum: 4 })
    expect(fast?.defaults).toMatchObject({ resolution: '720p', generate_audio: true })
    expect(miniProperties.durationSeconds).toMatchObject({ minimum: 4 })
    expect(mini?.defaults).toMatchObject({ resolution: '720p', generate_audio: true })
  })

  it('uses the documented Seedance 1.5 audio default while allowing explicit audio=false', () => {
    const capability = findCapability('doubao-seedance-1-5-pro', 'video.generate')
    const properties = capability?.paramSchema.properties as Record<string, { default?: unknown; enum?: unknown[] }>

    expect(properties.audio?.default).toBe(true)
    expect(capability?.defaults?.audio).toBe(true)
    expect(properties.audio?.enum).toBeUndefined()
  })

  it('does not advertise unsupported image input for VEO 3.1 Lite', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.providerKind === 'apimart' && entry.modelId === 'veo3.1-lite',
    )
    expect(manifest?.capabilities.map((entry) => entry.id)).toEqual(['video.generate'])
  })

  it('only defaults HappyHorse audio_setting in edit mode', () => {
    expect(
      findCapability('happyhorse-1.0', 'video.generate')?.defaults?.audio_setting,
    ).toBeUndefined()
    expect(
      findCapability('happyhorse-1.0', 'video.reference_to_video')?.defaults?.audio_setting,
    ).toBeUndefined()
    expect(findCapability('happyhorse-1.0', 'video.edit')?.defaults?.audio_setting).toBe('auto')
  })
})

function findCapability(modelId: string, capabilityId: string) {
  return BUILTIN_MEDIA_MODEL_MANIFESTS.find(
    (entry) => entry.providerKind === 'apimart' && entry.modelId === modelId,
  )?.capabilities.find((entry) => entry.id === capabilityId)
}

function expectInput(
  modelId: string,
  capabilityId: string,
  expected: { maxImages?: number; maxVideos?: number; maxAudios?: number },
) {
  expect(findCapability(modelId, capabilityId)?.input, `${modelId}/${capabilityId}`).toMatchObject(
    expected,
  )
}
