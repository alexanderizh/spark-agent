import { describe, expect, it } from 'vitest'
import { SparkError } from '@spark/shared'
import { runVoiceTask } from './registerProviderVoiceIpc.js'

/** 构造一个满足 isMediaProviderError（按 name 收窄）判定的模拟渠道错误。
 *  vitest SSR 解析 @spark/agent-runtime 时 MediaProviderError 不可构造（生产正常），故按 name 模拟。 */
function makeMediaError(
  statusCode: number | undefined,
  message: string,
  code = 'provider_http_error',
): Error {
  const error = new Error(message)
  error.name = 'MediaProviderError'
  return Object.assign(error, { code, statusCode })
}

const LABEL = 'provider:media:clone-voice id=test'

describe('runVoiceTask', () => {
  it('passes the result through on success', async () => {
    await expect(runVoiceTask(LABEL, async () => ({ ok: 1 }))).resolves.toEqual({ ok: 1 })
  })

  it('透传 MediaProviderError 的厂商原文并附 HTTP 状态码', async () => {
    // 这是本模块存在的理由：typed-ipc 只识别 SparkError，MediaProviderError 会被
    // 掩码成「操作未完成，请稍后重试」固定文案，厂商原因（1210 参数错误）无从排查。
    const error = await runVoiceTask(LABEL, async () => {
      throw makeMediaError(400, '音色复刻失败：HTTP 400 · 1210 参数错误')
    }).catch((err: unknown) => err as SparkError)

    expect(error).toBeInstanceOf(SparkError)
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    // 状态码已在 message 里，不重复追加。
    expect(error.message).toBe('音色复刻失败：HTTP 400 · 1210 参数错误')
  })

  it('消息里没带状态码时才补上 HTTP 后缀', async () => {
    const error = await runVoiceTask(LABEL, async () => {
      throw makeMediaError(500, '音色目录同步失败')
    }).catch((err: unknown) => err as SparkError)

    expect(error.message).toBe('音色目录同步失败（HTTP 500）')
  })

  it('按 HTTP 状态码归类：401/403 鉴权、429 限流、402 配额', async () => {
    const codeOf = async (statusCode: number): Promise<string> =>
      runVoiceTask(LABEL, async () => {
        throw makeMediaError(statusCode, 'boom')
      }).catch((err: unknown) => (err as SparkError).code)

    expect(await codeOf(401)).toBe('PROVIDER_AUTH_FAILED')
    expect(await codeOf(403)).toBe('PROVIDER_AUTH_FAILED')
    expect(await codeOf(429)).toBe('PROVIDER_RATE_LIMITED')
    expect(await codeOf(402)).toBe('PROVIDER_QUOTA_EXCEEDED')
  })

  it('按错误码归类：invalid_input / api_key_missing', async () => {
    const codeOf = async (code: string): Promise<string> =>
      runVoiceTask(LABEL, async () => {
        throw makeMediaError(undefined, 'boom', code)
      }).catch((err: unknown) => (err as SparkError).code)

    expect(await codeOf('invalid_input')).toBe('VALIDATION_FAILED')
    expect(await codeOf('api_key_missing')).toBe('PROVIDER_AUTH_FAILED')
    expect(await codeOf('auth_required')).toBe('PROVIDER_AUTH_FAILED')
  })

  it('透传服务层的业务 Error 消息（渠道不支持 / 未配 Key / 完整 URL 模式）', async () => {
    // resolveVoiceChannel 等前置校验抛的是面向用户的普通 Error，
    // 不经这里透传同样会被掩码成通用文案。
    const error = await runVoiceTask(LABEL, async () => {
      throw new Error('未配置 API Key，无法音色目录同步')
    }).catch((err: unknown) => err as SparkError)

    expect(error).toBeInstanceOf(SparkError)
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('未配置 API Key，无法音色目录同步')
  })

  it('不二次包装 SparkError，保留原始错误码', async () => {
    const error = await runVoiceTask(LABEL, async () => {
      throw new SparkError('NOT_FOUND', 'Provider 不存在或已删除')
    }).catch((err: unknown) => err as SparkError)

    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toBe('Provider 不存在或已删除')
  })

  it('非 Error 抛出物退回固定文案，不把内部值透给渲染层', async () => {
    const error = await runVoiceTask(LABEL, async () => {
      throw { weird: true }
    }).catch((err: unknown) => err as SparkError)

    expect(error).toBeInstanceOf(SparkError)
    expect(error.message).toBe('音色操作未完成，请稍后重试或查看日志。')
  })
})
