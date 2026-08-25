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

  it('renders the warning banner when the codex runtime is missing', async () => {
    await renderNotice()

    const banner = container.querySelector<HTMLDivElement>('.pv_codex_runtime_notice')
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('role')).toBe('alert')
    expect(banner?.textContent).toContain('未安装 Codex 运行时')
    expect(
      container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')?.textContent,
    ).toContain('下载并安装')
  })

  it('renders nothing when the codex runtime is installed', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'sdk:integrity-check') return integrityResponse(true)
      return null
    })
    await renderNotice()

    expect(container.querySelector('.pv_codex_runtime_notice')).toBeNull()
  })

  it('shows the cached missing state before the fresh check and hides the banner once installed', async () => {
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

    // 检测尚未返回：缓存命中 missing，横幅立即可见。
    expect(container.querySelector('.pv_codex_runtime_notice')).not.toBeNull()

    await act(async () => {
      resolveCheck?.(integrityResponse(true))
      await Promise.resolve()
    })
    await flushAsync()

    // 刷新检测返回已安装后，横幅消失。
    expect(container.querySelector('.pv_codex_runtime_notice')).toBeNull()
  })

  it('installs the codex runtime on demand and switches to the success state', async () => {
    await renderNotice()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')?.click()
    })
    await flushAsync()

    expect(mocks.invoke).toHaveBeenCalledWith('sdk:integrity-install', {
      packageName: '@openai/codex-sdk',
    })

    const success = container.querySelector('.pv_codex_runtime_notice.is-success')
    expect(success).not.toBeNull()
    expect(success?.textContent).toContain('Codex 运行时已安装')
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
      container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')?.click()
    })
    await flushAsync()

    const banner = container.querySelector<HTMLDivElement>('.pv_codex_runtime_notice.is-error')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('下载中断')
    expect(
      container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')?.textContent,
    ).toContain('重试下载')
  })

  it('keeps the banner in sync when the runtime is installed from elsewhere', async () => {
    await renderNotice()
    expect(container.querySelector('.pv_codex_runtime_notice')).not.toBeNull()

    await act(async () => {
      emitStream('stream:sdk:integrity', integrityResponse(true))
    })

    expect(container.querySelector('.pv_codex_runtime_notice')).toBeNull()
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
      container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')?.click()
    })
    await act(async () => {
      emitStream('stream:sdk:install-progress', installProgress('downloading', '正在下载'))
    })

    expect(container.querySelector('.sdk-install-progress')?.textContent).toContain('正在下载')
    expect(
      container.querySelector<HTMLButtonElement>('.pv_codex_runtime_notice_install')?.textContent,
    ).toContain('正在安装')

    // 释放共享安装单例，避免悬挂 Promise 影响后续用例。
    await act(async () => {
      resolveInstall?.({ success: true, message: '安装成功' })
      await Promise.resolve()
    })
  })
})
