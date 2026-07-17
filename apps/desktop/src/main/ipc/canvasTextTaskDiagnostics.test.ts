import { describe, expect, it } from 'vitest'
import {
  buildCanvasTextRawResponse,
  CANVAS_TEXT_CONTEXT_SAFETY_TOKENS,
  CANVAS_TEXT_OUTPUT_TIERS,
  CanvasTextContextBudgetError,
  resolveCanvasTextMaxTokens,
  resolveCanvasTextTokenBudget,
} from './canvasTextTaskDiagnostics.js'

describe('canvasTextTaskDiagnostics', () => {
  it('uses the long-output tier for storyboard generation', () => {
    expect(
      resolveCanvasTextTokenBudget({
        operation: 'text_generate',
        providerContextWindow: 1_000_000,
        taskPipelineRole: 'shot',
        prompt: '短场次剧本',
      }),
    ).toMatchObject({
      maxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      desiredMaxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      source: 'task_default',
      providerContextWindow: 1_000_000,
      contextWindow: 1_000_000,
      contextSafetyTokens: CANVAS_TEXT_CONTEXT_SAFETY_TOKENS,
    })
  })

  it('uses the long-output tier for screenplay rewriting', () => {
    expect(
      resolveCanvasTextTokenBudget({
        operation: 'text_rewrite',
        taskPipelineRole: 'screenplay',
        prompt: '把章节改写成剧本',
      }),
    ).toMatchObject({
      maxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      source: 'task_default',
    })
  })

  it('uses 32K for ordinary canvas text generation', () => {
    const budget = resolveCanvasTextTokenBudget({
      operation: 'text_generate',
      prompt: '短文本',
    })

    expect(budget.source).toBe('task_default')
    expect(budget.contextWindow).toBe(200_000)
    expect(budget.maxTokens).toBe(CANVAS_TEXT_OUTPUT_TIERS.standard)
  })

  it('uses 16K for prompt optimization', () => {
    expect(
      resolveCanvasTextMaxTokens({
        operation: 'prompt_optimize',
        prompt: '优化这段提示词',
      }),
    ).toBe(CANVAS_TEXT_OUTPUT_TIERS.minimum)
  })

  it('raises explicit maxTokens overrides below the 16K minimum tier', () => {
    expect(
      resolveCanvasTextMaxTokens({
        requestedMaxTokens: 2048,
        taskPipelineRole: 'shot',
        prompt: '任意',
      }),
    ).toBe(CANVAS_TEXT_OUTPUT_TIERS.minimum)
  })

  it('clamps an explicit request to the 128K explicit maximum', () => {
    expect(
      resolveCanvasTextMaxTokens({
        requestedMaxTokens: 200_000,
        prompt: '普通文本生成',
      }),
    ).toBe(CANVAS_TEXT_OUTPUT_TIERS.explicitMaximum)
  })

  it('clamps an explicit request to the provider output cap', () => {
    expect(
      resolveCanvasTextTokenBudget({
        requestedMaxTokens: 131_072,
        providerContextWindow: 200_000,
        providerMaxTokens: 128_000,
        prompt: '长文改写',
      }),
    ).toMatchObject({
      source: 'provider_profile',
      maxTokens: 128_000,
      providerMaxTokens: 128_000,
      contextWindow: 200_000,
    })
  })

  it('keeps a model-specific 1M context while applying the provider output cap', () => {
    expect(
      resolveCanvasTextTokenBudget({
        modelId: 'deepseek-v4-pro',
        requestedMaxTokens: 131_072,
        providerMaxTokens: 128_000,
        prompt: '长篇剧本',
      }),
    ).toMatchObject({
      source: 'provider_profile',
      maxTokens: 128_000,
      providerMaxTokens: 128_000,
      providerContextWindow: 1_000_000,
      contextWindow: 1_000_000,
    })
  })

  it('uses a fixed 16K safety buffer when the prompt consumes most of the context', () => {
    expect(resolveCanvasTextTokenBudget({
      operation: 'text_generate',
      providerContextWindow: 100_000,
      prompt: '文'.repeat(74_999),
    })).toMatchObject({
      maxTokens: 23_616,
      source: 'context_remaining',
      promptTokensEstimate: 60_000,
      remainingContextTokens: 23_616,
      contextSafetyTokens: CANVAS_TEXT_CONTEXT_SAFETY_TOKENS,
    })
  })

  it('fails locally when the prompt leaves no safe output context', () => {
    expect(() => resolveCanvasTextTokenBudget({
      operation: 'text_generate',
      providerContextWindow: 20_000,
      prompt: '超长文本'.repeat(5_000),
    })).toThrow(CanvasTextContextBudgetError)
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
      desiredMaxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      effectiveMaxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      maxTokensSource: 'task_default',
      contextWindow: 1_000_000,
      remainingContextTokens: 983_000,
      contextSafetyTokens: CANVAS_TEXT_CONTEXT_SAFETY_TOKENS,
      learnedOutputCap: 32_768,
      outputLimitRetryCount: 1,
      outputLimitAttempts: [65_536, 32_768],
      outputLimitEvidence: 'max_tokens is above the maximum',
      requestTimeoutMs: 600_000,
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
    })

    expect(raw).not.toHaveProperty('prompt')
    expect(raw).not.toHaveProperty('systemPrompt')
    expect(raw).toMatchObject({
      providerProfileId: 'provider-1',
      model: 'deepseek-v4-flash',
      desiredMaxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      maxTokens: CANVAS_TEXT_OUTPUT_TIERS.long,
      maxTokensSource: 'task_default',
      contextWindow: 1_000_000,
      remainingContextTokens: 983_000,
      contextSafetyTokens: CANVAS_TEXT_CONTEXT_SAFETY_TOKENS,
      learnedOutputCap: 32_768,
      outputLimitRetryCount: 1,
      outputLimitAttempts: [65_536, 32_768],
      outputLimitEvidence: 'max_tokens is above the maximum',
      requestTimeoutMs: 600_000,
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
      truncation: {
        suspected: true,
        reason: 'provider_finish_reason_length',
      },
    })
  })
})
