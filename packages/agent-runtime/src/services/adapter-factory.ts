import { AnthropicAdapter } from '../adapters/anthropic.js'
import { OpenAIAdapter } from '../adapters/openai.js'
import { CodexAdapter } from '../adapters/codex.js'
import type { IModelAdapter } from '../adapters/types.js'

export type AdapterApiKind = 'chat' | 'responses'

/**
 * Build the adapter instance for the given session.
 *
 * - 'claude' / 'anthropic' → AnthropicAdapter
 * - everything else → OpenAIAdapter (chat.completions) by default,
 *   or CodexAdapter (Responses API) when apiKind === 'responses'.
 *
 * Responses API is only meaningful against the real OpenAI endpoint and for
 * codex-tuned models (gpt-5-codex etc.); other compatible backends (DeepSeek,
 * Ollama, 智谱…) should keep the default 'chat'.
 */
export function createAdapter(provider: string, apiKind: AdapterApiKind = 'chat'): IModelAdapter {
  switch (normalizeAdapterType(provider)) {
    case 'anthropic':
      return new AnthropicAdapter()
    case 'openai':
      return apiKind === 'responses' ? new CodexAdapter() : new OpenAIAdapter()
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

function normalizeAdapterType(provider: string): 'anthropic' | 'openai' {
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic'
  return 'openai'
}
