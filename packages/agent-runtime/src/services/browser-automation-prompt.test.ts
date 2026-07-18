import { describe, expect, it } from 'vitest'
import { BROWSER_AUTOMATION_SYSTEM_PROMPT } from './browser-automation-prompt.js'

describe('browser automation system prompt', () => {
  it('guides task-driven Chromium recovery without startup downloads', () => {
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('playwright install chromium')
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('150 MB')
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('设置 → 完整性 → 浏览器自动化')
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain(
      'Never download Chromium merely because the app/session started',
    )
  })
})
