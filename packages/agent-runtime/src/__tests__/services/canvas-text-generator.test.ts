import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateCanvasText } from '../../services/canvas-text-generator.js'

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
  vi.unstubAllGlobals()
})

describe('generateCanvasText multimodal', () => {
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
    const messages = captured.lastBody().messages as Array<{ role: string; content: unknown }>
    const blocks = messages[0]!.content as Array<Record<string, unknown>>
    expect(blocks[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://cdn/ref.png' },
    })
    expect(blocks[1]).toEqual({ type: 'text', text: '分析风格' })
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
      choices: [{
        finish_reason: 'length',
        message: { content: '{"shots":[{"index":1}]}', reasoning_content: '思考'.repeat(3000) },
      }],
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
    expect(result.requestCall).toEqual({
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      body: captured.lastBody(),
    })
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
      },
    })
  })
})
