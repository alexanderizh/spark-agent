import { z } from 'zod'

const UniqueIdListSchema = z
  .array(z.string().uuid())
  .max(500)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '排序列表不能包含重复项' })
    }
  })

export const SidebarOrderListRequestSchema = z.object({})

export const SidebarOrderUpdateRequestSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('projects'),
    itemIds: UniqueIdListSchema,
  }),
  z.object({
    scope: z.literal('sessions'),
    projectId: z.string().uuid(),
    itemIds: UniqueIdListSchema,
  }),
])

export interface SidebarOrderState {
  projectIds: string[]
  sessionIdsByProject: Record<string, string[]>
}

export type SidebarOrderListRequest = z.infer<typeof SidebarOrderListRequestSchema>
export type SidebarOrderListResponse = SidebarOrderState
export type SidebarOrderUpdateRequest = z.infer<typeof SidebarOrderUpdateRequestSchema>

export interface SidebarOrderUpdateResponse {
  itemIds: string[]
}

export interface SidebarOrderIpcChannelMap {
  'sidebar-order:list': [SidebarOrderListRequest, SidebarOrderListResponse]
  'sidebar-order:update': [SidebarOrderUpdateRequest, SidebarOrderUpdateResponse]
}

export const SidebarOrderIpcSchemaRegistry = {
  'sidebar-order:list': SidebarOrderListRequestSchema,
  'sidebar-order:update': SidebarOrderUpdateRequestSchema,
} as const
