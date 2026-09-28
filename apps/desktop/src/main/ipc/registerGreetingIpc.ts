/**
 * 空会话 Hero 问候语 IPC（channel: greeting:get）。
 *
 * 主进程侧只做「依赖装配 + 三级模型档位解析」，生成逻辑（缓存窗口、prompt、
 * 清洗、失败降级）全部在 @spark/agent-runtime 的 GreetingService 里，便于单测。
 *
 * 三级模型档位（由 GreetingService 内部按序消费）：
 *   1. 记忆抽取小模型  settings memory.extractionProviderId + extractionModel
 *   2. 默认对话模型    默认渠道的 defaultModel（复用 ProviderService.listProviders 的筛选）
 *   3. 当前会话模型    sessions.model_id（配合 sessions.provider_profile_id）
 * 全部落空或调用失败 → 返回 ok:false，渲染端回退到写死的「{时段}好，继续推进」。
 */

import {
  GreetingService,
  ModelService,
  ProviderService,
  type GreetingCompletion,
  type GreetingModelRef,
} from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import {
  ModelProfileRepository,
  ProviderProfileRepository,
  SessionRepository,
  SettingsRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { typedIpcHandle } from './typed-ipc.js'
import { getDatabase } from '../db.js'

const log = createLogger('greeting-ipc')

/**
 * 默认对话模型 = 默认渠道的 defaultModel。
 *
 * 复用 ProviderService.listProviders()：它已剔除禁用渠道、剔除峰谷定时禁用的模型、
 * 并对本地 CLI 渠道做可用性判断，自己再筛一遍容易与设置页展示不一致。
 * 没有显式默认渠道时，退而取第一个「有 defaultModel 且不是多媒体/生图模型」的渠道。
 */
async function resolveDefaultChatModel(db: SparkDatabase): Promise<GreetingModelRef | null> {
  try {
    const profiles = await new ProviderService(new ProviderProfileRepository(db)).listProviders()
    const eligible = profiles.filter(
      (profile) =>
        profile.defaultModel.trim().length > 0 &&
        (profile.modelType == null || profile.modelType === 'text'),
    )
    const picked = eligible.find((profile) => profile.isDefault === true) ?? eligible[0]
    if (picked == null) return null
    return { providerId: picked.id, model: picked.defaultModel.trim(), source: 'default-chat' }
  } catch (err) {
    log.warn(`解析默认对话模型失败：${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** 当前会话模型 = 会话上显式指定的 provider_profile_id + model_id。 */
function resolveSessionChatModel(
  db: SparkDatabase,
  sessionId: string | undefined,
): GreetingModelRef | null {
  if (sessionId == null || sessionId.length === 0) return null
  try {
    const row = new SessionRepository(db).get(sessionId)
    if (row == null) return null
    const providerId = row.provider_profile_id?.trim() ?? ''
    const model = row.model_id?.trim() ?? ''
    if (providerId.length === 0 || model.length === 0) return null
    return { providerId, model, source: 'session' }
  } catch (err) {
    log.warn(
      `读取会话模型失败（sessionId=${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/** 注册空会话问候语 IPC。 */
export function registerGreetingIpc(): void {
  typedIpcHandle('greeting:get', async (request) => {
    try {
      const db = getDatabase()
      const settingsRepo = new SettingsRepository(db)
      const settingsGet = (category: string, key: string) => settingsRepo.get(category, key)
      // 协议分派（anthropic /v1/messages ↔ OpenAI 兼容 /chat/completions）由
      // ModelService.complete 内部完成，这里只提供渠道与模型。
      const modelService = new ModelService(
        new ModelProfileRepository(db),
        new ProviderProfileRepository(db),
        settingsGet,
      )
      const complete: GreetingCompletion = (prompt, opts) => modelService.complete(prompt, opts)
      const service = new GreetingService({
        complete,
        settingsGet,
        settingsSet: (category, key, value) => settingsRepo.set(category, key, value),
        getDefaultChatModel: () => resolveDefaultChatModel(db),
        getSessionChatModel: (sessionId) => resolveSessionChatModel(db, sessionId),
      })
      return await service.getGreeting(request)
    } catch (err) {
      // 兜底再兜底：IPC 层自身异常也不能让渲染端拿到 rejected promise。
      const reason = err instanceof Error ? err.message : String(err)
      log.warn(`greeting:get 意外失败（渲染端回退写死文案）：${reason}`)
      return { ok: false, reason }
    }
  })
}
