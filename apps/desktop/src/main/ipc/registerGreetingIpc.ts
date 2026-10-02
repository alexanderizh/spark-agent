/**
 * 空会话 Hero 问候语 IPC（channel: greeting:get）。
 *
 * 主进程侧只做「依赖装配 + 模型档位解析」，生成逻辑（缓存窗口、prompt、
 * 清洗、逐档降级）全部在 @spark/agent-runtime 的 GreetingService 里，便于单测。
 *
 * 模型档位（由 GreetingService 按序逐个尝试）：
 *   1. 当前会话模型    sessions.model_id（配合 sessions.provider_profile_id）
 *   2. 记忆抽取小模型  settings memory.extractionProviderId + extractionModel
 *   3. 默认对话模型    默认渠道的 defaultModel（其后是其它可用对话渠道）
 * 全部落空或全部调用失败 → 返回 ok:false，渲染端回退到写死的「{时段}好，继续推进」。
 */

import {
  GreetingService,
  ModelService,
  ProviderService,
  type GreetingCompletion,
  type GreetingModelRef,
} from '@spark/agent-runtime'
import {
  canProviderHoldChatDefault,
  isBuiltInLocalCliProvider,
  type ProviderProfile,
} from '@spark/protocol'
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
 * 能否用这个渠道发一次 HTTP 文本补全。
 *
 * ⚠️ 这里有过一个真实线上事故：最初的筛选条件写成 `modelType === 'text'`，
 * 结果把本项目标记为 `'multimodal'` 的**真实对话渠道全部排除**（本项目里
 * 'multimodal' 就是「文本 + 视觉」对话模型的正常标记），反而选中了
 * 「本地 Claude CLI」这条伪渠道 —— 它按设计**没有 apiEndpoint、keystore_ref 也为空**
 * （见 packages/protocol/src/local-cli-provider.ts），于是请求落到默认端点
 * https://api.anthropic.com/v1/messages 且不带任何鉴权，稳定返回
 * 403 forbidden「Request not allowed」，问候语因此从未成功过一次。
 *
 * 所以判据是「能不能真的发出去」，而不是「名字看着像不像文本模型」。
 */
function canServeTextCompletion(profile: ProviderProfile): boolean {
  // 本地 CLI 伪渠道只服务于 claude / codex 适配器进程，不能直接发 HTTP 补全。
  if (isBuiltInLocalCliProvider(profile)) return false
  // image / video / voice 做不了文本补全；'text' 与 'multimodal' 都可以。向量渠道
  // 在本项目没有独立的 modelType 档位（线上「glm向量模型」的 modelType 就是 multimodal），
  // 唯一可靠判据是协议格式 codexApiKind === 'embedding'——它只会走 /embeddings 端点，
  // 做不了 /chat/completions 文本补全。复用 canProviderHoldChatDefault（auto-router
  // 执行器资格、默认渠道资格同款口径），不按模型名猜「含 embed」。
  if (!canProviderHoldChatDefault(profile)) return false
  if (profile.defaultModel.trim().length === 0) return false
  // 必须有可用的调用目标：自定义端点，或至少已有凭据（官方 Anthropic 无端点但有 Key）。
  const hasEndpoint = (profile.apiEndpoint?.trim().length ?? 0) > 0
  const hasCredential = profile.keystoreRef.trim().length > 0
  return hasEndpoint || hasCredential
}

/**
 * 默认对话模型的候选列表，默认渠道排在最前，其后是其它可用的对话渠道
 * （用于「默认渠道拒绝这类请求时还能试下一个」）。
 *
 * 复用 ProviderService.listProviders()：它已剔除禁用渠道、剔除峰谷定时禁用的模型、
 * 并对本地 CLI 渠道做可用性判断，自己再筛一遍容易与设置页展示不一致。
 */
async function resolveDefaultChatModels(db: SparkDatabase): Promise<GreetingModelRef[]> {
  try {
    const profiles = await new ProviderService(new ProviderProfileRepository(db)).listProviders()
    const eligible = profiles.filter(canServeTextCompletion)
    const ordered = [
      ...eligible.filter((profile) => profile.isDefault === true),
      ...eligible.filter((profile) => profile.isDefault !== true),
    ]
    return ordered.map((profile) => ({
      providerId: profile.id,
      model: profile.defaultModel.trim(),
      source: 'default-chat' as const,
    }))
  } catch (err) {
    log.warn(`解析默认对话模型失败：${err instanceof Error ? err.message : String(err)}`)
    return []
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
        getDefaultChatModels: () => resolveDefaultChatModels(db),
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
