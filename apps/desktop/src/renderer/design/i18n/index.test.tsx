// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useI18n } from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function I18nHarness() {
  const { t } = useI18n()
  return <div data-testid="label">{t('sidebar.group.today')}</div>
}

describe('useI18n authoritative language hydrate', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
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

  it('hydrates the first render language from IPC settings when localStorage is stale', async () => {
    localStorage.setItem('spark-settings-general', JSON.stringify({ language: 'en-US' }))

    let resolveSettings: ((value: { value: { language: string; userName: string } }) => void) | null = null
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get') {
        return await new Promise<{ value: { language: string; userName: string } }>((resolve) => {
          resolveSettings = resolve
        })
      }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    await act(async () => {
      root = createRoot(container)
      root.render(<I18nHarness />)
    })

    expect(container.textContent).toContain('Today')

    await act(async () => {
      resolveSettings?.({ value: { language: 'zh-CN', userName: 'User' } })
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('今天')
    })

    expect(invoke).toHaveBeenCalledWith('settings:get', { category: 'general', key: 'data' })
    expect(JSON.parse(localStorage.getItem('spark-settings-general') ?? '{}')).toMatchObject({
      language: 'zh-CN',
    })
  })
})
