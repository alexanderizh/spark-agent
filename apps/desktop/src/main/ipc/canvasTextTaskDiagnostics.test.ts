import { describe, expect, it } from 'vitest'
import {
  buildCanvasTextRawResponse,
  CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
  CANVAS_TEXT_ROLE_MAX_TOKENS,
  resolveCanvasTextMaxTokens,
  resolveCanvasTextTokenBudget,
} from './canvasTextTaskDiagnostics.js'

describe('canvasTextTaskDiagnostics', () => {
  it('caps storyboard output independently from a very large provider context window', () => {
    expect(
      resolveCanvasTextTokenBudget({
        providerContextWindow: 1_000_000,
        taskPipelineRole: 'shot',
        prompt: '短场次剧本',
      }),
    ).toMatchObject({
      maxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.shot,
      source: 'task_role_cap',
      providerContextWindow: 1_000_000,
      taskRoleMaxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.shot,
      contextWindow: 1_000_000,
      contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
    })
  })

  it('uses a smaller dedicated cap for screenplay rewriting', () => {
    expect(
      resolveCanvasTextTokenBudget({
        taskPipelineRole: 'screenplay',
        prompt: '把章节改写成剧本',
      }),
    ).toMatchObject({
      maxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.screenplay,
      source: 'task_role_cap',
      taskRoleMaxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.screenplay,
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
      effectiveMaxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.shot,
      maxTokensSource: 'task_role_cap',
      taskRoleMaxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.shot,
      contextWindow: 1_000_000,
      contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
      requestTimeoutMs: 600_000,
      providerFinishReason: 'length',
      reasoningContentChars: 24_000,
    })

    expect(raw).not.toHaveProperty('prompt')
    expect(raw).not.toHaveProperty('systemPrompt')
    expect(raw).toMatchObject({
      providerProfileId: 'provider-1',
      model: 'deepseek-v4-flash',
      maxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.shot,
      maxTokensSource: 'task_role_cap',
      taskRoleMaxTokens: CANVAS_TEXT_ROLE_MAX_TOKENS.shot,
      contextWindow: 1_000_000,
      contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
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
