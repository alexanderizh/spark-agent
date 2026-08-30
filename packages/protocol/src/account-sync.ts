import { z } from 'zod'

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
export type AccountSyncAckStatus = 'pending' | 'success' | 'partial' | 'failed'
export type AccountSyncConflictSide = 'local' | 'cloud'
export type AccountSyncExecuteMode = 'preview' | 'apply'

export type AccountSyncCategorySelection = Record<AccountSyncCategory, boolean>

export interface AccountSyncPreferences {
  enabled: boolean
  categories: AccountSyncCategorySelection
  lastOperation?: {
    operationId: string
    status: AccountSyncOperationStatus
    finishedAt: string
  }
}

export interface AccountSyncItem {
  id: string
  updatedAt: string
  deleted: boolean
  value?: Record<string, unknown>
}

export interface AccountSyncCategoryRequest {
  category: AccountSyncCategory
  schemaVersion: number
  baseRevision: number
  baseHashes: Record<string, string>
  records: AccountSyncItem[]
}

export interface AccountSyncExecuteRequestBody {
  operationId: string
  device: {
    id: string
    label: string
  }
  categories: AccountSyncCategoryRequest[]
  /** 执行模式：apply 为默认真实执行；preview 只计算冲突明细，服务端不落库 */
  mode?: AccountSyncExecuteMode
  /**
   * 冲突手动决胜选择，键格式为 `category/itemId`。
   * 服务端仅对实际存在的冲突条目生效，引用不一致会拒绝执行。
   */
  conflictChoices?: Record<string, AccountSyncConflictSide>
}

export interface AccountSyncSkippedItem {
  id: string
  reasonCode: string
}

export interface AccountSyncCategoryResult {
  category: AccountSyncCategory
  schemaVersion: number
  revision: number
  records: AccountSyncItem[]
  hashes: Record<string, string>
  stats: {
    uploaded: number
    downloaded: number
    conflicts: number
    skipped: number
  }
  skippedItems: AccountSyncSkippedItem[]
  errorCode?: string
}

export interface AccountSyncExecuteResult {
  operationId: string
  status: AccountSyncOperationStatus
  categories: AccountSyncCategoryResult[]
  stats: {
    uploaded: number
    downloaded: number
    conflicts: number
    skipped: number
  }
  errorCodes: string[]
  replayed?: boolean
}

export interface AccountSyncHistoryItem {
  operationId: string
  deviceLabel: string
  status: AccountSyncOperationStatus
  categories: AccountSyncCategory[]
  stats: AccountSyncExecuteResult['stats']
  errorCodes: string[]
  ackStatus: AccountSyncAckStatus
  ackErrorCodes: string[]
  durationMs: number
  createdAt: string
  finishedAt: string | null
}

export interface AccountSyncGetPreferencesResponse {
  authenticated: boolean
  preferences: AccountSyncPreferences
}

export interface AccountSyncUpdatePreferencesRequest {
  enabled?: boolean
  categories?: Partial<AccountSyncCategorySelection>
}

export interface AccountSyncExecuteResponse {
  result: AccountSyncExecuteResult
  appliedAppearance?: Record<string, unknown>
}

export interface AccountSyncConflictSideInfo {
  updatedAt: string
  deleted: boolean
  /** 名称摘要，用于冲突列表展示 */
  summary: string
  /** 关键内容预览（截断），用于辅助判断保留哪一侧 */
  preview: string
}

export interface AccountSyncConflictDetail {
  id: string
  local: AccountSyncConflictSideInfo | null
  cloud: AccountSyncConflictSideInfo | null
}

export interface AccountSyncPreviewResult {
  mode: 'preview'
  operationId: string
  status: AccountSyncOperationStatus
  categories: Array<{
    category: AccountSyncCategory
    conflictCount: number
    errorCode?: string
  }>
  conflicts: Array<{
    category: AccountSyncCategory
    items: AccountSyncConflictDetail[]
  }>
  totalConflicts: number
}

export interface AccountSyncListHistoryRequest {
  page?: number
  pageSize?: number
}

export interface AccountSyncListHistoryResponse {
  list: AccountSyncHistoryItem[]
  total: number
  page: number
  pageSize: number
}

export interface AccountSyncExecuteRequest {
  /** 冲突手动决胜选择，键格式为 `category/itemId`，仅对本次预览展示过的冲突条目生效 */
  conflictChoices?: Record<string, AccountSyncConflictSide>
}

export interface AccountSyncIpcChannelMap {
  'account-sync:get-preferences': [{}, AccountSyncGetPreferencesResponse]
  'account-sync:update-preferences': [
    AccountSyncUpdatePreferencesRequest,
    AccountSyncGetPreferencesResponse,
  ]
  'account-sync:execute': [AccountSyncExecuteRequest, AccountSyncExecuteResponse]
  'account-sync:preview': [{}, AccountSyncPreviewResult]
  'account-sync:list-history': [AccountSyncListHistoryRequest, AccountSyncListHistoryResponse]
}

const categorySelectionShape = {
  customCommands: z.boolean().optional(),
  prompts: z.boolean().optional(),
  memory: z.boolean().optional(),
  assistants: z.boolean().optional(),
  workflows: z.boolean().optional(),
  appearance: z.boolean().optional(),
  promptLibrary: z.boolean().optional(),
}

export const AccountSyncIpcSchemaRegistry = {
  'account-sync:get-preferences': z.object({}).strict(),
  'account-sync:update-preferences': z
    .object({
      enabled: z.boolean().optional(),
      categories: z.object(categorySelectionShape).strict().optional(),
    })
    .strict()
    .refine(
      (value) => value.enabled !== undefined || value.categories !== undefined,
      '至少更新一个同步偏好字段',
    ),
  'account-sync:execute': z
    .object({
      conflictChoices: z.record(z.string().min(1), z.enum(['local', 'cloud'])).optional(),
    })
    .strict(),
  'account-sync:preview': z.object({}).strict(),
  'account-sync:list-history': z
    .object({
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
} as const
