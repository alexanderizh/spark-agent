import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 标题生成器单测 —— 锁定生产实测暴露的静默失败点的修复行为：
 *   ① OpenAI 兼容路径 max_tokens 对 gpt-5 系与 o 系（要求 max_completion_tokens）的
 *      400 降级重试；其余 400 不重试。
 *   ② 中转渠道风控拒绝非流式请求（"请设置 stream: true"）时降级为 SSE 流式请求，
 *      拼接 delta.content 增量正文（2026-11-12 api3.codexcn.com 实测，自动精炼与
 *      手动「提取标题」同时被拦死）。
 *   ③ 响应 content 为 null/空（reasoning 耗尽 token 预算）时返回 null 且打 warn，
 *      不再把失败吞成完全无日志。
 *   ④ SSE 单个事件带 `message.content`（网关「伪流式」形态）时与 `delta.content`
 *      同口径采集，否则取空后标题精炼失败。
 */

const fetchJsonMock = vi.hoisted(() => vi.fn())
const fetchTextMock = vi.hoisted(() => vi.fn())
const warnMock = vi.hoisted(() => vi.fn())

vi.mock('@spark/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spark/shared')>()
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: warnMock }),
    fetchJson: fetchJsonMock,
    fetchText: fetchTextMock,
  }
})

const { generateSessionTitle } = await import('../../services/session-title-generator.js')
const { HttpError } = await import('@spark/shared')

const BASE_PARAMS = {
  providerType: 'openai',
  apiKey: 'sk-test',
  apiEndpoint: 'https://gw.example.com/v1',
  model: 'gpt-5.6-luna',
  userMessage: '帮我把官网首页的大屏布局优化一下',
  assistantMessage: '',
}

function okCompletion(text: string): { choices: Array<{ message: { content: string } }> } {
  return { choices: [{ message: { content: text } }] }
}

function httpError(statusCode: number, message: string): Error {
  return new HttpError(String(statusCode), message, statusCode)
}

beforeEach(() => {
  fetchJsonMock.mockReset()
  fetchTextMock.mockReset()
  warnMock.mockClear()
})

