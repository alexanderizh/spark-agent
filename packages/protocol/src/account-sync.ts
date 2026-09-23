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
  /** 本次同步请求体字节数（服务端新版本回传；旧版本缺失时由主进程本地测量补齐） */
  payloadBytes?: number
}

/**
 * 同步余量状态。
 *
 * 上限是「单次请求体」级限制，不是累计存储配额；余量按 `上限 − 上次同步数据` 估算。
 * `source` 为 `fallback` 表示服务端不支持或读取失败，此时 `maxPayloadBytes`
 * 为保守默认值，界面应提示「仅供参考」。
 */
export interface AccountSyncStatus {
  maxPayloadBytes: number
  /** 上一次同步的请求体字节数；从未同步为 null */
  lastPayloadBytes: number | null
  lastSyncAt: string | null
  lastStatus: AccountSyncOperationStatus | null
  lastDeviceLabel: string | null
  source: 'server' | 'fallback'
}

/** 本地预估的本次同步请求体大小（只采集、不发送、不落库） */
export interface AccountSyncPayloadEstimate {
  /** 本次请求体字节数 */
  bytes: number
  /** 服务端单次上限字节数 */
  maxBytes: number
  /** 是否已超限（超限时同步会被拒绝，需减少内容） */
  exceeded: boolean
  /** 参与估算的类别 */
  categories: AccountSyncCategory[]
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
  /** 渲染进程从画布热存储读取的最新项目提示词；仅用于本机采集，不会原样透传服务端 */
  promptLibraryItems?: AccountSyncPromptLibraryItemInput[]
}

/** 与 execute 同一份请求形态：预估只做本地采集与字节测量，不发送、不落库 */
export type AccountSyncEstimatePayloadRequest = AccountSyncExecuteRequest

export interface AccountSyncPromptLibraryItemInput {
  id: string
  title: string
  text: string
  category: string
  tags: string[]
  coverUrl: string | null
  coverMimeType: string | null
  createdAt: string
  updatedAt: string
}

export interface AccountSyncPreviewRequest {
  /** 与 execute 一致，保证预览和正式同步使用同一份画布热数据 */
  promptLibraryItems?: AccountSyncPromptLibraryItemInput[]
}

export const ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_ITEMS = 2_000
export const ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_TOTAL_CHARS = 60_000_000

export function countAccountSyncPromptLibraryChars(
  items: readonly AccountSyncPromptLibraryItemInput[],
): number {
  return items.reduce(
    (total, item) =>
      total +
      item.id.length +
      item.title.length +
      item.text.length +
      item.category.length +
      item.tags.reduce((tagTotal, tag) => tagTotal + tag.length, 0) +
      (item.coverUrl?.length ?? 0) +
      (item.coverMimeType?.length ?? 0) +
      item.createdAt.length +
      item.updatedAt.length,
    0,
  )
}

export interface AccountSyncIpcChannelMap {
  'account-sync:get-preferences': [{}, AccountSyncGetPreferencesResponse]
  'account-sync:update-preferences': [
    AccountSyncUpdatePreferencesRequest,
    AccountSyncGetPreferencesResponse,
  ]
  'account-sync:execute': [AccountSyncExecuteRequest, AccountSyncExecuteResponse]
  'account-sync:preview': [AccountSyncPreviewRequest, AccountSyncPreviewResult]
  'account-sync:list-history': [AccountSyncListHistoryRequest, AccountSyncListHistoryResponse]
  'account-sync:get-status': [{}, AccountSyncStatus]
  'account-sync:estimate-payload': [AccountSyncEstimatePayloadRequest, AccountSyncPayloadEstimate]
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

const accountSyncPromptLibraryItemInputSchema = z
  .object({
    id: z.string().min(1).max(256),
    title: z.string().max(2_000),
    text: z.string().max(256_000),
    category: z.string().max(512),
    tags: z.array(z.string().max(512)).max(100),
    coverUrl: z.string().max(12_000_000).nullable(),
    coverMimeType: z.string().max(128).nullable(),
    createdAt: z.string().max(64),
    updatedAt: z.string().max(64),
  })
  .strict()

const accountSyncPromptLibraryItemsSchema = z
  .array(accountSyncPromptLibraryItemInputSchema)
  .max(ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_ITEMS)
  .superRefine((items, context) => {
    if (countAccountSyncPromptLibraryChars(items) > ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_TOTAL_CHARS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '提示词库同步数据超过单次 IPC 总大小上限',
      })
    }
  })

const accountSyncExecuteRequestSchema = z
  .object({
    conflictChoices: z.record(z.string().min(1), z.enum(['local', 'cloud'])).optional(),
    promptLibraryItems: accountSyncPromptLibraryItemsSchema.optional(),
  })
  .strict()

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
  'account-sync:execute': accountSyncExecuteRequestSchema,
  'account-sync:estimate-payload': accountSyncExecuteRequestSchema,
  'account-sync:preview': z
    .object({
      promptLibraryItems: accountSyncPromptLibraryItemsSchema.optional(),
    })
    .strict(),
  'account-sync:list-history': z
    .object({
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  'account-sync:get-status': z.object({}).strict(),
} as const
