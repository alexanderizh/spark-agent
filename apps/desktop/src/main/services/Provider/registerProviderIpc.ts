/**
 * registerProviderIpc — 注册 provider:* 子集中需要在 main/ipc/index.ts 之外
 * 维护的 IPC handlers。
 *
 * 设计原因：main/ipc/index.ts 是一个 ~6700 行的「巨石」文件，多个 feature 分支
 * 会同时向其中插入代码；为了避免和别人的修改在同区域冲突，把稳定、低频新增
 * 的 handler（典型如 reveal-key 这类编辑辅助通道）独立到本文件。
 *
 * 主入口在 registerAllIpcHandlers() 末尾通过 registerProviderIpc() 拉起，
 * 因此下游只要在 ipc/index.ts 末尾增加 1 行调用即可启用本文件所有 handler。
 */

import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { createLogger } from '@spark/shared'
import { ProviderService } from '@spark/agent-runtime'
import { ProviderProfileRepository } from '@spark/storage'
import { getDatabase } from '../../db.js'

const log = createLogger('provider.ipc')

/**
 * 构造 ProviderService —— 与 main/ipc/index.ts 中的 getProviderService() 同构。
 *
 * 不能直接从 ipc/index.ts 复用那个 helper：本文件被 ipc/index.ts import，反向引用会
 * 形成循环依赖；而 @spark/agent-runtime 也只导出 ProviderService 类、不导出工厂。
 * 这里按需 new 一个无状态实例（与 ipc/index.ts 一致，每次调用都重建）。
 */
function getProviderService(): ProviderService {
  return new ProviderService(new ProviderProfileRepository(getDatabase()))
}

export function registerProviderIpc(): void {
  // `provider:reveal-key` — 编辑 Provider 时回显 Keychain 中保存的明文 API Key。
  // 详见 ProviderRevealKeyRequest/Response；只返回 id 指定的那一个 profile 的明文。
  typedIpcHandle('provider:reveal-key', async (req) => {
    const apiKey = await getProviderService().revealApiKey(req.id)
    log.info(`provider:reveal-key requested, id=${req.id}, present=${apiKey.length > 0}`)
    return { apiKey }
  })
}
