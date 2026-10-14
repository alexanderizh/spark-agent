/**
 * 与 edu-server / 桌面端共享的协议类型（最小子集）。
 *
 * 这些接口镜像 packages/protocol/src/account-sync.ts 与 auth 相关定义，
 * 移动端不引入 @spark/protocol（会把 zod 等拖进小程序包体），
 * 只保留本端用到的字段；字段名与服务端响应严格一致。
 */

// ─── 账号同步（packages/protocol/src/account-sync.ts） ────────────────────────

export const ACCOUNT_SYNC_CATEGORIES = [
  'customCommands',
  'prompts',
  'memory',
  'assistants',
  'workflows',
  'appearance',
  'promptLibrary',
] as const

export type AccountSyncCategory = (typeof ACCOUNT_SYNC_CATEGORIES)[number]
export type AccountSyncOperationStatus = 'success' | 'partial' | 'failed'

/** 同步类别中文名（界面展示用，与桌面端设置页措辞保持一致） */
export const ACCOUNT_SYNC_CATEGORY_LABELS: Record<AccountSyncCategory, string> = {
  customCommands: '自定义命令',
  prompts: '提示词',
  memory: '长期记忆',
  assistants: '助手',
  workflows: '工作流',
  appearance: '外观主题',
  promptLibrary: '提示词库',
}

export interface AccountSyncStatus {
  /** 单次同步请求体上限（字节） */
  maxPayloadBytes: number
  /** 上一次同步的请求体字节数；从未同步为 null */
  lastPayloadBytes: number | null
  lastSyncAt: string | null
  lastStatus: AccountSyncOperationStatus | null
  lastDeviceLabel: string | null
  /** server = 服务端实测；fallback = 服务端不支持，值为保守默认 */
  source: 'server' | 'fallback'
}

export interface AccountSyncHistoryStats {
  uploaded: number
  downloaded: number
  conflicts: number
  skipped: number
}

export interface AccountSyncHistoryItem {
  operationId: string
  deviceLabel: string
  status: AccountSyncOperationStatus
  categories: AccountSyncCategory[]
  stats: AccountSyncHistoryStats
  errorCodes: string[]
  durationMs: number
  createdAt: string
  finishedAt: string | null
}

// ─── 认证 / 用户（packages/protocol/src/ipc/index.ts + edu-server 响应） ──────

export interface AuthSession {
  token: string
  refreshToken: string
  userId: string
}

export type AuthLoginMode = 'password' | 'code' | 'sms'

export interface AuthUserInfo {
  id: number
  account: string
  nickname: string | null
  avatarUrl: string | null
  role: string
  createdAt: string
  lastLoginAt: string | null
  tier: {
    key: string
    name: string
    isPaid: boolean
  }
}

export interface AuthCaptcha {
  id: string
  /** data:image/svg+xml;base64,... */
  svg: string
}

// ─── edu-server 统一响应包装 ──────────────────────────────────────────────────

export interface EduApiResult<T> {
  code: number
  message?: string
  data?: T
}
