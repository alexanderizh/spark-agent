import type { ProviderProfile } from '@spark/protocol'
import { AUTO_ROUTER_PROVIDER_TYPE } from '@spark/protocol'

/**
 * 定时任务表单的模型候选（Phase 4 入口闭环）。
 *
 * 两类候选项共用同一 value 空间：
 * - AutoRouter 元渠道：value = router 的 provider id。主进程 resolveScheduledTaskRuntime
 *   优先按 router id 命中并把 modelId 置空，执行模型由分流器逐轮决定。
 * - 普通渠道的模型 id：主进程按 modelId 反查拥有该模型的渠道。
 *
 * 语义说明：AutoRouter 没有固定模型清单，选项文案带「智能路由」后缀，避免与普通模型名混淆。
 */
export function buildScheduledTaskModelOptions(
  providers: readonly ProviderProfile[],
): Array<{ label: string; value: string }> {
  const options: Array<{ label: string; value: string }> = []
  for (const provider of providers) {
    if (provider.providerType === AUTO_ROUTER_PROVIDER_TYPE) {
      options.push({ label: `${provider.name}（智能路由）`, value: provider.id })
    }
  }
  const modelSet = new Set<string>()
  for (const provider of providers) {
    if (provider.providerType === AUTO_ROUTER_PROVIDER_TYPE) continue
    if (provider.defaultModel) modelSet.add(provider.defaultModel)
    for (const model of provider.modelIds) modelSet.add(model)
  }
  options.push(...Array.from(modelSet).map((model) => ({ label: model, value: model })))
  return options
}
