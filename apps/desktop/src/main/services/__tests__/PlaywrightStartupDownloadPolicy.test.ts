import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Playwright startup download policy', () => {
  it('detects status without installing Chromium during startup', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../index.ts', import.meta.url)),
      'utf8',
    )

    expect(source).toContain('pushPlaywrightStatus()')
    expect(source).not.toContain('autoInstallBrowser')
    expect(source).not.toContain('[auto-download]')
  })
})
