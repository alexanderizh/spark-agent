/**
 * 主进程数据库初始化入口
 *
 * P0-06 完成后，这里会调用 @spark/storage 的 initDatabase()
 *
 * 数据库文件路径策略（ADR-002）：
 *   - 生产环境：{app.getPath('userData')}/spark.db
 *   - 开发环境：{app.getPath('userData')}/spark-dev.db
 *   - WAL 模式 + NORMAL 同步 + 外键约束
 */

import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * 获取数据库文件路径
 *
 * 开发和生产使用不同的数据库文件，避免开发数据污染生产数据
 */
export function getDatabasePath(): string {
  const userDataPath = app.getPath('userData')
  const filename = is.dev ? 'spark-dev.db' : 'spark.db'
  return join(userDataPath, filename)
}

/**
 * 初始化数据库
 *
 * 启动时调用：
 *   1. 打开/创建 SQLite 数据库
 *   2. 启用 WAL 模式和性能优化 pragma
 *   3. 运行待执行的 migration
 *   4. 返回数据库实例
 */
export async function initDatabase(): Promise<void> {
  const dbPath = getDatabasePath()
  console.log(`[Spark Agent] Initializing database at: ${dbPath}`)

  // TODO: P0-06 — 调用 @spark/storage 的 initDatabase
  // const { createDatabase } = await import('@spark/storage')
  // const db = createDatabase(dbPath)
  // console.log('[Spark Agent] Database initialized, migrations applied')
  // return db
}
