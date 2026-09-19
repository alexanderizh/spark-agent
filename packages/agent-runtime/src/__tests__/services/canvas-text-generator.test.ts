import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  generateCanvasText,
  resolveCanvasTextRequestTimeoutMs,
} from '../../services/canvas-text-generator.js'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** 抓取最后一次请求的 mock fetch。 */
function stubFetch(
  responseBody: unknown,
  init?: { status?: number },
): {
  lastUrl: () => string
  lastBody: () => Record<string, unknown>
} {
  const state: { url: string; body: Record<string, unknown> } = { url: '', body: {} }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, requestInit?: RequestInit) => {
      state.url = url
      state.body = JSON.parse(String(requestInit?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify(responseBody), { status: init?.status ?? 200 })
    }),
  )
  return { lastUrl: () => state.url, lastBody: () => state.body }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('generateCanvasText multimodal', () => {
  it('uses a 10 minute default timeout and supports a bounded environment override', () => {
    expect(resolveCanvasTextRequestTimeoutMs({})).toBe(600_000)
    expect(resolveCanvasTextRequestTimeoutMs({ SPARK_CANVAS_TEXT_TIMEOUT_MS: '900000' })).toBe(
      900_000,
    )
    expect(resolveCanvasTextRequestTimeoutMs({ SPARK_CANVAS_TEXT_TIMEOUT_MS: '1000' })).toBe(10_000)
    expect(resolveCanvasTextRequestTimeoutMs({ SPARK_CANVAS_TEXT_TIMEOUT_MS: '99999999' })).toBe(
      1_800_000,
    )
  })

  it('converts an internal abort into an explicit canvas timeout error', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, requestInit?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          requestInit?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'))
          })
        })
      }),
    )

    const pending = generateCanvasText({
      providerType: 'openai',
      apiKey: 'sk-x',
      apiEndpoint: 'https://api.example.com/v1',
      model: 'gpt-5.4',
      prompt: '生成剧本',
      timeoutMs: 25,
    })
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'CanvasTextTimeoutError',
      code: 'request_timeout',
      timeoutMs: 25,
      message: expect.stringContaining('画布文本请求超时'),
      requestCall: {
        method: 'POST',
        url: 'https://api.example.com/v1/chat/completions',
      },
    })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
  })

  it('OpenAI-compatible: 纯文本时 user content 仍是字符串', async () => {
    const captured = stubFetch({
      choices: [{ message: { content: '一段风格描述' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    })
    const result = await generateCanvasText({
      providerType: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-4o',
      prompt: '分析风格',
    })
    expect(result.text).toBe('一段风格描述')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 8, totalTokens: 20 })
    expect(captured.lastBody().max_tokens).toBe(16_384)
    const messages = captured.lastBody().messages as Array<{ role: string; content: unknown }>
    const user = messages.find((m) => m.role === 'user')!
    expect(user.content).toBe('分析风格')
  })

  it('OpenAI-compatible: 带图片时把图作为 image_url vision 输入发送', async () => {
    const captured = stubFetch({ choices: [{ message: { content: 'ok' } }] })
    await generateCanvasText({
      providerType: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-4o',
      prompt: '请分析输入图片的视觉风格',
      images: [{ url: 'https://cdn/ref.png' }],
    })
    expect(captured.lastBody().max_tokens).toBe(16_384)
    const messages = captured.lastBody().messages as Array<{ role: string; content: unknown }>
    const user = messages.find((m) => m.role === 'user')!
    const parts = user.content as Array<Record<string, unknown>>
    expect(Array.isArray(parts)).toBe(true)
    expect(parts).toContainEqual({ type: 'text', text: '请分析输入图片的视觉风格' })
    expect(parts).toContainEqual({ type: 'image_url', image_url: { url: 'https://cdn/ref.png' } })
  })

  it('Anthropic: 带公网 URL 图片时使用 image url source，且图在文本之前', async () => {
    const captured = stubFetch({ content: [{ type: 'text', text: 'ok' }] })
    await generateCanvasText({
      providerType: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-3-5-sonnet',
      prompt: '分析风格',
      images: [{ url: 'https://cdn/ref.png' }],
    })
    expect(captured.lastBody().max_tokens).toBe(16_384)
    const messages = captured.lastBody().messages as Array<{ role: string; content: unknown }>
    const blocks = messages[0]!.content as Array<Record<string, unknown>>
    expect(blocks[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://cdn/ref.png' },
    })
    expect(blocks[1]).toEqual({ type: 'text', text: '分析风格' })
  })

  it('Anthropic: 记录 stop_reason 和 token usage，便于识别输出截断', async () => {
    const captured = stubFetch({
      content: [{ type: 'text', text: '{"shots":[' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 4461, output_tokens: 16384, total_tokens: 20845 },
    })
    const result = await generateCanvasText({
      providerType: 'anthropic',
      apiKey: 'sk-ant',
      apiEndpoint: 'https://ark.example.com/api/coding',
      model: 'glm-5.2',
      prompt: '输出分镜 JSON',
      maxTokens: 65_536,
    })

    expect(captured.lastBody().max_tokens).toBe(65_536)
    expect(result.finishReason).toBe('max_tokens')
    expect(result.usage).toEqual({
      promptTokens: 4461,
      completionTokens: 16384,
      totalTokens: 20845,
    })
  })

  it('Anthropic: base64 dataUrl 图片转成 base64 source', async () => {
    const captured = stubFetch({ content: [{ type: 'text', text: 'ok' }] })
    await generateCanvasText({
      providerType: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-3-5-sonnet',
      prompt: '分析',
      images: [{ dataUrl: PNG_DATA_URL, mimeType: 'image/png' }],
    })
    const messages = captured.lastBody().messages as Array<{ role: string; content: unknown }>
    const blocks = messages[0]!.content as Array<Record<string, unknown>>
    const image = blocks[0] as { type: string; source: Record<string, unknown> }
    expect(image.type).toBe('image')
    expect(image.source.type).toBe('base64')
    expect(image.source.media_type).toBe('image/png')
    expect(typeof image.source.data).toBe('string')
    expect(String(image.source.data).startsWith('data:')).toBe(false)
  })

  it('temperature 透传到请求 body', async () => {
    const captured = stubFetch({ choices: [{ message: { content: 'ok' } }] })
    await generateCanvasText({
      providerType: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-4o',
      prompt: 'hi',
      temperature: 0.2,
    })
    expect(captured.lastBody().temperature).toBe(0.2)
  })

  it('JSON output requests forward response_format to OpenAI-compatible chat providers', async () => {
    const captured = stubFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
    await generateCanvasText({
      providerType: 'openai-compatible',
      apiKey: 'sk-x',
      model: 'deepseek-v4-flash',
      prompt: '只输出 JSON',
      responseFormat: 'json',
    })

    expect(captured.lastBody().response_format).toEqual({ type: 'json_object' })
  })

  it('DeepSeek storyboard tasks can disable default thinking mode to avoid hidden reasoning consuming output tokens', async () => {
    const captured = stubFetch({
      choices: [
        {
          finish_reason: 'length',
          message: { content: '{"shots":[{"index":1}]}', reasoning_content: '思考'.repeat(3000) },
        },
      ],
      usage: { prompt_tokens: 2000, completion_tokens: 30000, total_tokens: 32000 },
    })
    const result = await generateCanvasText({
      providerType: 'openai-compatible',
      apiEndpoint: 'https://api.deepseek.com',
      apiKey: 'sk-x',
      model: 'deepseek-v4-flash',
      prompt: '输出分镜 JSON',
      disableThinking: true,
    })

    expect(captured.lastBody().thinking).toEqual({ type: 'disabled' })
    expect(result.finishReason).toBe('length')
    expect(result.reasoningContentChars).toBe(6000)
  })

  it('GLM JSON tasks can also disable default thinking mode on OpenAI-compatible endpoints', async () => {
    const captured = stubFetch({ choices: [{ message: { content: '{"ok":true}' } }] })
    await generateCanvasText({
      providerType: 'openai-compatible',
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-x',
      model: 'glm-5.2',
      prompt: '只输出 JSON',
      disableThinking: true,
      responseFormat: 'json',
    })

    expect(captured.lastBody().thinking).toEqual({ type: 'disabled' })
    expect(captured.lastBody().response_format).toEqual({ type: 'json_object' })
  })

  it('OpenAI Responses API: 按 provider apiKind 发送到 /responses 并解析 output_text', async () => {
    const captured = stubFetch({ output_text: '剧本正文' })
    const result = await generateCanvasText({
      providerType: 'openai',
      apiKind: 'responses',
      apiKey: 'sk-x',
      apiEndpoint: 'https://api.openai.com/v1',
      model: 'gpt-5-codex',
      system: '你是编剧',
      prompt: '生成剧本',
      maxTokens: 1200,
      temperature: 0.3,
    })
    expect(result.text).toBe('剧本正文')
    expect(captured.lastUrl()).toBe('https://api.openai.com/v1/responses')
    expect(captured.lastBody()).toEqual({
      model: 'gpt-5-codex',
      input: '生成剧本',
      instructions: '你是编剧',
      max_output_tokens: 1200,
      temperature: 0.3,
      stream: false,
    })
    expect(result.requestCall).toMatchObject({
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      headers: { authorization: '[redacted]', 'content-type': 'application/json' },
      body: captured.lastBody(),
      response: { status: 200 },
    })
  })

  it('OpenAI 兼容: 端点末段已是 /vN 时直接补动作后缀，不再追加 /v1', async () => {
    const responses = stubFetch({ output_text: '剧本正文' })
    const responsesResult = await generateCanvasText({
      providerType: 'openai',
      apiKind: 'responses',
      apiKey: 'sk-x',
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5',
      system: '你是编剧',
      prompt: '生成剧本',
      maxTokens: 1200,
    })
    expect(responsesResult.text).toBe('剧本正文')
    expect(responses.lastUrl()).toBe('https://open.bigmodel.cn/api/coding/paas/v4/responses')

    const chat = stubFetch({
      choices: [{ message: { content: '剧本正文' } }],
    })
    const chatResult = await generateCanvasText({
      providerType: 'openai',
      apiKind: 'chat',
      apiKey: 'sk-x',
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: 'glm-5',
      system: '你是编剧',
      prompt: '生成剧本',
      maxTokens: 1200,
    })
    expect(chatResult.text).toBe('剧本正文')
    expect(chat.lastUrl()).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions')
  })

  it('OpenAI Responses API: maps Spark reasoning effort before sending canvas text requests', async () => {
    const captured = stubFetch({ output_text: '剧本正文' })
    await generateCanvasText({
      providerType: 'openai',
      apiKind: 'responses',
      apiKey: 'sk-x',
      model: 'gpt-5-codex',
      prompt: '生成剧本',
      reasoningEffort: 'max',
    })

    expect(captured.lastBody()).toMatchObject({
      reasoning: { effort: 'xhigh' },
      max_output_tokens: 16_384,
    })
  })

  it('provider HTTP 错误会保留响应体和请求摘要，便于任务详情排查', async () => {
    const captured = stubFetch(
      { error: { message: 'Unsupported parameter: max_tokens' } },
      { status: 400 },
    )
    await expect(
      generateCanvasText({
        providerType: 'openai',
        apiKey: 'sk-x',
        apiEndpoint: 'https://api.example.com/v1',
        model: 'gpt-5-codex',
        prompt: '生成剧本',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('provider HTTP 400'),
      statusCode: 400,
      responseBody: expect.stringContaining('Unsupported parameter'),
      requestCall: {
        method: 'POST',
        url: 'https://api.example.com/v1/chat/completions',
        body: captured.lastBody(),
        response: {
          status: 400,
          body: { error: { message: 'Unsupported parameter: max_tokens' } },
        },
      },
    })
  })
})

describe('generateCanvasText prompt caching', () => {
  const CACHE_PARAMS = {
    providerType: 'anthropic',
    apiKey: 'sk-ant',
    model: 'claude-sonnet-5',
    system: 'You are a desktop operator.',
    stablePrompt: 'Objective: Save the document\n\nSuccess criteria: []',
    prompt: 'Step index: 2\n\nAccessibility tree:\nbutton "Save" [1]',
    promptCache: true as const,
    images: [{ dataUrl: PNG_DATA_URL, mimeType: 'image/png' }],
  }

  it('Anthropic: system 与稳定前缀打 cache_control，截图排在稳定前缀之后', async () => {
    const captured = stubFetch({ content: [{ type: 'text', text: 'ok' }] })
    await generateCanvasText({ ...CACHE_PARAMS })
    const body = captured.lastBody()
    const system = body.system as Array<Record<string, unknown>>
    expect(Array.isArray(system)).toBe(true)
    expect(system[0]).toEqual({
      type: 'text',
      text: 'You are a desktop operator.',
      cache_control: { type: 'ephemeral' },
    })
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    const blocks = messages[0]!.content
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'Objective: Save the document\n\nSuccess criteria: []',
      cache_control: { type: 'ephemeral' },
    })
    expect(blocks[1]?.type).toBe('image')
    expect(blocks[2]).toEqual({
      type: 'text',
      text: 'Step index: 2\n\nAccessibility tree:\nbutton "Save" [1]',
    })
  })

  it('Anthropic: 网关拒绝 cache_control 时降级为无缓存标记重发一次', async () => {
    const calls: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, requestInit?: RequestInit) => {
        calls.push(JSON.parse(String(requestInit?.body ?? '{}')) as Record<string, unknown>)
        if (calls.length === 1) {
          return new Response(JSON.stringify({ error: 'cache_control is not supported' }), {
            status: 400,
          })
        }
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        })
      }),
    )
    const result = await generateCanvasText({ ...CACHE_PARAMS })
    expect(result.text).toBe('ok')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.system).toEqual([
      expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
    ])
    expect(calls[1]?.system).toBe('You are a desktop operator.')
    const retryBlocks = (
      calls[1]?.messages as Array<{ content: Array<Record<string, unknown>> }>
    )[0]?.content
    expect(retryBlocks?.[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: expect.any(String) },
    })
    expect(retryBlocks?.[1]).toEqual({
      type: 'text',
      text: 'Step index: 2\n\nAccessibility tree:\nbutton "Save" [1]',
    })
  })

  it('Anthropic: usage 返回缓存命中与写入 token，便于确认缓存生效', async () => {
    stubFetch({
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 2000,
        output_tokens: 64,
        total_tokens: 2064,
        cache_read_input_tokens: 1536,
        cache_creation_input_tokens: 320,
      },
    })
    const result = await generateCanvasText({ ...CACHE_PARAMS })
    expect(result.usage).toEqual({
      promptTokens: 2000,
      completionTokens: 64,
      totalTokens: 2064,
      cachedPromptTokens: 1536,
      cacheWriteTokens: 320,
    })
  })

  it('OpenAI-compatible: 稳定前缀拆分为独立 user 消息并透传 cached_tokens', async () => {
    const captured = stubFetch({
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        total_tokens: 105,
        prompt_tokens_details: { cached_tokens: 64 },
      },
    })
    const result = await generateCanvasText({
      providerType: 'openai',
      apiKey: 'sk-x',
      model: 'vision-model',
      system: 'sys',
      stablePrompt: 'stable objective',
      prompt: 'Step index: 1',
      promptCache: true,
      images: [{ url: 'https://cdn/ref.png' }],
    })
    const messages = captured.lastBody().messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(messages[1]).toEqual({ role: 'user', content: 'stable objective' })
    const variableParts = messages[2]!.content as Array<Record<string, unknown>>
    expect(variableParts[0]).toEqual({ type: 'text', text: 'Step index: 1' })
    expect(variableParts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn/ref.png' },
    })
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 5,
      totalTokens: 105,
      cachedPromptTokens: 64,
    })
  })

  it('OpenAI Responses API: 稳定前缀作为首条输入项', async () => {
    const captured = stubFetch({ output_text: 'ok' })
    await generateCanvasText({
      providerType: 'openai',
      apiKind: 'responses',
      apiKey: 'sk-x',
      model: 'gpt-5.4',
      stablePrompt: 'stable objective',
      prompt: 'Step index: 1',
      promptCache: true,
      images: [{ url: 'https://cdn/ref.png' }],
    })
    const input = captured.lastBody().input as Array<{ role: string; content: unknown }>
    expect(input[0]).toEqual({ role: 'user', content: 'stable objective' })
    const variableParts = input[1]!.content as Array<Record<string, unknown>>
    expect(variableParts[0]).toEqual({ type: 'input_text', text: 'Step index: 1' })
    expect(variableParts[1]).toEqual({ type: 'input_image', image_url: 'https://cdn/ref.png' })
  })

  it('未启用 promptCache 时保持旧行为：system 为字符串且单条 user 消息', async () => {
    const captured = stubFetch({ content: [{ type: 'text', text: 'ok' }] })
    await generateCanvasText({
      providerType: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-5',
      system: 'sys prompt',
      stablePrompt: 'stable objective',
      prompt: 'variable prompt',
      images: [{ url: 'https://cdn/ref.png' }],
    })
    const body = captured.lastBody()
    expect(body.system).toBe('sys prompt')
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages[0]!.content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://cdn/ref.png' },
    })
    expect(messages[0]!.content[1]).toEqual({ type: 'text', text: 'variable prompt' })
  })
})