describe('generateSessionTitle（OpenAI 兼容路径）', () => {
  it('正常返回：剥掉“标题：”前缀并截断', async () => {
    fetchJsonMock.mockResolvedValueOnce(okCompletion('标题：官网首页布局优化\n\n解释行'))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('官网首页布局优化')
    const body = JSON.parse(String(fetchJsonMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(body.max_tokens).toBe(4096)
  })

  it('max_tokens 400 且服务端提示 max_completion_tokens 时换参重发成功', async () => {
    fetchJsonMock
      .mockRejectedValueOnce(
        httpError(
          400,
          'Unsupported parameter: max_tokens is not supported with this model. Use max_completion_tokens',
        ),
      )
      .mockResolvedValueOnce(okCompletion('官网大屏布局优化'))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('官网大屏布局优化')
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse(String(fetchJsonMock.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(retryBody.max_completion_tokens).toBe(4096)
    expect(retryBody.max_tokens).toBeUndefined()
  })

  it('其余 400 不触发降级重试', async () => {
    fetchJsonMock.mockRejectedValue(httpError(400, 'invalid model id'))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBeNull()
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(warnMock).toHaveBeenCalled()
  })

  it('content 为 null（reasoning 耗尽预算）返回 null 且打 warn', async () => {
    fetchJsonMock.mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })

  it('userMessage 为空直接返回 null（不发请求）', async () => {
    const title = await generateSessionTitle({ ...BASE_PARAMS, userMessage: '   ' })
    expect(title).toBeNull()
    expect(fetchJsonMock).not.toHaveBeenCalled()
  })
})

/** 按 OpenAI 兼容 SSE 形态拼流式响应体：角色首包 + 正文增量包 + usage-only 尾包 + [DONE]。 */
function sseBody(contentChunks: string[]): string {
  const roleChunk = JSON.stringify({
    id: 'chatcmpl-title',
    object: 'chat.completion.chunk',
    model: 'gpt-5.6-luna',
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  })
  const usageChunk = JSON.stringify({
    id: 'chatcmpl-title',
    object: 'chat.completion.chunk',
    model: 'gpt-5.6-luna',
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
  })
  const events = [roleChunk, ...contentChunks, usageChunk].map((chunk) => `data: ${chunk}\n\n`)
  return `${events.join('')}data: [DONE]\n\n`
}

function contentChunk(text: string): string {
  return JSON.stringify({
    id: 'chatcmpl-title',
    object: 'chat.completion.chunk',
    model: 'gpt-5.6-luna',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })
}

/** 生产实测原文（2026-11-12，api3.codexcn.com）。 */
const STREAM_REQUIRED_400 =
  'HTTP 400: {"error":{"message":"出于OpenAI风控，非流式请求不再被支持，请设置 stream: true","type":"invalid_request_error","param":"","code":"invalid_request"}}'

describe('generateSessionTitle（OpenAI 兼容路径 · 非流式被渠道风控拒绝）', () => {
  it('400 提示 stream:true 时降级为 SSE 请求并拼接增量正文', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock.mockResolvedValueOnce(
      sseBody([contentChunk('官网'), contentChunk('首页'), contentChunk('布局优化')]),
    )
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('官网首页布局优化')
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(fetchTextMock).toHaveBeenCalledTimes(1)

    const streamCall = fetchTextMock.mock.calls[0]
    const streamBody = JSON.parse(String(streamCall?.[1]?.body)) as Record<string, unknown>
    expect(streamBody.stream).toBe(true)
    expect(streamBody.max_tokens).toBe(4096)
    expect(streamCall?.[1]?.headers?.accept).toBe('text/event-stream')
    expect(streamCall?.[0]).toBe('https://gw.example.com/v1/chat/completions')
  })

  it('流式请求仍被要求 max_completion_tokens 时沿该维度再降一级', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock
      .mockRejectedValueOnce(
        httpError(400, 'Unsupported parameter: max_tokens. Use max_completion_tokens'),
      )
      .mockResolvedValueOnce(sseBody([contentChunk('官网大屏布局优化')]))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('官网大屏布局优化')
    expect(fetchTextMock).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse(String(fetchTextMock.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(retryBody.max_completion_tokens).toBe(4096)
    expect(retryBody.max_tokens).toBeUndefined()
    expect(retryBody.stream).toBe(true)
  })

  it('网关忽略 stream 标志仍回完整 JSON 时按 JSON 解析', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock.mockResolvedValueOnce(JSON.stringify(okCompletion('官网首页布局优化')))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('官网首页布局优化')
  })

  it('单个事件带 message.content 的伪流式响应也能取到正文', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock.mockResolvedValueOnce(
      sseBody([
        JSON.stringify({
          choices: [{ index: 0, message: { content: '伪流式网关标题' }, finish_reason: 'stop' }],
        }),
      ]),
    )
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('伪流式网关标题')
  })

  it('逆序降级：先被要求 max_completion_tokens，再被要求流式', async () => {
    fetchJsonMock
      .mockRejectedValueOnce(httpError(400, 'Unsupported parameter: max_tokens. Use max_completion_tokens'))
      .mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock.mockResolvedValueOnce(sseBody([contentChunk('逆序降级标题')]))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBe('逆序降级标题')
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
    expect(fetchTextMock).toHaveBeenCalledTimes(1)

    const finalBody = JSON.parse(String(fetchTextMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >
    expect(finalBody.max_completion_tokens).toBe(4096)
    expect(finalBody.max_tokens).toBeUndefined()
    expect(finalBody.stream).toBe(true)
  })

  it('阶梯上限：连续三次 400 后放弃，不再发起第四次请求', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock
      .mockRejectedValueOnce(
        httpError(400, 'Unsupported parameter: max_tokens. Use max_completion_tokens'),
      )
      .mockRejectedValueOnce(
        httpError(400, 'Unsupported parameter: max_tokens. Use max_completion_tokens'),
      )
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBeNull()
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(fetchTextMock).toHaveBeenCalledTimes(2)
    const message = String(warnMock.mock.calls.at(-1)?.[0] ?? '')
    expect(message).toContain('OpenAI-compatible title request failed')
    expect(message).toContain('HTTP 400')
    expect(message).toContain('max_completion_tokens')
  })

  it('SSE 正文为空（思考耗尽预算）返回 null 且打 warn', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock.mockResolvedValueOnce(
      sseBody([JSON.stringify({
        choices: [{ index: 0, delta: { reasoning_content: '想很久但没有正文' }, finish_reason: null }],
      })]),
    )
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBeNull()
    expect(warnMock).toHaveBeenCalled()
    const message = String(warnMock.mock.calls.at(-1)?.[0] ?? '')
    expect(message).toContain('Streamed title response had no usable content')
  })

  it('流式请求自身失败时不无限重试，终态 warn 保留 HTTP 状态与响应体摘要', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, STREAM_REQUIRED_400))
    fetchTextMock.mockRejectedValueOnce(httpError(429, 'HTTP 429: {"error":{"message":"rate limited"}}'))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBeNull()
    expect(fetchTextMock).toHaveBeenCalledTimes(1)
    const message = String(warnMock.mock.calls.at(-1)?.[0] ?? '')
    expect(message).toContain('OpenAI-compatible title request failed')
    expect(message).toContain('HTTP 429')
    expect(message).toContain('rate limited')
  })

  it('未提示流式的 400 不触发 SSE 降级（不浪费一次请求）', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(400, 'HTTP 400: {"error":{"message":"invalid model id"}}'))
    const title = await generateSessionTitle(BASE_PARAMS)
    expect(title).toBeNull()
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(fetchTextMock).not.toHaveBeenCalled()
  })
})

