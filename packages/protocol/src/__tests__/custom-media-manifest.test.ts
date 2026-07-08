import { describe, expect, it } from 'vitest'
import { createBasicCustomMediaManifest } from '../custom-media-manifest.js'
import { validateMediaModelManifestSemantics } from '../media-model-manifest-validation.js'

describe('createBasicCustomMediaManifest', () => {
  it('creates a valid synchronous image manifest with common custom parameters', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-image-v1',
      modelType: 'image',
      mode: 'sync',
    })

    expect(manifest.id).toBe('custom:studio-image-v1')
    expect(manifest.invocation.endpoint).toBe('/images/generations')
    expect(manifest.capabilities[0]?.paramSchema).toMatchObject({
      properties: { size: { type: 'string' }, n: { type: 'integer' } },
    })
    expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
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
})
