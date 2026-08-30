/**
 * AuthService 内部类型
 */

/** edu-server 统一响应格式 */
export interface EduApiResult<T = unknown> {
  code: number
  message?: string
  data?: T
}

/** 当前 base URL 来源 */
export type BaseUrlSource = 'default' | 'env' | 'user'

/** 401 自动 refresh 时持有的原请求参数 */
export interface PendingRequest {
  path: string
  init: RequestInit
}

/** AuthService 启动配置 */
export interface AuthServiceConfig {
  /** 默认 base URL（环境变量未设置 + 用户未设置时使用）*/
  defaultBaseUrl: string
  /** keytar service 名称（用于区分多个 Spark Agent 安装）*/
  keytarService: string
  /** 网络请求超时（毫秒）*/
  requestTimeoutMs?: number
}

/** AuthService 状态快照 */
export interface AuthSnapshot {
  isAuthenticated: boolean
  userId?: string
  baseUrl: string
}
