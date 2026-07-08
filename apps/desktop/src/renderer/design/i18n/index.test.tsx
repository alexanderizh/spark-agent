// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getHostLanguage,
  languageToLang,
  normalizeSupportedLanguage,
  resolveSupportedLanguage,
} from './locales'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalNavigatorLanguages = Object.getOwnPropertyDescriptor(window.navigator, 'languages')
const originalNavigatorLanguage = Object.getOwnPropertyDescriptor(window.navigator, 'language')

function setNavigatorLanguages(languages: readonly string[], language = languages[0] ?? '') {
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: languages,
  })
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: language,
  })
}

describe('language resolution', () => {
  afterEach(() => {
    if (originalNavigatorLanguages != null) {
      Object.defineProperty(window.navigator, 'languages', originalNavigatorLanguages)
    }
    if (originalNavigatorLanguage != null) {
      Object.defineProperty(window.navigator, 'language', originalNavigatorLanguage)
    }
    vi.unstubAllGlobals()
  })

  it('normalizes common Chinese and English locale variants', () => {
    expect(normalizeSupportedLanguage('zh_CN')).toBe('zh-CN')
    expect(normalizeSupportedLanguage('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeSupportedLanguage('EN_us')).toBe('en-US')
    expect(normalizeSupportedLanguage('fr-FR')).toBeNull()
  })

  it('defaults unresolved languages to Chinese', () => {
    expect(resolveSupportedLanguage('fr-FR')).toBe('zh-CN')
    expect(languageToLang(undefined)).toBe('zh')
  })

  it('prefers Chinese when the host language list contains Chinese', () => {
    setNavigatorLanguages(['en-US', 'zh-CN'])
    expect(getHostLanguage()).toBe('zh-CN')
  })

  it('uses Chinese when the host language is unknown', () => {
    setNavigatorLanguages(['fr-FR'])
    expect(getHostLanguage()).toBe('zh-CN')
  })
})

describe('useI18n authoritative language hydrate', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    vi.resetModules()
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

  async function renderI18nHarness() {
    const { useI18n } = await import('./index')
    function I18nHarness() {
      const { t } = useI18n()
      return <div data-testid="label">{t('sidebar.group.today')}</div>
    }
    await act(async () => {
      root = createRoot(container)
      root.render(<I18nHarness />)
    })
  }

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

    await renderI18nHarness()

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

  it('replaces stale localStorage language with Chinese when IPC settings are absent', async () => {
    localStorage.setItem('spark-settings-general', JSON.stringify({ language: 'en-US' }))
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get') return { value: null }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    await renderI18nHarness()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('今天')
    })

    expect(JSON.parse(localStorage.getItem('spark-settings-general') ?? '{}')).toMatchObject({
      language: 'zh-CN',
    })
  })
})
