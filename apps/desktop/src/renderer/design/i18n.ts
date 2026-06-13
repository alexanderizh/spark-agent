/**
 * i18n — 轻量多语言支持
 *
 * 数据源：设置项 `spark-settings-general` 的 `language` 字段（zh-CN / en-US）。
 * - 菜单栏先接入；其它视图后续可逐步迁入。
 * - 监听 `spark-settings-updated` 事件自动刷新。
 * - 当前仅内置 zh / en 字典，未匹配的语言回退 zh。
 */
import { useCallback, useEffect, useState } from 'react'

export type Lang = 'zh' | 'en'
export type TranslationKey =
  | 'nav.agents'
  | 'nav.providers'
  | 'nav.skills'
  | 'nav.tasks'
  | 'nav.mcp'
  | 'nav.board'
  | 'nav.workflows'
  | 'nav.canvas'

const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'

const TRANSLATIONS: Record<Lang, Record<TranslationKey, string>> = {
  zh: {
    'nav.agents': '助手',
    'nav.providers': '模型',
    'nav.skills': '技能',
    'nav.tasks': '定时任务',
    'nav.mcp': 'MCP',
    'nav.board': '任务面板',
    'nav.workflows': '工作流',
    'nav.canvas': '无限画布',
  },
  en: {
    'nav.agents': 'Agents',
    'nav.providers': 'Providers',
    'nav.skills': 'Skills',
    'nav.tasks': 'Tasks',
    'nav.mcp': 'MCP',
    'nav.board': 'Board',
    'nav.workflows': 'Workflows',
    'nav.canvas': 'Canvas',
  },
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  try {
    const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
    if (raw != null) {
      const parsed = JSON.parse(raw) as { language?: string } | null
      if (parsed?.language === 'en-US') return 'en'
    }
  } catch {
    // ignore parse errors
  }
  return 'zh'
}

export function useI18n(): { lang: Lang; t: (key: TranslationKey) => string } {
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
    (key: TranslationKey): string => TRANSLATIONS[lang][key] ?? TRANSLATIONS.zh[key] ?? key,
    [lang],
  )
  return { lang, t }
}
