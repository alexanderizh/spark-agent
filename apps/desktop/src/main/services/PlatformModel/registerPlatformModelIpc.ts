import { SparkError } from '@spark/shared'
import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { getPlatformModelService } from './PlatformModelService.js'

/**
 * platform-model 服务层抛的是面向用户的业务 Error（如「Spark 平台暂未开放可用模型」），
 * 但 typed-ipc 公共错误处理只识别 SparkError，普通 Error 会被掩码成
 * 「操作未完成，请稍后重试或查看详情」固定文案，真实原因只进主进程日志，
 * 渲染层 toast 无从知晓。统一捕获转 SparkError 透传真实消息
 * （对齐 registerTeamRegistryIpc.runTeamRegistryTask / registerProviderVoiceIpc.runVoiceTask 的做法）。
 */
async function runPlatformModelTask<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (err) {
    if (err instanceof SparkError) throw err
    throw new SparkError('UNKNOWN', err instanceof Error ? err.message : String(err))
  }
}

export function registerPlatformModelIpc(): void {
  typedIpcHandle('platform-model:get-status', async () =>
    runPlatformModelTask(async () => getPlatformModelService().getStatus()),
  )
  typedIpcHandle('platform-model:bootstrap', async () =>
    runPlatformModelTask(async () => getPlatformModelService().bootstrap(false)),
  )
  typedIpcHandle('platform-model:continue-on-this-device', async () =>
    runPlatformModelTask(async () => getPlatformModelService().bootstrap(true)),
  )
  typedIpcHandle('platform-model:get-plans', async () =>
    runPlatformModelTask(async () => ({ plans: await getPlatformModelService().getPlans() })),
  )
  typedIpcHandle('platform-model:get-subscription', async () =>
    runPlatformModelTask(async () => ({
      subscription: await getPlatformModelService().getSubscription(),
    })),
  )
  typedIpcHandle('platform-model:get-purchase-links', async () =>
    runPlatformModelTask(async () => ({
      links: await getPlatformModelService().getPurchaseLinks(),
    })),
  )
  typedIpcHandle('platform-model:open-purchase-link', async (req) =>
    runPlatformModelTask(async () => getPlatformModelService().openPurchaseLink(req.id)),
  )
  typedIpcHandle('platform-model:redeem', async (req) =>
    runPlatformModelTask(async () => getPlatformModelService().redeem(req.code)),
  )
  typedIpcHandle('platform-model:pay', async (req) =>
    runPlatformModelTask(async () => getPlatformModelService().pay(req.planId, req.paymentMethod)),
  )
  typedIpcHandle('platform-model:get-usage', async () =>
    runPlatformModelTask(async () => getPlatformModelService().getUsage()),
  )
  typedIpcHandle('platform-model:refresh-catalog', async (req) =>
    runPlatformModelTask(async () =>
      getPlatformModelService().refreshModelCatalog(req.force === true),
    ),
  )
  typedIpcHandle('platform-model:update-model-preferences', async (req) =>
    runPlatformModelTask(async () => getPlatformModelService().updateModelPreferences(req)),
  )
}
