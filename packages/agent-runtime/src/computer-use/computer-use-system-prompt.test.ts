import { describe, expect, it } from 'vitest'
import { buildComputerUseSystemPrompt } from './computer-use-system-prompt.js'

describe('buildComputerUseSystemPrompt', () => {
  it('teaches the agent to report failed computer tasks instead of claiming a shallow fallback completed', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'macos',
      available: false,
      unavailableReason: 'input_permission_unsupported',
    })

    expect(prompt).toContain('Computer Control Broker')
    expect(prompt).toContain('input_permission_unsupported')
    expect(prompt).toContain('report the exact outcome')
    expect(prompt).toContain('Never describe an application launch')
    expect(prompt).toContain('instead of substituting a shallow fallback')
    expect(prompt).toMatch(/permission|approval/i)
  })

  it('teaches the atomic direct-control loop with element ids and tool priority', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'macos',
      available: true,
      executionAvailable: true,
    })

    expect(prompt).toContain('invoke_element')
    expect(prompt).toContain('elementId')
    expect(prompt).toContain('stale_tree')
    expect(prompt).toContain('semantic element actions')
    expect(prompt).toContain('One action per tool call')
    expect(prompt).toContain('before declaring success')
    expect(prompt).toContain('[selected]')
  })

  it('keeps the delegated start_task path and evidence-backed completion', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'windows',
      available: true,
      executionAvailable: true,
    })

    expect(prompt).toContain('start_task')
    expect(prompt).toContain('wait_for_completion')
    expect(prompt).toContain('"environment":"my_desktop"')
    expect(prompt).toContain('acceptanceCriteria')
    expect(prompt).toContain('pause')
    expect(prompt).toContain('takeover')
    expect(prompt).toContain('never auto-canceled')
    expect(prompt).toContain('System privacy and secure-desktop prompts belong to the user')
  })
})
