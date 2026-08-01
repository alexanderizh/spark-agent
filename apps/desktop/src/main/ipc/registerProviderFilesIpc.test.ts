import { describe, expect, it } from 'vitest'
import { SparkError } from '@spark/shared'
import {
  resolveProviderFilesApiKind,
  runFilesTask,
  toMinimaxProviderFile,
} from './registerProviderFilesIpc.js'

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

describe('resolveProviderFilesApiKind', () => {
  it('recognizes explicit media providers', () => {
    expect(resolveProviderFilesApiKind({ mediaProvider: 'volcengine-ark' })).toBe('volcengine-ark')
    expect(resolveProviderFilesApiKind({ mediaProvider: 'xai' })).toBe('xai')
    expect(resolveProviderFilesApiKind({ mediaProvider: 'bailian' })).toBe('bailian')
    // minimax-hailuo 走自带 Files client（mm_file:// 上传链路），必须被识别为独立渠道
    expect(resolveProviderFilesApiKind({ mediaProvider: 'minimax-hailuo' })).toBe('minimax-hailuo')
  })

  it('does not infer the channel from the hostname alone (chat and media share the endpoint)', () => {
    // 火山方舟等域名聊天与多媒体共用，仅给 apiEndpoint 不应判定为多媒体渠道，
    // 否则会把「火山 claude」等纯聊天渠道误纳入 Files 下拉。
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      }),
    ).toBeNull()
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      }),
    ).toBeNull()
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
      }),
    ).toBeNull()
    expect(resolveProviderFilesApiKind({ apiEndpoint: 'https://api.example.com/v1' })).toBeNull()
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://api.example.com/proxy?target=ark.cn-beijing.volces.com',
      }),
    ).toBeNull()
  })

  it('maps MiniMax files to active canvas-ready media with MIME inferred from the filename', () => {
    expect(
      toMinimaxProviderFile({
        fileId: '398574688191234048',
        filename: 'reference.MP4',
        bytes: 1024,
        purpose: 'video_generation_input',
      }),
    ).toMatchObject({
      id: '398574688191234048',
      providerKind: 'minimax-hailuo',
      status: 'active',
      mimeType: 'video/mp4',
    })
  })
})

describe('runFilesTask', () => {
  it('透传任务的成功结果', async () => {
    const result = await runFilesTask(async () => 'ok')
    expect(result).toBe('ok')
  })

  it('把 MediaProviderError(401) 映射为 PROVIDER_AUTH_FAILED 并透传错误摘要', async () => {
    await expect(
      runFilesTask(async () => {
        throw makeMediaError(401, 'API Key 无效')
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      message: expect.stringContaining('API Key 无效'),
    })
  })

  it('把 MediaProviderError(429) 映射为 PROVIDER_RATE_LIMITED 并附 HTTP 码', async () => {
    await expect(
      runFilesTask(async () => {
        throw makeMediaError(429, '请求过频')
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      message: expect.stringContaining('HTTP 429'),
    })
  })

  it('把 MediaProviderError(402) 映射为 PROVIDER_QUOTA_EXCEEDED', async () => {
    await expect(
      runFilesTask(async () => {
        throw makeMediaError(402, '配额超限')
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_QUOTA_EXCEEDED',
    })
  })

  it('其他状态码映射为 PROVIDER_UNAVAILABLE 并附 HTTP 码', async () => {
    await expect(
      runFilesTask(async () => {
        throw makeMediaError(503, '服务暂不可用')
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('HTTP 503'),
    })
  })

  it('把无 HTTP 状态码的 invalid_input 映射为 VALIDATION_FAILED', async () => {
    await expect(
      runFilesTask(async () => {
        throw makeMediaError(undefined, '本地文件与 URL 必须且只能填写一项', 'invalid_input')
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })

  it('把无 HTTP 状态码的 api_key_missing 映射为 PROVIDER_AUTH_FAILED', async () => {
    await expect(
      runFilesTask(async () => {
        throw makeMediaError(undefined, 'Missing API key', 'api_key_missing')
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
    })
  })

  it('非 MediaProviderError 原样抛出（不二次包装）', async () => {
    const plain = new Error('boom')
    await expect(runFilesTask(async () => Promise.reject(plain))).rejects.toBe(plain)
    const sparkErr = new SparkError('NOT_FOUND', 'Provider 不存在')
    await expect(runFilesTask(async () => Promise.reject(sparkErr))).rejects.toBe(sparkErr)
  })
})
