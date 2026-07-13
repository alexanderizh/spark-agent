// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingErrorCard } from './StreamingErrorCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('StreamingErrorCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
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
})
