import { describe, expect, it } from 'vitest'
import {
  buildCanvasTextOutputBudgetInstruction,
  resolveCanvasTextExecutionAdapter,
  resolveCanvasTextModel,
} from './canvasTextTaskRuntime.js'

describe('canvasTextTaskRuntime', () => {
  it('routes custom providers through the session runtime when the selected agent uses Codex', () => {
    expect(
      resolveCanvasTextExecutionAdapter(
        { id: 'custom-openai-provider' },
        { agentAdapter: 'codex' },
      ),
    ).toBe('codex')
  })

  it('keeps ordinary API providers on the direct HTTP path for Claude agents', () => {
    expect(
      resolveCanvasTextExecutionAdapter(
        { id: 'custom-anthropic-provider' },
        { agentAdapter: 'claude-sdk' },
      ),
    ).toBeNull()
  })

  it('preserves built-in local CLI routing', () => {
    expect(resolveCanvasTextExecutionAdapter({ id: 'local-codex-cli' }, null)).toBe('codex')
    expect(resolveCanvasTextExecutionAdapter({ id: 'local-cli' }, null)).toBe('claude-sdk')
    expect(
      resolveCanvasTextExecutionAdapter({ id: 'local-cli' }, { agentAdapter: 'codex' }),
    ).toBe('claude-sdk')
  })

  it('resolves the requested model before agent and provider defaults', () => {
    expect(resolveCanvasTextModel('gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3')).toBe('gpt-5.4')
    expect(resolveCanvasTextModel(null, 'gpt-5.4-mini', 'gpt-5.3')).toBe('gpt-5.4-mini')
  })

  it('adds an explicit completeness-oriented budget instruction for screenplay tasks', () => {
    expect(buildCanvasTextOutputBudgetInstruction('screenplay', 24_576)).toContain('24576 tokens')
    expect(buildCanvasTextOutputBudgetInstruction('screenplay', 24_576)).toContain('结尾完整')
    expect(buildCanvasTextOutputBudgetInstruction('character', 24_576)).toBe('')
  })
})
