// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  theme: null as { token?: Record<string, unknown> } | null,
}))

vi.mock('@lobehub/ui', () => ({
  ThemeProvider: ({ theme, children }: { theme?: { token?: Record<string, unknown> }; children?: React.ReactNode }) => {
    mocks.theme = theme ?? null
    return children
  },
}))

vi.mock('antd', () => {
  const ConfigProvider = Object.assign(
    ({ children }: { children?: React.ReactNode }) => children,
    { config: vi.fn() },
  )
  return {
    App: ({ children }: { children?: React.ReactNode }) => children,
    ConfigProvider,
  }
})

vi.mock('../hooks/useManagedFontAssets', () => ({
  useManagedFontAssets: vi.fn(),
}))

import { LobeThemeProvider } from './LobeThemeProvider'

describe('LobeThemeProvider appearance font bridge', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    mocks.theme = null
  })

  it('connects lobe and antd font tokens to the appearance CSS variables', () => {
    container = document.createElement('div')
    document.body.appendChild(container)

    act(() => {
      root = createRoot(container)
      root.render(
        <LobeThemeProvider themeMode="light" resolvedTheme="light" primary="#6366f1">
          <div>content</div>
        </LobeThemeProvider>,
      )
    })

    expect(mocks.theme?.token).toMatchObject({
      fontFamily: 'var(--font-sans)',
      fontFamilyCode: 'var(--font-mono)',
    })
  })
})