describe('generateSessionTitle（Anthropic 路径）', () => {
  it('正常返回首个 text block', async () => {
    fetchJsonMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '标题：目标模式排障' }],
    })
    const title = await generateSessionTitle({
      ...BASE_PARAMS,
      providerType: 'anthropic',
      model: 'claude-sonnet-5',
    })
    expect(title).toBe('目标模式排障')
  })

  it('第三方端点同时投放 x-api-key 与 Bearer（阶跃类渠道只认后者）', async () => {
    fetchJsonMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '目标模式排障' }] })
    await generateSessionTitle({
      ...BASE_PARAMS,
      providerType: 'anthropic',
      apiKey: 'ep-stepfun',
      apiEndpoint: 'https://api.stepfun.com/step_plan',
    })
    const headers = fetchJsonMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('ep-stepfun')
    expect(headers['authorization']).toBe('Bearer ep-stepfun')
  })

  it('渠道填完整 messages 地址时不重复 /v1/messages 后缀', async () => {
    fetchJsonMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '端点归一化' }] })
    await generateSessionTitle({
      ...BASE_PARAMS,
      providerType: 'anthropic',
      apiKey: 'ep-stepfun',
      apiEndpoint: 'https://api.stepfun.com/step_plan/v1/messages',
    })
    expect(fetchJsonMock.mock.calls[0]?.[0]).toBe('https://api.stepfun.com/step_plan/v1/messages')
  })

  it('官方端点保持单头 x-api-key', async () => {
    fetchJsonMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '官方端点标题' }] })
    await generateSessionTitle({
      ...BASE_PARAMS,
      providerType: 'anthropic',
      apiKey: 'sk-ant-api03-official',
      apiEndpoint: 'https://api.anthropic.com',
    })
    const headers = fetchJsonMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-api03-official')
    expect(headers['authorization']).toBeUndefined()
  })

  it('HTTP 失败打 warn（生产日志可见）', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(401, 'invalid api key'))
    const title = await generateSessionTitle({ ...BASE_PARAMS, providerType: 'anthropic' })
    expect(title).toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })

  it('HTTP 失败 warn 携带响应体摘要（400 具体原因可查）', async () => {
    fetchJsonMock.mockRejectedValueOnce(
      httpError(400, 'HTTP 400: {"error":{"message":"max_tokens is too large: 4096"}}'),
    )
    await generateSessionTitle({ ...BASE_PARAMS, providerType: 'anthropic' })
    expect(warnMock).toHaveBeenCalled()
    const message = String(warnMock.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('HTTP 400')
    expect(message).toContain('max_tokens is too large')
  })

  it('content 无 text block（思考耗尽预算）返回 null 且打 warn，与 OpenAI 路径对称', async () => {
    // 思考型模型思考 token 计入输出预算：预算被耗尽时 content 里只有 thinking block。
    fetchJsonMock.mockResolvedValueOnce({ content: [{ type: 'thinking', thinking: '...' }] })
    const title = await generateSessionTitle({ ...BASE_PARAMS, providerType: 'anthropic' })
    expect(title).toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })

  it('content 为空数组同样返回 null 且打 warn', async () => {
    fetchJsonMock.mockResolvedValueOnce({ content: [] })
    const title = await generateSessionTitle({ ...BASE_PARAMS, providerType: 'anthropic' })
    expect(title).toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })
})
