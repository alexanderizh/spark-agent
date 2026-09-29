/**
 * 渠道音色 IPC：音色目录同步、音色复刻、删除复刻音色。
 *
 * 从 ipc/index.ts 抽出（该文件超 3000 行红线，不再内联加码），与
 * registerProviderFilesIpc / registerVideoChannelTaskIpc 同属 Provider 多媒体通道族。
 *
 * 服务层抛的两类错误都会在 IPC 边界丢掉真实原因：
 *   - 面向用户的业务 Error，如「未配置 API Key，无法音色目录同步」；
 *   - 音色接口 client 抛的 MediaProviderError（携带真实 HTTP 状态码与厂商错误摘要）。
 * typed-ipc 的公共错误处理只识别 SparkError，两者都会被掩码成
 * 「操作未完成，请稍后重试或查看详情」固定文案，真实原因只进主进程日志。
 * 统一经 {@link runVoiceTask} 转 SparkError 透传
 * （对齐 registerProviderFilesIpc.runFilesTask / registerTeamRegistryIpc）。
 */
import { type MediaProviderError, type ProviderService } from '@spark/agent-runtime'
import { type ErrorCode, createLogger, SparkError } from '@spark/shared'

import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('provider-voice-ipc')

/**
 * MediaProviderError 跨打包/模块实例时 instanceof 不可靠
 * （vitest 与源码解析到的模块实例可能不同），用 name 收窄更稳健。
 */
function isMediaProviderError(error: unknown): error is MediaProviderError {
  return error instanceof Error && error.name === 'MediaProviderError'
}

function resolveVoiceErrorCode(error: MediaProviderError): ErrorCode {
  if (error.code === 'invalid_input') return 'VALIDATION_FAILED'
  if (error.code === 'api_key_missing' || error.code === 'auth_required') {
    return 'PROVIDER_AUTH_FAILED'
  }
  if (error.statusCode === 401 || error.statusCode === 403) return 'PROVIDER_AUTH_FAILED'
  if (error.statusCode === 429) return 'PROVIDER_RATE_LIMITED'
  if (error.statusCode === 402) return 'PROVIDER_QUOTA_EXCEEDED'
  return 'PROVIDER_UNAVAILABLE'
}

/**
 * 把音色通道的错误转成 SparkError，保住可读原因。
 *
 * 转换三分支：
 *   - MediaProviderError → 按 HTTP 状态/错误码归到具体 SparkError 码；
 *   - SparkError → 原样抛出，不二次包装；
 *   - 其他 Error → 服务层这些消息（渠道不支持、未配 Key、完整 URL 模式）
 *     本就是写给用户看的，直接用其 message。
 *
 * 非 Error 的抛出物（极少见）不带 message，退回固定文案避免把 `[object Object]`
 * 之类的内部值透给渲染层。
 *
 * @param label 日志前缀（通道名 + providerId），失败原因同时落主进程日志。
 */
export async function runVoiceTask<T>(label: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    log.warn(`${label} failed, error=${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof SparkError) throw error
    if (isMediaProviderError(error)) {
      // 状态码只补一次：音色 client 已经把 HTTP 码写进 message，
      // 无脑追加会得到「HTTP 400 · 1210 参数错误（HTTP 400）」。
      const suffix =
        error.statusCode != null && !error.message.includes(`HTTP ${error.statusCode}`)
          ? `（HTTP ${error.statusCode}）`
          : ''
      throw new SparkError(resolveVoiceErrorCode(error), `${error.message}${suffix}`)
    }
    if (error instanceof Error && error.message) {
      throw new SparkError('UNKNOWN', error.message)
    }
    throw new SparkError('UNKNOWN', '音色操作未完成，请稍后重试或查看日志。')
  }
}

export function registerProviderVoiceIpc(deps: {
  getProviderService: () => ProviderService
}): void {
  // 音色目录同步：拉取厂商音色清单并写入 profile 的动态参数候选，
  // 画布 / 快速创作等端随后通过共享 manifest 解析自动继承。
  typedIpcHandle('provider:media:sync-voices', async (req) =>
    runVoiceTask(`provider:media:sync-voices id=${req.providerId}`, async () => {
      log.info(`provider:media:sync-voices requested, id=${req.providerId}`)
      const result = await deps.getProviderService().syncMediaVoiceCatalog(req.providerId)
      log.info(
        `provider:media:sync-voices completed, id=${req.providerId}, ` +
          `total=${result.options.length}, official=${result.officialCount}, ` +
          `private=${result.privateCount}`,
      )
      return result
    }),
  )

  // 音色复刻闭环：上传示例音频 → 复刻 → 自动刷新候选；
  // 删除复刻音色同理。两者都返回刷新后的候选快照，UI 无需再拉一次列表。
  typedIpcHandle('provider:media:clone-voice', async (req) =>
    runVoiceTask(`provider:media:clone-voice id=${req.providerId}`, async () => {
      log.info(
        `provider:media:clone-voice requested, id=${req.providerId}, name=${req.voiceName}, ` +
          `sample=${req.samplePath}`,
      )
      const result = await deps.getProviderService().cloneMediaVoice(req)
      log.info(
        `provider:media:clone-voice completed, id=${req.providerId}, voice=${result.voice}, ` +
          `total=${result.options.length}, private=${result.privateCount}`,
      )
      return result
    }),
  )

  typedIpcHandle('provider:media:delete-voice', async (req) =>
    runVoiceTask(`provider:media:delete-voice id=${req.providerId}`, async () => {
      log.info(`provider:media:delete-voice requested, id=${req.providerId}, voice=${req.voice}`)
      const result = await deps.getProviderService().deleteMediaVoice(req)
      log.info(
        `provider:media:delete-voice completed, id=${req.providerId}, voice=${result.voice}, ` +
          `total=${result.options.length}, private=${result.privateCount}`,
      )
      return result
    }),
  )
}
