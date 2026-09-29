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

  it('creates a valid OpenAI audio transcription contract when the capability is audio.transcription', () => {
    // 用户在契约编辑器把能力切到语音识别后，基底模板应生成 /audio/transcriptions 合同：
    // Contract V2 multipart request.body 显式声明 file 段（legacy contentType:'multipart'
    // 分支不会上传文件），响应从 JSON { text } 提取且不落盘。
    const input = base('audio')
    input.capabilities = [
      {
        id: 'audio.transcription',
        label: '语音转文本',
        input: { required: ['audio'], maxAudios: 1 },
        output: { types: ['text'], mimeTypes: ['text/plain'] },
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
        defaults: {},
      },
    ]
    const manifest = applyAdapterBaseTemplate(input, 'openai-compatible')
    expectValid(manifest)
    expect(manifest.capabilities.map((item) => item.id)).toEqual(['audio.transcription'])
    expect(manifest.invocation.request?.endpoint).toBe('/audio/transcriptions')
    expect(manifest.invocation.response).toEqual({
      kind: 'url',
      jsonPaths: ['text'],
      download: false,
    })
    const body = manifest.invocation.request?.body
    expect(body?.kind).toBe('multipart')
    if (body?.kind !== 'multipart') throw new Error('expected a multipart body')
    const filePart = body.parts.find((part) => part.kind === 'file')
    expect(filePart).toMatchObject({ name: 'file', value: '{{audio}}' })
    // 画布识别节点的通用兜底字段会提供 response_format；基底合同必须真的投递它，
    // 否则用户选中后参数被静默丢弃（留空时编译器自动跳过该段）。
    const formatPart = body.parts.find((part) => part.name === 'response_format')
    expect(formatPart).toMatchObject({ kind: 'text', value: '{{params.response_format}}' })
    expect(manifest.capabilities[0]?.paramSchema).toMatchObject({
      properties: { language: expect.anything(), response_format: expect.anything() },
    })
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
