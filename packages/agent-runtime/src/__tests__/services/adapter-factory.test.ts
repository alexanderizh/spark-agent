import { describe, expect, it } from 'vitest'
import { AnthropicAdapter, OpenAIAdapter } from '../../index.js'
import { createAdapter } from '../../services/adapter-factory.js'

describe('createAdapter', () => {
  it('creates anthropic adapter for anthropic format', () => {
    expect(createAdapter('anthropic')).toBeInstanceOf(AnthropicAdapter)
  })

  it('creates openai adapter for openai format', () => {
    expect(createAdapter('openai')).toBeInstanceOf(OpenAIAdapter)
  })

  it('maps legacy openai-compatible providers onto the openai adapter', () => {
    expect(createAdapter('deepseek')).toBeInstanceOf(OpenAIAdapter)
    expect(createAdapter('ollama')).toBeInstanceOf(OpenAIAdapter)
    expect(createAdapter('openai-compatible')).toBeInstanceOf(OpenAIAdapter)
  })
})
