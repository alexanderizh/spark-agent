import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '../media-model-manifest.js'
import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from '../media-config.js'
import { getProviderPresetById, PROVIDER_PRESETS } from '../provider-presets.js'
import { ZHIPU_SYSTEM_VOICES } from '../zhipu-media-model-manifests.js'

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

  it('registers StepFun Messages and Responses channel templates', () => {
    expect(getProviderPresetById('stepfun-anthropic')).toMatchObject({
      vendorId: 'stepfun',
      provider: 'anthropic',
      apiEndpoint: 'https://api.stepfun.com/step_plan',
      defaultModel: 'step-5-preview',
      modelIds: ['step-5-preview', 'step-3.7-flash', 'step-3.5-flash', 'step-3.5-flash-2603'],
      sourceUrls: expect.arrayContaining([
        'https://platform.stepfun.com/docs/zh/api-reference/chat/messages-create',
      ]),
    })
    expect(getProviderPresetById('stepfun-openai')).toMatchObject({
      vendorId: 'stepfun',
      provider: 'openai',
      apiEndpoint: 'https://api.stepfun.com/v1',
      codexApiKind: 'responses',
      defaultModel: 'step-5-preview',
      modelIds: ['step-5-preview', 'step-3.7-flash'],
      sourceUrls: expect.arrayContaining([
        'https://platform.stepfun.com/docs/zh/api-reference/responses/responses-create',
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

  it('wires zhipu audio to both speech and transcription manifests on one channel', () => {
    // 一个渠道同时承载 TTS 与 ASR：router / MCP 按 capability 匹配 manifest，
    // 因此两个模型必须都在 refs 里且启用，否则另一项能力会解析不到模型。
    expect(getProviderPresetById('zhipu-audio')).toMatchObject({
      vendorId: 'zhipu-open-platform',
      modelType: 'voice',
      mediaProvider: 'zhipu',
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-tts',
      mediaCapabilities: ['audio.speech', 'audio.transcription'],
      mediaModelRefs: [
        { manifestId: 'zhipu:glm-tts', modelId: 'glm-tts', enabled: true },
        { manifestId: 'zhipu:glm-asr-2512', modelId: 'glm-asr-2512', enabled: true },
      ],
      mediaDefaults: { audio: { voice: 'tongtong', format: 'wav', speed: 1 } },
    })
  })

  it('declares the zhipu speech manifest with a playable wav default and custom-capable voice', () => {
    const speech = BUILTIN_MEDIA_MODEL_MANIFESTS.find((manifest) => manifest.id === 'zhipu:glm-tts')
    if (!speech) throw new Error('zhipu speech manifest not found')
    // 官方默认 pcm 是无头裸流，内置默认必须是可播放的 wav。
    expect(speech.capabilities[0]?.defaults).toMatchObject({ format: 'wav', voice: 'tongtong' })
    expect(speech.invocation.response).toEqual({ kind: 'binary_response' })
    const properties = speech.capabilities[0]?.paramSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined
    const voiceSchema = properties?.voice
    // voice 必须用 examples + x-allow-custom：写成 enum 会让校验器硬拒复刻音色。
    expect(voiceSchema?.enum).toBeUndefined()
    expect(voiceSchema?.['x-allow-custom']).toBe(true)
    expect(voiceSchema?.examples).toContain('tongtong')
    // 未同步音色目录的新渠道靠这份静态标签显示中文名（同步后由接口的
    // voice_name 覆盖）；7 个系统音色少一个标签就会在候选里退回裸 ID。
    const labels = voiceSchema?.['x-template-labels'] as Record<string, string> | undefined
    expect(Object.keys(labels ?? {}).sort()).toEqual([...ZHIPU_SYSTEM_VOICES].sort())
    expect(labels?.tongtong).toBe('彤彤（默认）')
  })

  it('declares the zhipu transcription manifest with an uploadable multipart file part', () => {
    const asr = BUILTIN_MEDIA_MODEL_MANIFESTS.find((manifest) => manifest.id === 'zhipu:glm-asr-2512')
    if (!asr) throw new Error('zhipu ASR manifest not found')
    // legacy contentType:'multipart' 只产出 text parts、永远不上传文件，
    // 因此 V2 request.body 必须显式声明 file 段，否则转写会发出没有文件的请求。
    expect(asr.invocation.request?.body).toMatchObject({
      kind: 'multipart',
      parts: expect.arrayContaining([
        expect.objectContaining({ name: 'file', kind: 'file', value: '{{audio}}' }),
      ]),
    })
    expect(asr.invocation.response).toEqual({ kind: 'url', jsonPaths: ['text'], download: false })
    expect(asr.capabilities[0]?.output.types).toEqual(['text'])
  })
})
