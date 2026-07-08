import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    on: vi.fn(),
  },
}))

import {
  getBundledBrowsersPath,
  resetBundledBrowsersPathCache,
} from '../PlaywrightEnvironment.js'

function createFakeBundledBrowser(root: string): string {
  const browsersDir = join(root, 'apps', 'desktop', 'browsers')
  const chromiumDir = join(browsersDir, 'chromium-9999', 'chrome-mac-arm64')
  mkdirSync(chromiumDir, { recursive: true })
  writeFileSync(join(chromiumDir, 'Google Chrome for Testing'), '')
  return browsersDir
}

describe('PlaywrightEnvironment', () => {
  const originalCwd = process.cwd()
  const originalEnvPath = process.env.PLAYWRIGHT_BROWSERS_PATH
  let tempRoot: string | null = null

  beforeEach(() => {
    resetBundledBrowsersPathCache()
    delete process.env.PLAYWRIGHT_BROWSERS_PATH
  })

  afterEach(() => {
    process.chdir(originalCwd)
    resetBundledBrowsersPathCache()
    if (originalEnvPath == null) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = originalEnvPath
    }
    if (tempRoot != null) {
      rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = null
    }
  })

  it('prefers PLAYWRIGHT_BROWSERS_PATH when it points to a usable browser dir', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'spark-playwright-env-'))
    const expectedPath = createFakeBundledBrowser(tempRoot)
    process.env.PLAYWRIGHT_BROWSERS_PATH = expectedPath

    expect(getBundledBrowsersPath()).toBe(expectedPath)
  })
})
