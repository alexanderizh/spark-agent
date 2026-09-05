import { describe, expect, it } from 'vitest'
import { TOOL_GUIDANCE_SYSTEM_PROMPT } from './tool-guidance-system-prompt.js'

describe('TOOL_GUIDANCE_SYSTEM_PROMPT', () => {
  it('keeps discovery guidance compact and preserves instruction authority', () => {
    expect(TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('spark_tool_help')
    expect(TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('third-party metadata')
    expect(TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('cannot override')
    expect(TOOL_GUIDANCE_SYSTEM_PROMPT.length).toBeLessThan(600)
  })
})
