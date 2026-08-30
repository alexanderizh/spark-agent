import { describe, expect, it, vi } from 'vitest'
import {
  applyUnreadBadge,
  formatDockBadge,
  formatUnreadToolTip,
  normalizeUnreadCount,
  setActiveRendererSession,
  shouldSuppressSessionNotification,
  type AppUnreadBadgeAdapter,
} from './AppUnreadBadgeService'

vi.mock('electron', () => ({
  app: {},
  nativeImage: { createFromBuffer: vi.fn() },
}))

vi.mock('../windows/index.js', () => ({
  getMainWindow: vi.fn(() => null),
}))

function createAdapter(): AppUnreadBadgeAdapter & {
  setDockBadge: ReturnType<typeof vi.fn>
  setLauncherBadgeCount: ReturnType<typeof vi.fn>
  setTaskbarOverlay: ReturnType<typeof vi.fn>
  setTrayToolTip: ReturnType<typeof vi.fn>
} {
  return {
    setDockBadge: vi.fn(),
    setLauncherBadgeCount: vi.fn(),
    setTaskbarOverlay: vi.fn(),
    setTrayToolTip: vi.fn(),
  }
}

describe('AppUnreadBadgeService', () => {
  it('normalizes invalid counts and caps unreasonable input', () => {
    expect(normalizeUnreadCount(-2)).toBe(0)
    expect(normalizeUnreadCount(Number.NaN)).toBe(0)
    expect(normalizeUnreadCount(2.9)).toBe(2)
    expect(normalizeUnreadCount(20_000)).toBe(9_999)
  })

  it('formats macOS badge count and tray tooltip', () => {
    expect(formatDockBadge(0)).toBe('')
    expect(formatDockBadge(12)).toBe('12')
    expect(formatDockBadge(100)).toBe('99+')
    expect(formatUnreadToolTip(0)).toBe('SparkWork')
    expect(formatUnreadToolTip(3)).toBe('SparkWork · 3 个未读会话')
  })

  it('suppresses a session notification only while that session is actively viewed', () => {
    setActiveRendererSession('session-1')

    expect(shouldSuppressSessionNotification('session-1', true)).toBe(true)
    expect(shouldSuppressSessionNotification('session-2', true)).toBe(false)
    expect(shouldSuppressSessionNotification('session-1', false)).toBe(false)

    setActiveRendererSession(null)
  })

  it('uses a numeric Dock badge on macOS', () => {
    const adapter = createAdapter()
    applyUnreadBadge(7, 'darwin', adapter)

    expect(adapter.setDockBadge).toHaveBeenCalledWith('7')
    expect(adapter.setTaskbarOverlay).not.toHaveBeenCalled()
    expect(adapter.setTrayToolTip).toHaveBeenCalledWith('SparkWork · 7 个未读会话')
  })

  it('uses the launcher count on Linux', () => {
    const adapter = createAdapter()
    applyUnreadBadge(4, 'linux', adapter)

    expect(adapter.setLauncherBadgeCount).toHaveBeenCalledWith(4)
    expect(adapter.setTaskbarOverlay).not.toHaveBeenCalled()
  })

  it('uses a boolean taskbar overlay on Windows and clears it at zero', () => {
    const adapter = createAdapter()
    applyUnreadBadge(5, 'win32', adapter)
    applyUnreadBadge(0, 'win32', adapter)

    expect(adapter.setTaskbarOverlay).toHaveBeenNthCalledWith(1, true, 'SparkWork 有 5 个未读会话')
    expect(adapter.setTaskbarOverlay).toHaveBeenNthCalledWith(2, false, 'SparkWork 无未读会话')
  })
})
