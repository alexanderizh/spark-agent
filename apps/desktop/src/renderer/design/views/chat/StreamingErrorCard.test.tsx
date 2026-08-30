// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingErrorCard } from './StreamingErrorCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setTweak = vi.hoisted(() => vi.fn())
vi.mock('../../AppContext', () => ({ useApp: () => ({ setTweak }) }))

describe('StreamingErrorCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setTweak.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders actionable details and invokes the existing retry callback', () => {
    const onRetry = vi.fn()
    act(() => {
      root.render(
        <StreamingErrorCard
          code="CLAUDE_RATE_LIMIT"
          title="请求受到限流"
          message="当前额度窗口已耗尽。"
          level="error"
          retryable
          actionHint="额度重置后再试。"
          details={[{ label: '重置时间', value: '2027-01-15T08:00:00.000Z' }]}
          onRetry={onRetry}
        />,
      )
    })

    expect(container.textContent).toContain('请求受到限流')
    expect(container.textContent).toContain('当前额度窗口已耗尽。')
    expect(container.textContent).not.toContain('重置时间')
    expect(container.textContent).not.toContain('额度重置后再试。')

    const detailButton = container.querySelector<HTMLButtonElement>(
      '.runtime-diagnostic-detail-toggle',
    )
    expect(detailButton?.getAttribute('aria-expanded')).toBe('false')
    act(() => detailButton?.click())

    expect(container.textContent).toContain('重置时间')
    expect(container.textContent).toContain('额度重置后再试。')
    expect(detailButton?.getAttribute('aria-expanded')).toBe('true')
    const retryButton = container.querySelector<HTMLButtonElement>('.runtime-diagnostic-retry')
    act(() => retryButton?.click())
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('does not offer retry for non-retryable failures', () => {
    act(() => {
      root.render(
        <StreamingErrorCard
          code="CLAUDE_BILLING_ERROR"
          title="账户额度不可用"
          message="请检查账单设置。"
          level="error"
          retryable={false}
        />,
      )
    })

    const detailButton = container.querySelector<HTMLButtonElement>(
      '.runtime-diagnostic-detail-toggle',
    )
    act(() => detailButton?.click())
    expect(container.querySelector('.runtime-diagnostic-retry')).toBeNull()
  })

  it('installs a missing Codex runtime in place and then retries the message', async () => {
    const onRetry = vi.fn()
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ success: true, message: 'Codex runtime 0.144.5 安装成功' })
      .mockResolvedValueOnce({ sdks: [], tools: [], checkedAt: '2026-07-18T00:00:00.000Z' })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })

    act(() => {
      root.render(
        <StreamingErrorCard
          code="CODEX_RUNTIME_NOT_INSTALLED"
          title="Codex 运行时未安装"
          message="安装后即可继续当前会话。"
          level="error"
          retryable
          onRetry={onRetry}
        />,
      )
    })

    expect(container.querySelector('.runtime-diagnostic-retry')).toBeNull()
    const installButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('下载并安装'),
    )
    expect(installButton).toBeDefined()

    act(() => installButton?.click())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('重新尝试当前消息')
    expect(invoke).toHaveBeenNthCalledWith(1, 'sdk:integrity-install', {
      packageName: '@openai/codex-sdk',
    })
    expect(container.textContent).toContain('Codex runtime 0.144.5 安装成功')

    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('重新尝试当前消息'),
    )
    act(() => retryButton?.click())
    expect(onRetry).toHaveBeenCalledOnce()

    const settingsButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('前往完整性'),
    )
    act(() => settingsButton?.click())
    expect(setTweak).toHaveBeenNthCalledWith(1, 'settingsSection', 'integrity')
    expect(setTweak).toHaveBeenNthCalledWith(2, 'view', 'settings')
  })

  it('keeps the download action available after an installation failure', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false, message: '云端连接失败' })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })

    act(() => {
      root.render(
        <StreamingErrorCard
          code="CODEX_RUNTIME_NOT_INSTALLED"
          title="Codex 运行时未安装"
          message="安装后即可继续当前会话。"
          level="error"
          retryable
        />,
      )
    })

    const installButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('下载并安装'),
    )
    act(() => installButton?.click())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('重试下载')
    expect(container.textContent).toContain('云端连接失败')
  })

  it('shows streamed Codex download percentage and byte progress', async () => {
    let progressListener:
      | ((payload: {
          packageName: string
          state: 'downloading'
          downloaded: number
          total: number
          percent: number
          message: string
        }) => void)
      | undefined
    let finishInstall: ((result: { success: boolean; message: string }) => void) | undefined
    const invoke = vi.fn().mockImplementationOnce(
      () =>
        new Promise<{ success: boolean; message: string }>((resolve) => {
          finishInstall = resolve
        }),
    )
    const on = vi.fn((channel: string, listener: typeof progressListener) => {
      if (channel === 'stream:sdk:install-progress') progressListener = listener
      return vi.fn()
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke, on },
    })

    act(() => {
      root.render(
        <StreamingErrorCard
          code="CODEX_RUNTIME_NOT_INSTALLED"
          title="Agent 执行失败"
          message="安装后即可继续当前会话。"
          level="error"
          retryable
        />,
      )
    })
    const installButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('下载并安装'),
    )
    act(() => installButton?.click())
    act(() => {
      progressListener?.({
        packageName: '@openai/codex-sdk',
        state: 'downloading',
        downloaded: 50 * 1024 * 1024,
        total: 100 * 1024 * 1024,
        percent: 50,
        message: '正在下载 Codex 运行时',
      })
    })

    expect(container.textContent).toContain('Codex 运行时未安装')
    expect(container.textContent).toContain('50%')
    expect(container.textContent).toContain('50.0 MiB / 100 MiB')
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '50',
    )

    await act(async () => {
      finishInstall?.({ success: true, message: '安装成功' })
      await Promise.resolve()
    })
  })
})
