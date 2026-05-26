import { AnthropicAdapter } from '../adapters/anthropic.js'
import { DeepSeekAdapter } from '../adapters/deepseek.js'
import { OpenAIAdapter } from '../adapters/openai.js'
import type { IModelAdapter } from '../adapters/types.js'

export function createAdapter(provider: string, _apiEndpoint?: string): IModelAdapter {
  switch (provider) {
    case 'anthropic':
      return new AnthropicAdapter()
    case 'openai':
      return new OpenAIAdapter()
    case 'deepseek':
      return new DeepSeekAdapter()
    case 'ollama':
    case 'openai-compatible':
      return new OpenAIAdapter()
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
