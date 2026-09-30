import { describe, expect, it } from 'vitest'
import {
  createBasicCustomMediaManifest,
  createCustomMediaManifestId,
  primaryCustomAudioCapability,
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
    expect(manifest.baseTemplate).toBe('custom')
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

  it('keeps the OpenAI TTS contract for custom voice models by default', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-tts-v1',
      modelType: 'voice',
      mode: 'sync',
    })

    expect(manifest.capabilities.map((capability) => capability.id)).toEqual(['audio.speech'])
    expect(manifest.invocation).toMatchObject({
      mode: 'sync',
      endpoint: '/audio/speech',
      response: { kind: 'binary_response' },
    })
    expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
  })

  it('builds the transcriptions contract when the channel only selected speech recognition', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-asr-v1',
      modelType: 'voice',
      mode: 'sync',
      audioCapabilities: ['audio.transcription'],
    })

    expect(manifest.baseTemplate).toBe('openai-compatible')
    expect(manifest.capabilities.map((capability) => capability.id)).toEqual([
      'audio.transcription',
    ])
    expect(manifest.invocation.endpoint).toBe('/audio/transcriptions')
    // 上传音频必须靠 V2 multipart 的 file 段；legacy multipart 迁移只产出文本 parts。
    const body = manifest.invocation.request?.body
    expect(body?.kind).toBe('multipart')
    expect(
      body?.kind === 'multipart' ? body.parts.find((part) => part.kind === 'file')?.value : null,
    ).toBe('{{audio}}')
    // 画布识别节点的通用兜底字段会提供 response_format；合同必须真的投递它，
    // 否则用户选中后参数被静默丢弃（留空时编译器自动跳过该段）。
    expect(
      body?.kind === 'multipart'
        ? body.parts.find((part) => part.name === 'response_format')
        : null,
    ).toMatchObject({ kind: 'text', value: '{{params.responseFormat}}' })
    const capability = manifest.capabilities[0]
    const properties = (capability?.paramSchema as { properties?: Record<string, unknown> })
      .properties
    // schema 与模板引用都必须是 canonical 键：编译器裁剪前会把 provider 原生名
    // `response_format` 归一成 canonical，用原生名声明会被 strict 丢弃、
    // `{{params.*}}` 也取不到值（用户选的返回格式会静默失效）。
    expect(properties).toMatchObject({
      language: expect.anything(),
      responseFormat: expect.anything(),
    })
    expect(properties).not.toHaveProperty('response_format')
    expect(capability?.aliases).toEqual({ responseFormat: 'response_format' })
    expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
  })

  it('builds an editable music contract for custom music models', () => {
    const manifest = createBasicCustomMediaManifest({
      modelId: 'studio-music-v1',
      modelType: 'voice',
      mode: 'sync',
      audioCapabilities: ['audio.music'],
    })

    expect(manifest.baseTemplate).toBe('custom')
    expect(manifest.capabilities.map((capability) => capability.id)).toEqual(['audio.music'])
    expect(manifest.invocation).toMatchObject({
      mode: 'sync',
      endpoint: '/v1/music_generation',
      response: { kind: 'url', download: true },
    })
    // 音乐合同同样是 canonical 键 + aliases：`output_format` 会被编译器归一成
    // `outputFormat`，模板引用写原生名会在请求里渲染成空值。
    const musicCapability = manifest.capabilities[0]
    const musicProperties = (
      musicCapability?.paramSchema as { properties?: Record<string, unknown> }
    ).properties
    expect(musicProperties).toMatchObject({ outputFormat: expect.anything() })
    expect(musicCapability?.aliases).toEqual({ outputFormat: 'output_format' })
    const template = manifest.invocation.requestTemplate as Record<string, unknown> | undefined
    expect(template?.['output_format']).toBe('{{params.outputFormat}}')
    expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
  })

  it('picks the primary audio capability by fixed priority and falls back to speech', () => {
    expect(primaryCustomAudioCapability(['audio.music', 'audio.speech'])).toBe('audio.speech')
    expect(primaryCustomAudioCapability(['audio.transcription', 'audio.music'])).toBe('audio.music')
    expect(primaryCustomAudioCapability(['audio.unknown'])).toBe('audio.speech')
    expect(primaryCustomAudioCapability([])).toBe('audio.speech')
    expect(primaryCustomAudioCapability(undefined)).toBe('audio.speech')
  })
})
