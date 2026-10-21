import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  created: 0,
  destroyed: 0,
  executeJavaScript: vi.fn(() => Promise.resolve()),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    destroyed = false
    webContents = {
      executeJavaScript: electronMocks.executeJavaScript,
      setWindowOpenHandler: () => undefined,
    }

    constructor() {
      electronMocks.created += 1
    }

    on(): void {}
    setAlwaysOnTop(): void {}
    setVisibleOnAllWorkspaces(): void {}
    showInactive(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
      electronMocks.destroyed += 1
    }
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
}))

import type { ComputerUseEvent } from '@spark/protocol'
import { ComputerUsePipProjection } from './ComputerUsePipProjection.js'
import { BANNER_HTML, ComputerUseStatusBannerService } from './ComputerUseStatusBannerService.js'

// Window behaviour needs a live Electron session; the copy contract is pure
// inline markup, so assert the user-facing strings and phase colors stay put.
describe('Status banner markup contract', () => {
  it('announces the agent presence and the Esc handoff affordance', () => {
    expect(BANNER_HTML).toContain('Spark 正在操作此电脑')
    expect(BANNER_HTML).toContain('Esc 打断')
  })

  it('labels every session phase with the shared accent palette', () => {
    expect(BANNER_HTML).toContain('Spark 正在执行操作')
    expect(BANNER_HTML).toContain('Spark 等待你的确认')
    expect(BANNER_HTML).toContain('Spark 任务已完成')
    expect(BANNER_HTML).toMatch(/\.accent-acting\s*\{[^}]*#ffb340/s)
    expect(BANNER_HTML).toMatch(/\.accent-running\s*\{[^}]*#4c8dff/s)
  })

  it('stays purely presentational (no control buttons)', () => {
    expect(BANNER_HTML).not.toContain('<button')
  })
})

describe('Status banner session retirement', () => {
  it('applies runtime preference changes to the current session', () => {
    electronMocks.created = 0
    electronMocks.destroyed = 0
    electronMocks.executeJavaScript.mockClear()
    let onTimelineEvent: ((event: ComputerUseEvent) => void) | undefined
    const service = new ComputerUseStatusBannerService({
      enabled: false,
      projection: new ComputerUsePipProjection({
        sessions: {
          listLabeled: () => [{ computerSessionId: 'computer-1', label: '我的桌面' }],
        },
      }),
      timeline: {
        subscribe: (listener) => {
          onTimelineEvent = listener
          return () => undefined
        },
      },
    })

    onTimelineEvent?.({
      id: 'event-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      computerSessionId: 'computer-1',
      timestamp: '2026-10-22T00:00:00.000Z',
      seq: 1,
      type: 'computer_action_requested',
      actionId: 'action-1',
      riskLevel: 'L1',
      summary: '正在操作',
    })
    expect(electronMocks.created).toBe(0)

    service.setEnabled(true)
    expect(electronMocks.created).toBe(1)
    expect(electronMocks.executeJavaScript).toHaveBeenCalledOnce()

    service.setEnabled(false)
    expect(electronMocks.destroyed).toBe(1)
    service.dispose()
  })

  it('retires terminal sessions from the projection after the linger period', async () => {
    vi.useFakeTimers()
    let onTimelineEvent: ((event: ComputerUseEvent) => void) | undefined
    const projection = new ComputerUsePipProjection({
      sessions: {
        listLabeled: () => [{ computerSessionId: 'computer-1', label: '我的桌面' }],
      },
    })
    const service = new ComputerUseStatusBannerService({
      projection,
      timeline: {
        subscribe: (listener) => {
          onTimelineEvent = listener
          return () => undefined
        },
      },
    })

    try {
      onTimelineEvent?.({
        id: 'event-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        computerSessionId: 'computer-1',
        timestamp: '2026-10-22T00:00:00.000Z',
        seq: 1,
        type: 'computer_session_completed',
        verificationIds: [],
      })
      expect(projection.snapshot()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(2_500)

      expect(projection.snapshot()).toHaveLength(0)
    } finally {
      service.dispose()
      vi.useRealTimers()
    }
  })
})
