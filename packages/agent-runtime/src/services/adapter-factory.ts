import { AnthropicAdapter } from '../adapters/anthropic.js'
import { OpenAIAdapter } from '../adapters/openai.js'
import type { IModelAdapter } from '../adapters/types.js'

export function createAdapter(provider: string): IModelAdapter {
  switch (normalizeProviderType(provider)) {
    case 'anthropic':
      return new AnthropicAdapter()
    case 'openai':
      return new OpenAIAdapter()
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

function normalizeProviderType(provider: string): 'anthropic' | 'openai' {
  return provider === 'anthropic' ? 'anthropic' : 'openai'
}
