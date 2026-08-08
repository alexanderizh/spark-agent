import { describe, expect, it } from 'vitest'
import {
  createBasicCustomMediaManifest,
  createCustomMediaManifestId,
} from '../custom-media-manifest.js'
import { validateMediaModelManifestSemantics } from '../media-model-manifest-validation.js'

describe('createBasicCustomMediaManifest', () => {
  it('creates a valid synchronous image manifest with common custom parameters', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-image-v1',
      modelType: 'image',
      mode: 'sync',
    })

    expect(manifest.id).toMatch(/^custom:studio-image-v1:[a-f0-9-]{36}$/)
    expect(manifest.invocation.endpoint).toBe('/images/generations')
    expect(manifest.capabilities[0]?.paramSchema).toMatchObject({
      properties: { size: { type: 'string' }, n: { type: 'integer' } },
    })
    expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
  })

  it('creates distinct manifest identities for the same model name', () => {
    expect(createCustomMediaManifestId('shared-model', 'provider-a')).toBe(
      'custom:shared-model:provider-a',
    )
    expect(createCustomMediaManifestId('shared-model', 'provider-b')).toBe(
      'custom:shared-model:provider-b',
    )
  })

  it('preserves an existing legacy manifest id when editing old configurations', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'shared-model',
      modelType: 'image',
      mode: 'sync',
      manifestId: 'custom:shared-model',
    })
    expect(manifest.id).toBe('custom:shared-model')
  })

  it('creates a valid async video manifest with task polling defaults', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-video-v1',
      modelType: 'video',
      mode: 'async_polling',
    })

    expect(manifest.invocation.response).toMatchObject({
      kind: 'task_poll',
      taskIdPaths: ['task_id', 'id'],
      statusEndpoint: '/tasks/{{taskId}}',
    })
    expect(manifest.invocation.polling?.statusMap).toMatchObject({ completed: 'succeeded' })
    expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
  })

  it('declares the complete image and video capability surface for new custom models', () => {
    const image = createBasicCustomMediaManifest({
      modelId: 'image-all',
      modelType: 'image',
      mode: 'sync',
    })
    const video = createBasicCustomMediaManifest({
      modelId: 'video-all',
      modelType: 'video',
      mode: 'async_polling',
    })

    expect(image.capabilities.map((capability) => capability.id)).toEqual([
      'image.generate',
      'image.edit',
    ])
    expect(video.capabilities.map((capability) => capability.id)).toEqual([
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
      'video.extend',
    ])
    expect(validateMediaModelManifestSemantics(image)).toEqual([])
    expect(validateMediaModelManifestSemantics(video)).toEqual([])
  })
})
