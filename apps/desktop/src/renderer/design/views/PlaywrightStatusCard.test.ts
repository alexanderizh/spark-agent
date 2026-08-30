import { describe, expect, it } from 'vitest'
import { getBrowserDescription } from './playwrightStatusCopy'

describe('PlaywrightStatusCard browser description', () => {
  it('explains that a system browser is usable and Chromium is optional', () => {
    expect(getBrowserDescription('system')).toContain('当前可用')
    expect(getBrowserDescription('system')).toContain('兼容性问题')
  })

  it('points users without a browser to the manual download action', () => {
    expect(getBrowserDescription('none')).toContain('未检测到可用浏览器')
    expect(getBrowserDescription('none')).toContain('手动下载')
  })
})
