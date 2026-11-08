import { describe, expect, it } from 'vitest'
import { estimateTokens } from '@spark/shared'
import {
  PLATFORM_MANAGEMENT_SYSTEM_PROMPT,
  PRESENT_FILES_SYSTEM_PROMPT,
  QUICK_REPLIES_SYSTEM_PROMPT,
} from './session-mcp-tooling-helpers.js'

describe('bounded static prompt optimization', () => {
  it('keeps the three common declarations below 800 estimated tokens (previously 1215)', () => {
    const prompts = [
      PRESENT_FILES_SYSTEM_PROMPT,
      QUICK_REPLIES_SYSTEM_PROMPT,
      PLATFORM_MANAGEMENT_SYSTEM_PROMPT,
    ]
    expect(prompts.reduce((total, prompt) => total + estimateTokens(prompt), 0)).toBeLessThan(800)
  })

  it('retains file journal ownership, delivery, empty-turn and final-response contracts', () => {
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('once immediately before the final response')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('skip if no files changed this turn')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('you or your dispatched agents')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('pre-existing changes')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('oldPath')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('present_files')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('inline preview/playback')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('unless explicitly requested')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('Skip if there are no deliverables')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('do not repeat those paths')
  })

  it('keeps quick replies separate from permissions, and requires the matching final question', () => {
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('Never request filesystem, command, network')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('security-sensitive approval')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('mutually exclusive within a turn')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('include the matching question/invitation')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('end the turn')
  })
})
