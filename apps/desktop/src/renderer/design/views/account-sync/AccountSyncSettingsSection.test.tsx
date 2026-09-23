// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticated: true,
  userId: 101 as number | null,
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  applySyncedAppearance: vi.fn(),
  applySyncedAppearanceLocally: vi.fn(),
}))

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mocks.authenticated,
    user: mocks.userId == null ? null : { id: mocks.userId },
  }),
}))

vi.mock('../../AppContext', () => ({
  useApp: () => ({ applySyncedAppearance: mocks.applySyncedAppearance }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    toast: {
      success: mocks.toastSuccess,
      warning: mocks.toastWarning,
      error: mocks.toastError,
    },
  }),
}))

vi.mock('../../hooks/useAppearance', () => ({
  applySyncedAppearanceLocally: mocks.applySyncedAppearanceLocally,
}))

import { AccountSyncSettingsSection } from './AccountSyncSettingsSection'

const disabledPreferences = {
  enabled: false,
  categories: {
    customCommands: false,
    prompts: false,
    memory: false,
    assistants: false,
    workflows: false,
    appearance: false,
  },
}

const enabledPreferences = {
  enabled: true,
  categories: {
    ...disabledPreferences.categories,
    appearance: true,
  },
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes(text),
  )
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AccountSyncSettingsSection', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.authenticated = true
    mocks.userId = 101
    mocks.invoke.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastWarning.mockReset()
    mocks.toastError.mockReset()
    mocks.applySyncedAppearance.mockReset()
    mocks.applySyncedAppearanceLocally.mockReset()
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: disabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return { list: [], total: 0, page: 1, pageSize: 20 }
      }
      if (channel === 'account-sync:get-status') {
        return {
          maxPayloadBytes: 20 * 1024 * 1024,
          lastPayloadBytes: 3_565_158,
          lastSyncAt: '2026-09-23T12:00:00.000Z',
          lastStatus: 'success',
          lastDeviceLabel: 'macOS #1111',
          source: 'server',
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke: mocks.invoke },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('shows the privacy contract and keeps manual sync disabled by default', async () => {
    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    expect(container.textContent).toContain('不会自动同步')
    expect(container.textContent).toContain('敏感配置不会上传')
    expect(container.textContent).toContain('所选内容会保存到账号云端')
    expect(buttonByText('立即同步')?.disabled).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('account-sync:get-preferences', {})
    expect(mocks.invoke).toHaveBeenCalledWith('account-sync:list-history', {
      page: 1,
      pageSize: 20,
    })
  })

  it('does not request preferences or history for a signed-out user', async () => {
    mocks.authenticated = false
    mocks.userId = null

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    expect(container.textContent).toContain('尚未登录')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('only executes after the user clicks the manual sync button', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: enabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return { list: [], total: 0, page: 1, pageSize: 20 }
      }
      if (channel === 'account-sync:execute') {
        return {
          result: {
            operationId: '11111111-1111-4111-8111-111111111111',
            status: 'success',
            categories: [],
            stats: { uploaded: 1, downloaded: 1, conflicts: 0, skipped: 0 },
            errorCodes: [],
          },
          appliedAppearance: {
            theme: 'dark',
            density: 'compact',
            fontSize: 16,
            uiZoom: 110,
          },
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    expect(mocks.invoke).not.toHaveBeenCalledWith('account-sync:execute', {})
    const syncButton = buttonByText('立即同步')
    expect(syncButton?.disabled).toBe(false)

    await act(async () => {
      syncButton?.click()
      await flush()
      await flush()
    })

    expect(mocks.invoke).toHaveBeenCalledWith('account-sync:execute', {})
    expect(mocks.applySyncedAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark', density: 'compact' }),
    )
    expect(mocks.applySyncedAppearanceLocally).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 16, uiZoom: 110 }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('账号同步完成')
  })

  it('reloads preferences when the authenticated account changes', async () => {
    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })
    // 偏好 + 历史 + 同步余量状态
    expect(mocks.invoke).toHaveBeenCalledTimes(3)

    mocks.userId = 202
    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    expect(mocks.invoke).toHaveBeenCalledTimes(6)
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, 'account-sync:get-status', {})
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, 'account-sync:get-preferences', {})
    expect(mocks.invoke).toHaveBeenNthCalledWith(6, 'account-sync:list-history', {
      page: 1,
      pageSize: 20,
    })
  })

  it('shows the sync quota line with the measured remaining amount', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: enabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return { list: [], total: 0, page: 1, pageSize: 20 }
      }
      if (channel === 'account-sync:get-status') {
        return {
          maxPayloadBytes: 20 * 1024 * 1024,
          lastPayloadBytes: 3_565_158,
          lastSyncAt: '2026-09-23T12:00:00.000Z',
          lastStatus: 'success',
          lastDeviceLabel: 'macOS #1111',
          source: 'server',
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    expect(container.textContent).toContain('单次同步上限 20 MiB')
    expect(container.textContent).toContain('上次数据 3.4 MiB')
    expect(container.textContent).toContain('余量 16.6 MiB')
    expect(container.querySelector('.account-sync-quota-bar.is-ok')).not.toBeNull()
  })

  it('falls back to a conservative limit hint when the server has no status endpoint', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: enabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return { list: [], total: 0, page: 1, pageSize: 20 }
      }
      if (channel === 'account-sync:get-status') {
        return {
          maxPayloadBytes: 5 * 1024 * 1024,
          lastPayloadBytes: null,
          lastSyncAt: null,
          lastStatus: null,
          lastDeviceLabel: null,
          source: 'fallback',
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    expect(container.textContent).toContain('单次同步上限 5 MiB')
    expect(container.textContent).toContain('尚无同步记录')
    expect(container.textContent).toContain('服务端版本较低，仅供参考')
  })

  it('measures the pending payload on demand and blocks sync when it exceeds the limit', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: enabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return { list: [], total: 0, page: 1, pageSize: 20 }
      }
      if (channel === 'account-sync:get-status') {
        return {
          maxPayloadBytes: 20 * 1024 * 1024,
          lastPayloadBytes: null,
          lastSyncAt: null,
          lastStatus: null,
          lastDeviceLabel: null,
          source: 'server',
        }
      }
      if (channel === 'account-sync:estimate-payload') {
        return {
          bytes: 25 * 1024 * 1024,
          maxBytes: 20 * 1024 * 1024,
          exceeded: true,
          categories: ['appearance'],
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })
    expect(buttonByText('立即同步')?.disabled).toBe(false)

    await act(async () => {
      buttonByText('测量本次数据')?.click()
      await flush()
      await flush()
    })

    expect(mocks.invoke).toHaveBeenCalledWith('account-sync:estimate-payload', {})
    expect(container.textContent).toContain('本次待同步 25 MiB')
    expect(container.textContent).toContain('已超出 5 MiB')
    expect(container.textContent).toContain('请减少同步内容')
    expect(container.querySelector('.account-sync-quota-inline.is-over')).not.toBeNull()
    expect(buttonByText('立即同步')?.disabled).toBe(true)
  })

  it('reports the measured payload size in the sync result', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: enabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return { list: [], total: 0, page: 1, pageSize: 20 }
      }
      if (channel === 'account-sync:get-status') {
        return {
          maxPayloadBytes: 20 * 1024 * 1024,
          lastPayloadBytes: 3_565_158,
          lastSyncAt: null,
          lastStatus: 'success',
          lastDeviceLabel: 'macOS #1111',
          source: 'server',
        }
      }
      if (channel === 'account-sync:execute') {
        return {
          result: {
            operationId: '11111111-1111-4111-8111-111111111111',
            status: 'success',
            categories: [],
            stats: { uploaded: 1, downloaded: 1, conflicts: 0, skipped: 0 },
            errorCodes: [],
            payloadBytes: 3_565_158,
          },
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })
    await act(async () => {
      buttonByText('立即同步')?.click()
      await flush()
      await flush()
    })

    expect(container.textContent).toContain('数据 3.4 MiB')
    expect(container.textContent).toContain('本次待同步 3.4 MiB')
  })

  it('shows local apply acknowledgement in history instead of cloud-only success', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:get-preferences') {
        return { authenticated: true, preferences: enabledPreferences }
      }
      if (channel === 'account-sync:list-history') {
        return {
          list: [
            {
              operationId: '11111111-1111-4111-8111-111111111111',
              deviceLabel: 'macOS #1111',
              status: 'success',
              categories: ['appearance'],
              stats: { uploaded: 1, downloaded: 0, conflicts: 0, skipped: 0 },
              errorCodes: [],
              ackStatus: 'partial',
              ackErrorCodes: ['SYNC_LOCAL_APPLY_FAILED'],
              durationMs: 12,
              createdAt: '2026-08-30T00:00:00.000Z',
              finishedAt: '2026-08-30T00:00:01.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncSettingsSection />)
      await flush()
    })

    const historyStatus = container.querySelector('.account-sync-history-main strong')
    expect(historyStatus?.textContent).toBe('部分成功')
  })
})
