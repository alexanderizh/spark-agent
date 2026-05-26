/**
 * Spark Agent 全局常量
 */

/** 应用标识 */
export const APP_ID = 'spark-agent'
export const APP_NAME = 'Spark Agent'
export const APP_VERSION = '0.1.0'

/** Keychain 服务名（与 keystore 模块保持一致） */
export const KEYCHAIN_SERVICE = 'spark-agent'

/** SQLite 数据库文件名 */
export const DB_FILENAME_PROD = 'spark.db'
export const DB_FILENAME_DEV = 'spark-dev.db'

/** Agent 事件相关 */
export const MAX_EVENTS_PER_SESSION = 10_000
export const EVENT_STREAM_BATCH_SIZE = 50

/** IPC Channel 命名空间前缀 */
export const IPC_NS = {
  SESSION: 'session',
  PROVIDER: 'provider',
  WORKSPACE: 'workspace',
  KEYSTORE: 'keystore',
  SETTINGS: 'settings',
  USAGE: 'usage',
} as const

/** Workspace 相关 */
export const SPARK_DIR = '.spark'
export const AGENT_SPARK_DIR = '.agent_spark'
