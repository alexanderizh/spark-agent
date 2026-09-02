/**
 * @module registerDataIpc
 *
 * dev 实例继承安装版数据库的 IPC 通道：
 *   - data:get-inherit-info       —— 查询可用性与安装版库信息
 *   - data:inherit-production-db  —— 生成快照 + 注册 relaunch + 请求退出（重启生效）
 */

import { createLogger } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'
import {
  describeProductionDbInheritance,
  relaunchForInheritedDb,
  stageProductionDbInheritance,
} from '../services/ProductionDbInheritService.js'

const log = createLogger('data-inherit')

export function registerDataIpc(): void {
  typedIpcHandle('data:get-inherit-info', async () => {
    return describeProductionDbInheritance()
  })

  typedIpcHandle('data:inherit-production-db', async () => {
    log.info('data:inherit-production-db requested')
    const { incomingBytes } = await stageProductionDbInheritance()
    // 快照已暂存：注册 relaunch 并走完整 before-quit 关闭链退出；
    // 替换数据库文件发生在下次启动、建库之前（applyPendingProductionDbInheritance）
    relaunchForInheritedDb()
    return { restarting: true, incomingBytes }
  })
}
