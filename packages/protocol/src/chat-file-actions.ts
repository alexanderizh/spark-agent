import { z } from 'zod'

export const ChatFileActionRequestSchema = z.object({
  filePath: z.string().min(1).max(32768),
  action: z.enum(['copy-content', 'save-as', 'open-terminal', 'open-with']),
})

export type ChatFileActionRequest = z.infer<typeof ChatFileActionRequestSchema>

export interface ChatFileActionIpcChannelMap {
  'file:chat-action': [
    ChatFileActionRequest,
    { status: 'done' } | { status: 'canceled' } | { status: 'error'; error: string },
  ]
}

export const ChatFileActionIpcSchemaRegistry = {
  'file:chat-action': ChatFileActionRequestSchema,
}
