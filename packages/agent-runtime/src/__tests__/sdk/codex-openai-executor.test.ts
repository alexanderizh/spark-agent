import { describe, expect, it } from 'vitest'
import { CodexOpenAIExecutor } from '../../sdk/codex-openai-executor.js'
import { CodexSdkExecutor } from '../../sdk/codex-sdk-executor.js'

describe('CodexOpenAIExecutor', () => {
  it('is a backward-compatible Codex SDK executor alias', () => {
    expect(new CodexOpenAIExecutor()).toBeInstanceOf(CodexSdkExecutor)
  })
})
