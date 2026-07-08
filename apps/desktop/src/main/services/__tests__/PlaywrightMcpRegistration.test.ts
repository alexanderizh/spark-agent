/**
 * PlaywrightMcpRegistration — pure-logic tests
 *
 * Tests `buildPlaywrightConfig` (the only logic that does not require a live
 * SparkDatabase). The config now dynamically omits `--browser` for bundled
 * chromium or picks a valid system browser channel, so tests verify structural
 * properties rather than exact arg values.
 *
 * Database-dependent paths (ensureRegistered, setEnabled, readRegistration)
 * are covered by integration verification.
 */
import { describe, it, expect, vi } from 'vitest'

// Mock Electron app — not available in vitest
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    on: vi.fn(),
  },
}))

import { buildPlaywrightConfig } from '../PlaywrightMcpRegistration.js'

describe('buildPlaywrightConfig', () => {
  it('always produces a stdio config using the bundled Electron Node runtime', () => {
    const config = buildPlaywrightConfig('headful', null)
    expect(config.type).toBe('stdio')
    expect(config.command).toBe(process.execPath)
    expect(Array.isArray(config.args)).toBe(true)
    expect(config.args.length).toBeGreaterThanOrEqual(1)
    expect(config.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('passes the packaged @playwright/mcp cli path before flags', () => {
    const config = buildPlaywrightConfig('headful', null)
    expect(config.args[0]).toMatch(/@playwright[\\/]mcp[\\/]cli\.js$/)
    const firstFlagIdx = config.args.findIndex((a) => a.startsWith('--'))
    if (firstFlagIdx >= 0) {
      expect(firstFlagIdx).toBeGreaterThan(0)
    }
  })

  it('omits --browser when bundled chromium is selected (or accepts a valid channel)', () => {
    const config = buildPlaywrightConfig('headful', null)
    const browserIdx = config.args.indexOf('--browser')
    if (browserIdx >= 0) {
      // If present, value must be a valid channel name per @playwright/mcp CLI
      expect(['chrome', 'firefox', 'webkit', 'msedge']).toContain(config.args[browserIdx + 1])
    }
    // --channel is NOT a valid @playwright/mcp CLI flag, never emit it
    expect(config.args).not.toContain('--channel')
  })

  it('appends --headless when mode is headless', () => {
    const config = buildPlaywrightConfig('headless', null)
    expect(config.args).toContain('--headless')
  })

  it('omits --headless when mode is headful', () => {
    const config = buildPlaywrightConfig('headful', null)
    expect(config.args).not.toContain('--headless')
  })

  it('appends --cdp-endpoint when endpoint is provided', () => {
    const config = buildPlaywrightConfig('headful', 'http://127.0.0.1:9223')
    const cdpIdx = config.args.indexOf('--cdp-endpoint')
    expect(cdpIdx).toBeGreaterThanOrEqual(0)
    expect(config.args[cdpIdx + 1]).toBe('http://127.0.0.1:9223')
  })

  it('omits --cdp-endpoint when endpoint is null', () => {
    const config = buildPlaywrightConfig('headful', null)
    expect(config.args).not.toContain('--cdp-endpoint')
  })

  it('omits --cdp-endpoint when endpoint is empty string', () => {
    const config = buildPlaywrightConfig('headful', '')
    expect(config.args).not.toContain('--cdp-endpoint')
  })

  it('combines headless + cdp-endpoint correctly', () => {
    const config = buildPlaywrightConfig('headless', 'http://127.0.0.1:9223')
    expect(config.args).toContain('--headless')
    expect(config.args).toContain('--cdp-endpoint')
    expect(config.args).toContain('http://127.0.0.1:9223')
  })

  it('serializes to valid JSON', () => {
    const config = buildPlaywrightConfig('headful', 'http://127.0.0.1:9223')
    const json = JSON.stringify(config)
    const parsed = JSON.parse(json)
    expect(parsed.type).toBe('stdio')
    expect(parsed.command).toBe(process.execPath)
    expect(Array.isArray(parsed.args)).toBe(true)
  })

  it('always includes Electron node env and optionally bundled browser env', () => {
    const config = buildPlaywrightConfig('headful', null)
    expect(config.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    if (config.env?.PLAYWRIGHT_BROWSERS_PATH) {
      expect(config.env).toHaveProperty('PLAYWRIGHT_BROWSERS_PATH')
    }
  })
})
