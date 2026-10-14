/**
 * i18n — 轻量多语言支持
 *
 * 数据源：设置项 `spark-settings-general` 的 `language` 字段（zh-CN / en-US）。
 * - 菜单栏先接入；其它视图后续可逐步迁入。
 * - 监听 `spark-settings-updated` 事件自动刷新。
 * - 当前仅内置 zh / en 字典，未匹配的语言回退 zh。
 */
import { useCallback, useEffect, useState } from 'react'

import {
  languageToLang,
  resolveSupportedLanguage,
  TRANSLATIONS,
  type Lang,
  type TranslationKey,
} from './locales'

export type { Lang, SupportedLanguage, TranslationKey } from './locales'
export { getHostLanguage, resolveSupportedLanguage, SUPPORTED_LANGUAGES } from './locales'

const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'
let authoritativeLanguageSync: Promise<void> | null = null

function detectLang(): Lang {
  if (typeof window === 'undefined') return languageToLang(resolveSupportedLanguage(undefined))
  try {
    const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
    if (raw != null) {
      const parsed = JSON.parse(raw) as { language?: string } | null
      return languageToLang(resolveSupportedLanguage(parsed?.language))
    }
  } catch {
    // ignore parse errors
  }
  return languageToLang(resolveSupportedLanguage(undefined))
}

/**
 * 当前语言（模块级单例），供非 React 组件代码（工具函数 / 数据文件）通过 `translate()` 使用。
 * `useI18n` 会在语言变化时同步此值。
 */
let activeLang: Lang | null = null

function resolveActiveLang(): Lang {
  if (activeLang == null) activeLang = detectLang()
  return activeLang
}

/** 读取当前语言（非组件场景）。 */
export function getLang(): Lang {
  return resolveActiveLang()
}

/**
 * 非组件场景的翻译函数。
 *
 * 注意：**组件内请优先使用 `useI18n().t`**，它会随语言切换自动重渲染；
 * `translate()` 只适合模块级工具函数、非组件纯函数等无法拿到 hook 的场景。
 */
export function translate(key: TranslationKey, params?: TranslationParams): string {
  const lang = resolveActiveLang()
  return formatTranslation(TRANSLATIONS[lang][key] ?? TRANSLATIONS.zh[key] ?? key, params)
}

function syncAuthoritativeLanguage(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (authoritativeLanguageSync != null) return authoritativeLanguageSync

  // `invoke` 用可选调用：测试环境只 mock 了 window.spark.on 的场景不应被 i18n 拖崩。
  authoritativeLanguageSync =
    (window.spark?.invoke?.('settings:get', { category: 'general', key: 'data' }) ??
      Promise.resolve({ value: null }))
      .then((res) => {
        const value = res?.value
        const authoritative =
          value != null && typeof value === 'object'
            ? (value as Record<string, unknown> & { language?: unknown })
            : {}
        const nextLanguage = resolveSupportedLanguage(
          typeof authoritative.language === 'string' ? authoritative.language : undefined,
        )

        let current: Record<string, unknown> = {}
        try {
          const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
          const parsed = raw != null ? (JSON.parse(raw) as unknown) : null
          if (parsed != null && typeof parsed === 'object') {
            current = parsed as Record<string, unknown>
          }
        } catch {
          // ignore parse errors
        }

        const nextStored = { ...current, ...authoritative, language: nextLanguage }
        if (current.language === nextStored.language) return

        window.localStorage.setItem(SETTINGS_GENERAL_KEY, JSON.stringify(nextStored))
        window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { key: SETTINGS_GENERAL_KEY } }))
      })
      .catch(() => {
        // ignore IPC failures and keep local fallback
      })

  return authoritativeLanguageSync
}

type TranslationParams = Record<string, string | number | undefined | null>

/** 翻译函数签名，供需要注入 t 的模块级纯函数复用。 */
export type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string

function formatTranslation(template: string, params?: TranslationParams): string {
  if (params == null) return template
  return template.replace(/{{(\w+)}}/g, (_, key: string) => String(params[key] ?? ''))
}

export function useI18n(): {
  lang: Lang
  t: TranslateFn
} {
  const [lang, setLang] = useState<Lang>(() => {
    const next = detectLang()
    activeLang = next
    return next
  })
  useEffect(() => {
    activeLang = lang
  }, [lang])
  useEffect(() => {
    let cancelled = false
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string }>).detail
      if (detail?.key === SETTINGS_GENERAL_KEY) {
        setLang(detectLang())
      }
    }
    window.addEventListener(SETTINGS_UPDATED_EVENT, handler)
    void syncAuthoritativeLanguage().then(() => {
      if (!cancelled) {
        setLang(detectLang())
      }
    })
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_UPDATED_EVENT, handler)
    }
  }, [])
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams): string =>
      formatTranslation(TRANSLATIONS[lang][key] ?? TRANSLATIONS.zh[key] ?? key, params),
    [lang],
  )
  return { lang, t }
}
