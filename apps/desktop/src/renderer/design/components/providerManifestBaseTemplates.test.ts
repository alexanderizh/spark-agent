import { describe, expect, it } from 'vitest'
import {
  MediaModelManifestSchema,
  createBasicCustomMediaManifest,
  validateMediaModelManifestSemantics,
} from '@spark/protocol'
import {
  applyAdapterBaseTemplate,
  resolveAdapterBaseTemplate,
} from './providerManifestBaseTemplates'

function base(domain: 'image' | 'video' | 'audio' = 'image') {
  const manifest = createBasicCustomMediaManifest({
    modelId: `custom-${domain}`,
    modelType: domain === 'audio' ? 'image' : domain,
    mode: domain === 'video' ? 'async_polling' : 'sync',
    manifestId: `custom:${domain}`,
  })
  if (domain === 'audio') manifest.domains = ['audio']
  return manifest
}

function expectValid(manifest: ReturnType<typeof base>) {
  expect(MediaModelManifestSchema.safeParse(manifest).success).toBe(true)
  expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
}

describe('provider manifest base templates', () => {
  it('creates valid custom, async, ToApis and OpenAI image contracts', () => {
    expectValid(applyAdapterBaseTemplate(base(), 'custom'))
    expectValid(applyAdapterBaseTemplate(base(), 'async-json'))
    expectValid(applyAdapterBaseTemplate(base(), 'toapis-image'))
    expectValid(applyAdapterBaseTemplate(base(), 'openai-compatible'))
  })

  it('regenerates a domain-compatible capability for the generic async base', () => {
    const input = base('video')
    input.capabilities = []
    const manifest = applyAdapterBaseTemplate(input, 'async-json')
    expectValid(manifest)
    expect(manifest.capabilities.map((item) => item.id)).toEqual(['video.generate'])
  })

  it('creates a valid OpenAI multipart image edit contract', () => {
    const input = base()
    const firstCapability = input.capabilities[0]
    expect(firstCapability).toBeDefined()
    if (!firstCapability) throw new Error('expected a generated base capability')
    input.capabilities = [{ ...firstCapability, id: 'image.edit', label: '图片编辑' }]
    const manifest = applyAdapterBaseTemplate(input, 'openai-compatible')
    expectValid(manifest)
    expect(manifest.invocation.request).toMatchObject({
      endpoint: '/images/edits',
      body: { kind: 'multipart' },
    })
  })

  it('creates a valid OpenAI video polling contract', () => {
    const manifest = applyAdapterBaseTemplate(base('video'), 'openai-compatible')
    expectValid(manifest)
    expect(manifest.invocation.response).toMatchObject({
      kind: 'task_poll',
      poll: { endpoint: '/videos/{taskId}' },
      artifact: {
        request: { endpoint: '/videos/{{taskId}}/content' },
        response: { kind: 'binary_response' },
      },
    })
  })

  it('creates a multipart OpenAI reference-image video contract', () => {
    const input = base('video')
    const firstCapability = input.capabilities[0]
    expect(firstCapability).toBeDefined()
    if (!firstCapability) throw new Error('expected a generated video capability')
    input.capabilities = [{ ...firstCapability, id: 'video.image_to_video', label: '参考图生视频' }]
    const manifest = applyAdapterBaseTemplate(input, 'openai-compatible')
    expectValid(manifest)
    expect(manifest.invocation.request).toMatchObject({
      endpoint: '/videos',
      body: {
        kind: 'multipart',
        parts: expect.arrayContaining([
          { name: 'input_reference', kind: 'file', value: '{{firstFrame}}' },
        ]),
      },
    })
    expect(manifest.safety?.allowLocalFiles).toBe(true)
  })

  it('creates a valid OpenAI audio binary contract', () => {
    const manifest = applyAdapterBaseTemplate(base('audio'), 'openai-compatible')
    expectValid(manifest)
    expect(manifest.capabilities.map((item) => item.id)).toEqual(['audio.speech'])
    expect(manifest.invocation.request?.endpoint).toBe('/audio/speech')
    expect(manifest.invocation.response).toMatchObject({ kind: 'binary_response' })
  })

  it('infers old presets only for display and persists new selections explicitly', () => {
    const legacyToApis = base()
    delete legacyToApis.baseTemplate
    legacyToApis.docs.sourceUrls = ['https://docs.toapis.com/example']
    expect(resolveAdapterBaseTemplate(legacyToApis)).toBe('toapis-image')

    const legacyOpenAiVideo = applyAdapterBaseTemplate(base('video'), 'openai-compatible')
    delete legacyOpenAiVideo.baseTemplate
    expect(resolveAdapterBaseTemplate(legacyOpenAiVideo)).toBe('openai-compatible')

    const selected = applyAdapterBaseTemplate(base(), 'openai-compatible')
    const request = selected.invocation.request
    expect(request).toBeDefined()
    if (!request) throw new Error('expected a generated V2 request')
    selected.invocation.request = { ...request, endpoint: '/custom-route' }
    expect(resolveAdapterBaseTemplate(selected)).toBe('openai-compatible')
  })
})
