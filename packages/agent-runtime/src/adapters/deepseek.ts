import type { AgentEvent } from '@spark/protocol'

import { streamOpenAICompatible } from './openai.js'
import type { ChatParams, IModelAdapter } from './types.js'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

export class DeepSeekAdapter implements IModelAdapter {
  readonly provider = 'deepseek'

  async *streamChat(
    params: ChatParams,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    yield* streamOpenAICompatible(params, sessionId, turnId, signal, {
      provider: this.provider,
      defaultBaseURL: DEEPSEEK_BASE_URL,
      mapReasoningContent: true,
    })
  }
}
