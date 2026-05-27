import type { AgentEvent } from '@spark/protocol'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
export type ImageSource =
  | { kind: 'base64'; mediaType: ImageMediaType; data: string }
  | { kind: 'url'; url: string }

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'image'; source: ImageSource }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ChatContentBlock[]
}

export interface ChatParams {
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  apiEndpoint?: string
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}

export interface IModelAdapter {
  readonly provider: string

  streamChat(
    params: ChatParams,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent>
}
