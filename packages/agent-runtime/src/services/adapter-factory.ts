import { AnthropicAdapter } from '../adapters/anthropic.js'
import { OpenAIAdapter } from '../adapters/openai.js'
import type { IModelAdapter } from '../adapters/types.js'

export function createAdapter(provider: string): IModelAdapter {
  switch (normalizeAdapterType(provider)) {
    case 'anthropic':
      return new AnthropicAdapter()
    case 'openai':
      return new OpenAIAdapter()
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

function normalizeAdapterType(provider: string): 'anthropic' | 'openai' {
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic'
  return 'openai'
}
