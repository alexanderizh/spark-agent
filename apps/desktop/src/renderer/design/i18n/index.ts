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

type TranslationParams = Record<string, string | number | undefined | null>

function formatTranslation(template: string, params?: TranslationParams): string {
  if (params == null) return template
  return template.replace(/{{(\w+)}}/g, (_, key: string) => String(params[key] ?? ''))
}

export function useI18n(): {
  lang: Lang
  t: (key: TranslationKey, params?: TranslationParams) => string
} {
  const [lang, setLang] = useState<Lang>(detectLang)
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string }>).detail
      if (detail?.key === SETTINGS_GENERAL_KEY) {
        setLang(detectLang())
      }
    }
    window.addEventListener(SETTINGS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, handler)
  }, [])
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams): string =>
      formatTranslation(TRANSLATIONS[lang][key] ?? TRANSLATIONS.zh[key] ?? key, params),
    [lang],
  )
  return { lang, t }
}
