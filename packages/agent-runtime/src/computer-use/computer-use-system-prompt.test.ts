import { describe, expect, it } from 'vitest'
import { buildComputerUseSystemPrompt } from './computer-use-system-prompt.js'

describe('buildComputerUseSystemPrompt', () => {
  it('teaches the agent to prefer governed control and automatically fall back when unavailable', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'macos',
      available: false,
      unavailableReason: 'input_permission_unsupported',
    })

    expect(prompt).toContain('mcp__spark_computer__get_capabilities')
    expect(prompt).toContain('Computer Control Broker')
    expect(prompt).toContain('JXA')
    expect(prompt).toContain('AppleScript')
    expect(prompt).toContain('cliclick')
    expect(prompt).toContain('pyautogui')
    expect(prompt).toContain('xdotool')
    expect(prompt).toContain('PowerShell')
    expect(prompt).toContain('input_permission_unsupported')
    expect(prompt).toMatch(/fallback|alternative|continue/i)
    expect(prompt).toMatch(/permission|approval/i)
    expect(prompt).not.toMatch(/Never emulate or replace Computer Use/i)
  })

  it('requires evidence-backed completion when task execution is available', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'windows',
      available: true,
      executionAvailable: true,
    })

    expect(prompt).toContain('mcp__spark_computer__start_task')
    expect(prompt).toContain('"environment":"my_desktop"')
    expect(prompt).toContain('successCriteria` is optional')
    expect(prompt).toContain('all permission modes')
    expect(prompt).toContain('verification')
    expect(prompt).toContain('pause')
    expect(prompt).toContain('stop')
    expect(prompt).toContain('takeover')
  })
})
