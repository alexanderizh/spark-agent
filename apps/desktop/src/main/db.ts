/**
 * 主进程数据库初始化入口
 *
 * 职责：
 *   - 提供开发/生产环境共享的数据库文件路径
 *   - 导出单例数据库实例引用
 *
 * 数据库文件路径策略（ADR-002）：
 *   - 开发和生产环境：{app.getPath('userData')}/spark.db
 *   - WAL 模式 + NORMAL 同步 + 外键约束
 *
 * 注意：实际的 createDatabase() 调用在 main/index.ts 的 initializeApp() 中完成
 */

import { app } from 'electron'
import { join } from 'path'
import type { SparkDatabase } from '@spark/storage'

/**
 * 获取数据库文件路径
 *
 * 开发和生产使用同一个数据库文件，便于两个模式共享业务数据。
 */
export function getDatabasePath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'spark.db')
}

/** 全局数据库实例引用（由 initializeApp() 初始化） */
let dbInstance: SparkDatabase | null = null

/**
 * 设置全局数据库实例
 *
 * 仅在 main/index.ts 的 initializeApp() 中调用一次
 */
export function setDatabaseInstance(db: SparkDatabase): void {
  dbInstance = db
}

/**
 * 获取全局数据库实例
 *
 * @throws 如果数据库尚未初始化
 */
export function getDatabase(): SparkDatabase {
  if (dbInstance == null) {
    throw new Error('Database not initialized. Call initializeApp() first.')
  }
  return dbInstance
}

/**
 * 关闭数据库连接
 *
 * 在 app 'before-quit' 事件中调用
 */
export function closeDatabase(): void {
  if (dbInstance != null) {
    dbInstance.close()
    dbInstance = null
  }
}
