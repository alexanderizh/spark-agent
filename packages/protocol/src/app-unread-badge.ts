import { z } from 'zod'

export interface AppSetUnreadCountRequest {
  count: number
}

export interface AppSetUnreadCountResponse {
  count: number
}

export interface AppUnreadBadgeIpcChannelMap {
  'app:set-unread-count': [AppSetUnreadCountRequest, AppSetUnreadCountResponse]
}

export const AppUnreadBadgeIpcSchemaRegistry = {
  'app:set-unread-count': z.object({
    count: z.number().int().min(0).max(9_999),
  }),
} as const

