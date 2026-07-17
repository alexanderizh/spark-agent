import { z } from 'zod'

export const ProviderFilesApiKindSchema = z.enum(['xai', 'volcengine-ark', 'bailian'])
export type ProviderFilesApiKind = z.infer<typeof ProviderFilesApiKindSchema>

export const BailianFilePurposeSchema = z.enum(['fine-tune', 'file-extract', 'batch'])
export type BailianFilePurpose = z.infer<typeof BailianFilePurposeSchema>

export const VolcengineFileStatusSchema = z.enum(['processing', 'active', 'failed'])
export type VolcengineFileStatus = z.infer<typeof VolcengineFileStatusSchema>

export interface ProviderFileObject {
  id: string
  filename: string
  bytes: number
  createdAt: number
  expiresAt?: number
  purpose: string
  object: 'file'
  providerKind?: ProviderFilesApiKind
  mimeType?: string
  status?: VolcengineFileStatus
  error?: { code?: string; message?: string }
  scope?: { type?: string; id?: string }
  tos?: { bucket?: string; objectKey?: string }
  preprocessConfigs?: Record<string, unknown> | null
}

export interface ProviderFilesListRequest {
  providerProfileId: string
  paginationToken?: string
  after?: string
  purpose?: 'user_data' | BailianFilePurpose
  scopeId?: string
  order?: 'asc' | 'desc'
  sortBy?: 'created_at' | 'filename' | 'size'
  limit?: number
}

export interface ProviderFilesListResponse {
  providerKind: ProviderFilesApiKind
  files: ProviderFileObject[]
  paginationToken?: string
  firstId?: string
  lastId?: string
  hasMore?: boolean
}

export interface ProviderFilesGetRequest {
  providerProfileId: string
  fileId: string
}

export interface ProviderFilesGetResponse {
  providerKind: ProviderFilesApiKind
  file: ProviderFileObject
}

export interface VolcengineVideoPreprocessInput {
  fps?: number
  model?: string
  maxVideoTokens?: number
  minFrameTokens?: number
  maxFrameTokens?: number
  minFrames?: number
}

export interface ProviderFilesUploadRequest {
  providerProfileId: string
  filePath?: string
  url?: string
  purpose?: 'user_data' | BailianFilePurpose
  description?: string
  expireAt?: number
  tos?: { bucket: string; prefix: string }
  preprocessVideo?: VolcengineVideoPreprocessInput
  waitUntilActive?: boolean
}

export interface ProviderFilesUploadResponse {
  providerKind: ProviderFilesApiKind
  file: ProviderFileObject
}

export interface ProviderFilesDeleteRequest {
  providerProfileId: string
  fileId: string
}

export interface ProviderFilesDeleteResponse {
  deleted: boolean
  id: string
}

const ProviderProfileIdSchema = z.string().min(1).max(200)
const ProviderFileIdSchema = z.string().min(1).max(500)

const VolcengineVideoPreprocessInputSchema = z
  .object({
    fps: z.number().min(0.2).max(5).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    maxVideoTokens: z.number().int().min(10_240).max(204_800).optional(),
    minFrameTokens: z.number().int().min(16).max(128).optional(),
    maxFrameTokens: z.number().int().min(128).max(640).optional(),
    minFrames: z.number().int().min(5).max(16).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.minFrameTokens !== undefined &&
      value.maxFrameTokens !== undefined &&
      value.minFrameTokens > value.maxFrameTokens
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minFrameTokens cannot exceed maxFrameTokens',
        path: ['minFrameTokens'],
      })
    }
  })

export const ProviderFilesIpcSchemaRegistry = {
  'provider:files:list': z.object({
    providerProfileId: ProviderProfileIdSchema,
    paginationToken: z.string().min(1).max(2_000).optional(),
    after: ProviderFileIdSchema.optional(),
    purpose: z.union([z.literal('user_data'), BailianFilePurposeSchema]).optional(),
    scopeId: z.string().min(1).max(500).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    sortBy: z.enum(['created_at', 'filename', 'size']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  'provider:files:get': z.object({
    providerProfileId: ProviderProfileIdSchema,
    fileId: ProviderFileIdSchema,
  }),
  'provider:files:upload': z
    .object({
      providerProfileId: ProviderProfileIdSchema,
      filePath: z.string().trim().min(1).max(10_000).optional(),
      url: z
        .string()
        .trim()
        .min(1)
        .max(10_000)
        .regex(/^(?:https?:\/\/|tos:\/\/)/i, 'url must use http://, https://, or tos://')
        .optional(),
      purpose: z.union([z.literal('user_data'), BailianFilePurposeSchema]).optional(),
      description: z.string().trim().max(2_000).optional(),
      expireAt: z.number().int().positive().optional(),
      tos: z
        .object({
          bucket: z.string().trim().min(1).max(256),
          prefix: z.string().trim().min(1).max(1_024),
        })
        .optional(),
      preprocessVideo: VolcengineVideoPreprocessInputSchema.optional(),
      waitUntilActive: z.boolean().optional(),
    })
    .superRefine((value, ctx) => {
      if (Boolean(value.filePath) === Boolean(value.url)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'exactly one of filePath or url is required',
          path: ['filePath'],
        })
      }
    }),
  'provider:files:delete': z.object({
    providerProfileId: ProviderProfileIdSchema,
    fileId: ProviderFileIdSchema,
  }),
} as const

export interface ProviderFilesIpcChannelMap {
  'provider:files:list': [ProviderFilesListRequest, ProviderFilesListResponse]
  'provider:files:get': [ProviderFilesGetRequest, ProviderFilesGetResponse]
  'provider:files:upload': [ProviderFilesUploadRequest, ProviderFilesUploadResponse]
  'provider:files:delete': [ProviderFilesDeleteRequest, ProviderFilesDeleteResponse]
}
