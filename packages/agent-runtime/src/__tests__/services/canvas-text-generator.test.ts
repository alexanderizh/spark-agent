import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateCanvasText } from '../../services/canvas-text-generator.js'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** 抓取最后一次请求 body 的 mock fetch。 */
function stubFetch(responseBody: unknown): { lastBody: () => Record<string, unknown> } {
  const state: { body: Record<string, unknown> } = { body: {} }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      state.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify(responseBody), { status: 200 })
    }),
  )
  return { lastBody: () => state.body }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateCanvasText multimodal', () => {
  it('OpenAI-compatible: 纯文本时 user content 仍是字符串', async () => {
    const captured = stubFetch({ choices: [{ message: { content: '一段风格描述' } }] })
    const result = await generateCanvasText({
      providerType: 'openai',
      apiKey: 'sk-x',
      model: 'gpt-4o',
      prompt: '分析风格',
    })
    expect(result.text).toBe('一段风格描述')
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
    expect(blocks[0]).toEqual({ type: 'image', source: { type: 'url', url: 'https://cdn/ref.png' } })
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
})
