import { describe, expect, it } from 'vitest'
import { buildComputerUseSystemPrompt } from './computer-use-system-prompt.js'

describe('buildComputerUseSystemPrompt', () => {
  it('teaches the agent to report failed computer tasks instead of claiming a shallow fallback completed', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'macos',
      available: false,
      unavailableReason: 'input_permission_unsupported',
    })

    expect(prompt).toContain('mcp__spark_computer__get_capabilities')
    expect(prompt).toContain('Computer Control Broker')
    expect(prompt).toContain('input_permission_unsupported')
    expect(prompt).toContain('report that exact outcome')
    expect(prompt).toContain('Do not replace a failed desktop task')
    expect(prompt).toContain('Never describe an application launch')
    expect(prompt).toMatch(/permission|approval/i)
  })

  it('requires evidence-backed completion when task execution is available', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'windows',
      available: true,
      executionAvailable: true,
    })

    expect(prompt).toContain('mcp__spark_computer__start_task')
    expect(prompt).toContain('wait_for_completion')
    expect(prompt).toContain('do not poll')
    expect(prompt).toContain('"environment":"my_desktop"')
    expect(prompt).toContain('successCriteria` is optional')
    expect(prompt).toContain('all permission modes')
    expect(prompt).toContain('task-level desktop authorization')
    expect(prompt).toContain('does not request per-action approval')
    expect(prompt).not.toContain('exact L2/L3 desktop action')
    expect(prompt).toContain('There is no application allowlist')
    expect(prompt).toContain('remains bound to that target')
    expect(prompt).toContain('restores the user foreground app')
    expect(prompt).toContain('verification')
    expect(prompt).toContain('pause')
    expect(prompt).toContain('stop')
    expect(prompt).toContain('takeover')
  })
})
