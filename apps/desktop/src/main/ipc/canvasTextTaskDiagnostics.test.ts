import { describe, expect, it } from 'vitest'
import {
  buildCanvasTextRawResponse,
  CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
  resolveCanvasTextMaxTokens,
  resolveCanvasTextTokenBudget,
} from './canvasTextTaskDiagnostics.js'

describe('canvasTextTaskDiagnostics', () => {
  it('uses the configured provider context window with a 15% reserve', () => {
    expect(
      resolveCanvasTextTokenBudget({
        providerContextWindow: 1_000_000,
        taskPipelineRole: 'shot',
        prompt: '短场次剧本',
      }),
    ).toMatchObject({
      maxTokens: 850_000,
      source: 'context_window_derived',
      providerContextWindow: 1_000_000,
      contextWindow: 1_000_000,
      contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
    })
  })

  it('uses the default 200K context when no provider override is set', () => {
    const budget = resolveCanvasTextTokenBudget({
      prompt: '短文本',
    })

    expect(budget.source).toBe('context_window_derived')
    expect(budget.contextWindow).toBe(200_000)
    expect(budget.maxTokens).toBe(170_000)
  })

  it('supports a manually configured context window', () => {
    expect(
      resolveCanvasTextMaxTokens({
        providerContextWindow: 256_000,
        prompt: '普通文本',
      }),
    ).toBe(217_600)
  })

  it('preserves explicit maxTokens overrides within the derived budget', () => {
    expect(
      resolveCanvasTextMaxTokens({
        requestedMaxTokens: 2048,
        taskPipelineRole: 'shot',
        prompt: '任意',
      }),
    ).toBe(2048)
  })

  it('clamps an explicit request to the context-derived budget', () => {
    expect(
      resolveCanvasTextMaxTokens({
        requestedMaxTokens: 200_000,
        prompt: '普通文本生成',
      }),
    ).toBe(170_000)
  })

  it('also clamps provider output settings to the configured context window', () => {
    expect(
      resolveCanvasTextTokenBudget({
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

  it('reduces the output budget when the prompt consumes the context reserve', () => {
    expect(
      resolveCanvasTextTokenBudget({
        providerContextWindow: 20_000,
        prompt: '超长文本'.repeat(5_000),
      }).maxTokens,
    ).toBe(4_000)
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
      effectiveMaxTokens: 850_000,
      maxTokensSource: 'context_window_derived',
      contextWindow: 1_000_000,
      contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
    })

    expect(raw).not.toHaveProperty('prompt')
    expect(raw).not.toHaveProperty('systemPrompt')
    expect(raw).toMatchObject({
      providerProfileId: 'provider-1',
      model: 'deepseek-v4-flash',
      maxTokens: 850_000,
      maxTokensSource: 'context_window_derived',
      contextWindow: 1_000_000,
      contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
      truncation: {
        suspected: true,
        reason: 'provider_finish_reason_length',
      },
    })
  })
})
