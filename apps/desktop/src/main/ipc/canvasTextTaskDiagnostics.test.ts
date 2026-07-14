import { describe, expect, it } from 'vitest'
import {
  buildCanvasTextRawResponse,
  resolveCanvasTextMaxTokens,
  resolveCanvasTextTokenBudget,
  GENERAL_CONTEXT_DERIVED_MAX_TOKENS_CAP,
  STORYBOARD_CONTEXT_DERIVED_MAX_TOKENS_CAP,
  STORYBOARD_CONTEXT_DERIVED_MIN_MAX_TOKENS,
} from './canvasTextTaskDiagnostics.js'

describe('canvasTextTaskDiagnostics', () => {
  it('uses model capability max output for known long-context storyboard models', () => {
    expect(
      resolveCanvasTextTokenBudget({
        model: 'deepseek-v4-flash',
        taskPipelineRole: 'shot',
        prompt: '短场次剧本',
      }),
    ).toMatchObject({
      maxTokens: 384_000,
      source: 'model_capability',
      modelContextWindow: 1_000_000,
      modelMaxOutputTokens: 384_000,
    })
  })

  it('derives a larger storyboard budget from provider context when model capability is unknown', () => {
    const budget = resolveCanvasTextTokenBudget({
      providerSupportsMillionContext: true,
      model: 'custom-storyboard-model',
      taskPipelineRole: 'shot',
      prompt: '长文本'.repeat(7_000),
    })

    expect(budget.source).toBe('context_window_derived')
    expect(budget.maxTokens).toBe(STORYBOARD_CONTEXT_DERIVED_MAX_TOKENS_CAP)
  })

  it('preserves explicit maxTokens overrides', () => {
    expect(
      resolveCanvasTextMaxTokens({
        requestedMaxTokens: 2048,
        taskPipelineRole: 'shot',
        prompt: '任意',
      }),
    ).toBe(2048)
  })

  it('does not force a default output budget for ordinary text tasks', () => {
    expect(
      resolveCanvasTextMaxTokens({
        taskPipelineRole: 'screenplay',
        prompt: '普通文本生成',
      }),
    ).toBeUndefined()
  })

  it('raises ordinary text-task budgets when provider context is explicitly configured', () => {
    expect(
      resolveCanvasTextTokenBudget({
        providerContextWindow: 1_000_000,
        taskPipelineRole: 'screenplay',
        prompt: '长文改写',
      }),
    ).toMatchObject({
      source: 'context_window_derived',
      maxTokens: GENERAL_CONTEXT_DERIVED_MAX_TOKENS_CAP,
      providerContextWindow: 1_000_000,
    })
  })

  it('still keeps a safe minimum derived budget for long prompts on storyboard tasks', () => {
    expect(
      resolveCanvasTextTokenBudget({
        providerContextWindow: 20_000,
        taskPipelineRole: 'shot',
        prompt: '超长文本'.repeat(20_000),
      }).maxTokens,
    ).toBe(STORYBOARD_CONTEXT_DERIVED_MIN_MAX_TOKENS)
  })

  it('stores output diagnostics without duplicating system prompt or compiled prompt', () => {
    const raw = buildCanvasTextRawResponse({
      providerProfileId: 'provider-1',
      provider: 'openai-compatible',
      providerName: 'DeepSeek',
      model: 'deepseek-v4-flash',
      apiKind: 'chat',
      agentId: 'agent-1',
      agentName: '分镜师',
      skillIds: ['storyboard'],
      relationManifest: [],
      taskPipelineRole: 'shot',
      outputText: '{"shots":[{"index":1},{"index":2}',
      effectiveMaxTokens: 384_000,
      maxTokensSource: 'model_capability',
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
    })

    expect(raw).not.toHaveProperty('prompt')
    expect(raw).not.toHaveProperty('systemPrompt')
    expect(raw).toMatchObject({
      providerProfileId: 'provider-1',
      model: 'deepseek-v4-flash',
      maxTokens: 384_000,
      maxTokensSource: 'model_capability',
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
      truncation: {
        suspected: true,
        reason: 'provider_finish_reason_length',
      },
    })
  })
})
