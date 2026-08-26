// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SdkIntegrityCheckResponse, SdkIntegrityInstallProgress } from '@spark/protocol'
import { ProviderCodexRuntimeNotice } from './ProviderCodexRuntimeNotice'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setTweak: vi.fn(),
}))

vi.mock('../../AppContext', () => ({
  useApp: () => ({ setTweak: mocks.setTweak }),
}))

type StreamListener = (payload: unknown) => void
const streamListeners = new Map<string, StreamListener[]>()

function emitStream(channel: string, payload: unknown) {
  for (const listener of streamListeners.get(channel) ?? []) {
    listener(payload)
  }
}

function integrityResponse(codexRuntimeInstalled: boolean): SdkIntegrityCheckResponse {
  return {
    sdks: [
      {
        packageName: '@anthropic-ai/claude-agent-sdk',
        displayName: 'Claude Agent SDK',
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: null,
        updateAvailable: false,
        latestChecked: false,
      },
      {
        packageName: '@openai/codex-sdk',
        displayName: 'OpenAI Codex SDK',
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: null,
        updateAvailable: false,
        latestChecked: false,
        runtime: {
          installed: codexRuntimeInstalled,
          installedVersion: codexRuntimeInstalled ? '0.5.0' : null,
          latestVersion: null,
          updateAvailable: false,
          latestChecked: false,
          targetTriple: 'aarch64-apple-darwin',
          artifactId: null,
        },
      },
    ],
    tools: [],
    checkedAt: '2026-08-26T00:00:00.000Z',
  }
}

function installProgress(
  state: SdkIntegrityInstallProgress['state'],
  message: string,
): SdkIntegrityInstallProgress {
  return {
    packageName: '@openai/codex-sdk',
    state,
    downloaded: 1,
    total: 2,
    percent: 50,
    message,
  }
}

describe('ProviderCodexRuntimeNotice', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    streamListeners.clear()
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sdk:integrity-check') return integrityResponse(false)
      if (channel === 'sdk:integrity-install') return { success: true, message: '安装成功' }
      return null
    })
    vi.stubGlobal('spark', {
      invoke: mocks.invoke,
      on: vi.fn((channel: string, listener: StreamListener) => {
        const list = streamListeners.get(channel) ?? []
        list.push(listener)
        streamListeners.set(channel, list)
        return () => {
          streamListeners.set(
            channel,
            (streamListeners.get(channel) ?? []).filter((item) => item !== listener),
          )
        }
      }),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    vi.unstubAllGlobals()
  })

  async function flushAsync(ticks = 6) {
    for (let i = 0; i < ticks; i += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  async function renderNotice() {
    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderCodexRuntimeNotice />)
    })
    await flushAsync()
  }

  function queryBanner(): HTMLDivElement | null {
    return container.querySelector<HTMLDivElement>('.pv_codex_runtime_notice')
  }

  function queryInstallButton(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')
  }

  function queryBadge(): HTMLElement | null {
    return container.querySelector<HTMLElement>('.pv_codex_runtime_notice_badge')
  }

  it('renders the warning banner when the codex runtime is missing', async () => {
    await renderNotice()

    const banner = queryBanner()
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('role')).toBe('alert')
    expect(banner?.textContent).toContain('按需安装')
    expect(queryBadge()?.textContent).toContain('未安装')
    expect(queryInstallButton()?.textContent).toContain('下载并安装')
  })

  it('keeps the banner visible as an installed status when the codex runtime is ready', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sdk:integrity-check') return integrityResponse(true)
      return null
    })
    await renderNotice()

    const banner = queryBanner()
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('role')).toBe('status')
    expect(banner?.className).toContain('is-ready')
    expect(queryBadge()?.textContent).toContain('已安装')
    expect(queryInstallButton()).toBeNull()
    expect(container.querySelector('.pv_codex_runtime_notice_settings')).toBeNull()
  })

  it('starts from the cached missing state and settles to the installed-only banner', async () => {
    window.localStorage.setItem('spark-sdk-integrity', JSON.stringify(integrityResponse(false)))
    let resolveCheck: ((value: SdkIntegrityCheckResponse) => void) | null = null
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'sdk:integrity-check') {
        return new Promise<SdkIntegrityCheckResponse>((resolve) => {
          resolveCheck = resolve
        })
      }
      return Promise.resolve(null)
    })

    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderCodexRuntimeNotice />)
    })

    // 检测尚未返回：缓存命中 missing，横幅立即可见并带未安装徽标。
    expect(queryBanner()).not.toBeNull()
    expect(queryBadge()?.textContent).toContain('未安装')

    await act(async () => {
      resolveCheck?.(integrityResponse(true))
      await Promise.resolve()
    })
    await flushAsync()

    // 刷新检测返回已安装后，横幅保留（常驻）并切换为已安装态、隐藏安装入口。
    expect(queryBanner()).not.toBeNull()
    expect(queryBadge()?.textContent).toContain('已安装')
    expect(queryInstallButton()).toBeNull()
  })

  it('installs the codex runtime on demand and settles into the installed state', async () => {
    await renderNotice()

    await act(async () => {
      queryInstallButton()?.click()
    })
    await flushAsync()

    expect(mocks.invoke).toHaveBeenCalledWith('sdk:integrity-install', {
      packageName: '@openai/codex-sdk',
    })

    const banner = queryBanner()
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('role')).toBe('status')
    expect(queryBadge()?.textContent).toContain('已安装')
    expect(queryInstallButton()).toBeNull()
  })

  it('reports install failures with a retry action', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sdk:integrity-check') return integrityResponse(false)
      if (channel === 'sdk:integrity-install') {
        throw new Error('下载中断')
      }
      return null
    })
    await renderNotice()

    await act(async () => {
      queryInstallButton()?.click()
    })
    await flushAsync()

    const banner = container.querySelector<HTMLDivElement>('.pv_codex_runtime_notice.is-error')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('下载中断')
    expect(queryBadge()?.textContent).toContain('未安装')
    expect(queryInstallButton()?.textContent).toContain('重试下载')
  })

  it('flips to the installed state when the runtime is installed from elsewhere', async () => {
    await renderNotice()
    expect(queryBanner()).not.toBeNull()
    expect(queryInstallButton()).not.toBeNull()

    await act(async () => {
      emitStream('stream:sdk:integrity', integrityResponse(true))
    })

    expect(queryBanner()).not.toBeNull()
    expect(queryBadge()?.textContent).toContain('已安装')
    expect(queryInstallButton()).toBeNull()
  })

  it('shows download progress while installing', async () => {
    let resolveInstall: ((value: { success: boolean; message: string }) => void) | null = null
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'sdk:integrity-check') return Promise.resolve(integrityResponse(false))
      if (channel === 'sdk:integrity-install') {
        return new Promise<{ success: boolean; message: string }>((resolve) => {
          resolveInstall = resolve
        })
      }
      return Promise.resolve(null)
    })
    await renderNotice()

    await act(async () => {
      queryInstallButton()?.click()
    })
    await act(async () => {
      emitStream('stream:sdk:install-progress', installProgress('downloading', '正在下载'))
    })

    expect(container.querySelector('.sdk-install-progress')?.textContent).toContain('正在下载')
    const installingButton = queryInstallButton()
    expect(installingButton?.textContent).toContain('正在安装')
    expect(installingButton?.disabled).toBe(true)

    // 释放共享安装单例，避免悬挂 Promise 影响后续用例。
    await act(async () => {
      resolveInstall?.({ success: true, message: '安装成功' })
      await Promise.resolve()
    })
  })
})
