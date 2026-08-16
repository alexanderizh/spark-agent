import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 标题生成器单测 —— 锁定生产实测暴露的两个静默失败点的修复行为：
 *   ① OpenAI 兼容路径 max_tokens 对 gpt-5 系与 o 系（要求 max_completion_tokens）的
 *      400 降级重试；其余 400 不重试。
 *   ② 响应 content 为 null/空（reasoning 耗尽 token 预算）时返回 null 且打 warn，
 *      不再把失败吞成完全无日志。
 */

const fetchJsonMock = vi.hoisted(() => vi.fn())
const warnMock = vi.hoisted(() => vi.fn())

vi.mock('@spark/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spark/shared')>()
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: warnMock }),
    fetchJson: fetchJsonMock,
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
    expect(body.max_tokens).toBe(512)
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
    expect(retryBody.max_completion_tokens).toBe(512)
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

  it('HTTP 失败打 warn（生产日志可见）', async () => {
    fetchJsonMock.mockRejectedValueOnce(httpError(401, 'invalid api key'))
    const title = await generateSessionTitle({ ...BASE_PARAMS, providerType: 'anthropic' })
    expect(title).toBeNull()
    expect(warnMock).toHaveBeenCalled()
  })
})
