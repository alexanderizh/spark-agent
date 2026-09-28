// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SingleAgentEmptyHero } from './ChatHero'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SingleAgentEmptyHero', () => {
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

  it('renders the celestial greeting banner only', async () => {
    await act(async () => {
      root.render(<SingleAgentEmptyHero themeId="celestial" />)
    })

    const section = container.querySelector<HTMLElement>('.single-empty-hero')
    expect(section?.className).toContain('single-empty-hero-celestial')
    expect(section?.getAttribute('data-empty-theme')).toBe('celestial')
    expect(container.querySelector('.single-empty-eyebrow')?.textContent).toBe('SPARK WORKSPACE')
    // 标题随本地时间问候（小时不定，断言共同后缀）。
    expect(container.querySelector('.single-empty-title')?.textContent).toContain('，继续推进')

    // 主题切换器已随多主题下线移除。
    expect(container.querySelector('.empty-hero-theme-trigger')).toBeNull()
  })

  it('no longer renders the quick-action card group (empty session is heatmap-only)', async () => {
    await act(async () => {
      root.render(<SingleAgentEmptyHero themeId="celestial" />)
    })

    expect(container.querySelector('.single-empty-actions')).toBeNull()
    expect(container.querySelector('.single-empty-action')).toBeNull()
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('renders the model-generated greeting when the main process returns one', async () => {
    const win = window as unknown as {
      spark?: { invoke: (channel: string, req: unknown) => unknown }
    }
    const original = win.spark
    const calls: Array<{ channel: string; req: unknown }> = []
    win.spark = {
      invoke: async (channel: string, req: unknown) => {
        calls.push({ channel, req })
        return { ok: true, text: '早上好，愿你今日灵感如泉', source: 'model' }
      },
    }
    try {
      await act(async () => {
        root.render(<SingleAgentEmptyHero themeId="celestial" sessionId="sess-1" />)
      })
      await act(async () => {})
      expect(container.querySelector('.single-empty-title')?.textContent).toBe(
        '早上好，愿你今日灵感如泉',
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]?.channel).toBe('greeting:get')
      expect(calls[0]?.req).toEqual({ sessionId: 'sess-1' })
    } finally {
      if (original === undefined) delete win.spark
      else win.spark = original
    }
  })

  it('falls back to the hardcoded greeting when generation fails', async () => {
    const win = window as unknown as { spark?: { invoke: (channel: string) => unknown } }
    const original = win.spark
    win.spark = { invoke: async () => ({ ok: false, reason: 'no model available' }) }
    try {
      await act(async () => {
        root.render(<SingleAgentEmptyHero themeId="celestial" />)
      })
      await act(async () => {})
      expect(container.querySelector('.single-empty-title')?.textContent).toContain('，继续推进')
    } finally {
      if (original === undefined) delete win.spark
      else win.spark = original
    }
  })

  it('hides the refresh button when the greeting IPC is unavailable', async () => {
    // 无 window.spark（浏览器预览）时不该出现一个点了没反应的按钮。
    await act(async () => {
      root.render(<SingleAgentEmptyHero themeId="celestial" />)
    })
    expect(container.querySelector('.single-empty-refresh')).toBeNull()
  })

  it('re-requests with forceRefresh when the refresh button is clicked', async () => {
    const win = window as unknown as {
      spark?: { invoke: (channel: string, req: unknown) => unknown }
    }
    const original = win.spark
    const calls: Array<{ channel: string; req: unknown }> = []
    win.spark = {
      invoke: async (channel: string, req: unknown) => {
        calls.push({ channel, req })
        return {
          ok: true,
          text: calls.length === 1 ? '早上好，愿你今日灵感如泉' : '早上好，山高路远，行则将至',
          source: 'model',
        }
      },
    }
    try {
      await act(async () => {
        root.render(<SingleAgentEmptyHero themeId="celestial" />)
      })
      await act(async () => {})
      expect(container.querySelector('.single-empty-title')?.textContent).toBe(
        '早上好，愿你今日灵感如泉',
      )

      const button = container.querySelector<HTMLButtonElement>('.single-empty-refresh')
      expect(button).not.toBeNull()
      expect(button?.getAttribute('aria-label')).toBe('换一句问候语')
      expect(button?.title).toBe('换一句')

      await act(async () => {
        button?.click()
      })
      await act(async () => {})

      expect(calls).toHaveLength(2)
      // 手动刷新必须绕过主进程的 2 小时缓存。
      expect(calls[1]?.req).toEqual({ forceRefresh: true })
      expect(container.querySelector('.single-empty-title')?.textContent).toBe(
        '早上好，山高路远，行则将至',
      )
      // 刷新结束后按钮恢复可用。
      expect(container.querySelector<HTMLButtonElement>('.single-empty-refresh')?.disabled).toBe(
        false,
      )
    } finally {
      if (original === undefined) delete win.spark
      else win.spark = original
    }
  })

  it('keeps the current greeting when a manual refresh fails', async () => {
    const win = window as unknown as {
      spark?: { invoke: (channel: string, req: unknown) => unknown }
    }
    const original = win.spark
    let call = 0
    win.spark = {
      invoke: async () => {
        call += 1
        return call === 1
          ? { ok: true, text: '早上好，愿你今日灵感如泉', source: 'model' }
          : { ok: false, reason: 'HTTP 500' }
      },
    }
    try {
      await act(async () => {
        root.render(<SingleAgentEmptyHero themeId="celestial" />)
      })
      await act(async () => {})

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.single-empty-refresh')?.click()
      })
      await act(async () => {})

      // 刷新失败不把已有文案清成空白，也不退回写死文案。
      expect(container.querySelector('.single-empty-title')?.textContent).toBe(
        '早上好，愿你今日灵感如泉',
      )
    } finally {
      if (original === undefined) delete win.spark
      else win.spark = original
    }
  })
})
