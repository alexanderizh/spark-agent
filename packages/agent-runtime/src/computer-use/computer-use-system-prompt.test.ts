import { describe, expect, it } from 'vitest'
import { buildComputerUseSystemPrompt } from './computer-use-system-prompt.js'

describe('buildComputerUseSystemPrompt', () => {
  it('teaches the agent to use the governed capability and forbids temporary desktop scripting', () => {
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
    expect(prompt).toMatch(/do not install|不得安装/i)
    expect(prompt).toMatch(/tell the user|告诉用户/i)
  })

  it('requires evidence-backed completion when task execution is available', () => {
    const prompt = buildComputerUseSystemPrompt({
      platform: 'windows',
      available: true,
      executionAvailable: true,
    })

    expect(prompt).toContain('mcp__spark_computer__start_task')
    expect(prompt).toContain('verification')
    expect(prompt).toContain('pause')
    expect(prompt).toContain('stop')
    expect(prompt).toContain('takeover')
  })
})
