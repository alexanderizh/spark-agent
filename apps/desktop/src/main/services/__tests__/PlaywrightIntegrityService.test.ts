/**
 * PlaywrightIntegrityService tests
 *
 * Tests `buildStatus` shape and the `readVersion`/`detectBrowserReady`
 * indirect behavior through `detectIntegrity`. The actual file-system /
 * `require.resolve` calls are exercised naturally; in test environments
 * without the packages installed they return null which is the expected
 * "not installed" state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Electron app — not available in vitest
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    on: vi.fn(),
  },
}))

import {
  detectIntegrity,
  buildStatus,
  getCachedIntegrity,
  invalidateCache,
} from '../PlaywrightIntegrityService.js'

describe('PlaywrightIntegrityService', () => {
  beforeEach(() => {
    invalidateCache()
  })

  describe('detectIntegrity', () => {
    it('returns a complete state object', () => {
      const state = detectIntegrity()
      expect(state).toHaveProperty('mcpInstalled')
      expect(state).toHaveProperty('mcpVersion')
      expect(state).toHaveProperty('playwrightInstalled')
      expect(state).toHaveProperty('browserReady')
      expect(state).toHaveProperty('browserSource')
      expect(state).toHaveProperty('lastError')
      expect(typeof state.mcpInstalled).toBe('boolean')
      expect(typeof state.playwrightInstalled).toBe('boolean')
      expect(typeof state.browserReady).toBe('boolean')
      expect(['bundled', 'system', 'none']).toContain(state.browserSource)
    })

    it('caches state after first call', () => {
      const first = detectIntegrity()
      const cached = getCachedIntegrity()
      expect(cached).not.toBeNull()
      expect(cached).toEqual(first)
    })

    it('invalidateCache clears the cache', () => {
      detectIntegrity()
      expect(getCachedIntegrity()).not.toBeNull()
      invalidateCache()
      expect(getCachedIntegrity()).toBeNull()
    })
  })

  describe('buildStatus', () => {
    it('combines integrity state with managed-MCP and view state', () => {
      const status = buildStatus({
        mcpRegistered: true,
        mcpEnabled: true,
        mode: 'headful',
        viewOpen: false,
        cdpEndpoint: null,
      })

      expect(status).toHaveProperty('mcpInstalled')
      expect(status).toHaveProperty('mcpVersion')
      expect(status).toHaveProperty('playwrightInstalled')
      expect(status).toHaveProperty('browserReady')
      expect(status).toHaveProperty('browserSource')
      expect(['bundled', 'system', 'none']).toContain(status.browserSource)
      expect(status.mcpRegistered).toBe(true)
      expect(status.mcpEnabled).toBe(true)
      expect(status.mode).toBe('headful')
      expect(status.viewOpen).toBe(false)
      expect(status.cdpEndpoint).toBeNull()
      expect(status).toHaveProperty('lastError')
    })

    it('reflects headless mode and open view state', () => {
      const status = buildStatus({
        mcpRegistered: true,
        mcpEnabled: true,
        mode: 'headless',
        viewOpen: true,
        cdpEndpoint: 'http://127.0.0.1:9223',
      })
      expect(status.mode).toBe('headless')
      expect(status.viewOpen).toBe(true)
      expect(status.cdpEndpoint).toBe('http://127.0.0.1:9223')
    })

    it('returns disabled state when registration info is false', () => {
      const status = buildStatus({
        mcpRegistered: false,
        mcpEnabled: false,
        mode: 'headful',
        viewOpen: false,
        cdpEndpoint: null,
      })
      expect(status.mcpRegistered).toBe(false)
      expect(status.mcpEnabled).toBe(false)
    })

    it('triggers detection on first call when cache is empty', () => {
      invalidateCache()
      expect(getCachedIntegrity()).toBeNull()
      const status = buildStatus({
        mcpRegistered: false,
        mcpEnabled: false,
        mode: 'headful',
        viewOpen: false,
        cdpEndpoint: null,
      })
      // After buildStatus the cache should be populated (regardless of install state)
      expect(getCachedIntegrity()).not.toBeNull()
      // Status reflects whatever detectIntegrity found — don't assert on
      // mcpInstalled since it depends on whether the package is actually
      // resolvable from this test's working directory.
      expect(typeof status.mcpInstalled).toBe('boolean')
      expect(typeof status.browserReady).toBe('boolean')
    })
  })
})
