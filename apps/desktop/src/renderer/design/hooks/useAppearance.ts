import { useEffect, useState, useCallback } from 'react'

type AppearanceSettings = {
  font: string
  fontSize: number
  codeLigature: boolean
  windowCorners: string
  backdropBlur: boolean
  autoCollapseTools: boolean
  inlineTokenCount: boolean
  syntaxHighlight: boolean
  timestampFormat: string
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  font: 'geist',
  fontSize: 13,
  codeLigature: false,
  windowCorners: 'soft',
  backdropBlur: false,
  autoCollapseTools: true,
  inlineTokenCount: false,
  syntaxHighlight: true,
  timestampFormat: 'rel',
}

const SETTINGS_APPEARANCE_KEY = 'spark-settings-appearance'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'

const FONT_MAP: Record<string, { sans: string; mono: string }> = {
  geist: {
    sans: '"Geist Sans", "SF Pro Text", "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"Geist Mono", "SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
  },
  system: {
    sans: '"SF Pro Text", "SF Pro Display", "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif',
    mono: '"SFMono-Regular", "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, ui-monospace, monospace',
  },
  'ibm-plex': {
    sans: '"IBM Plex Sans", "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", Consolas, ui-monospace, monospace',
  },
  jetbrains: {
    sans: '"JetBrains Sans", "Inter", "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", "SFMono-Regular", Consolas, ui-monospace, monospace',
  },
  inter: {
    sans: '"Inter", "SF Pro Text", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, ui-monospace, monospace',
  },
  'segoe-ui': {
    sans: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
    mono: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace',
  },
  'microsoft-yahei': {
    sans: '"Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", "Segoe UI", system-ui, sans-serif',
    mono: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
  },
  simsun: {
    sans: '"SimSun", "宋体", "Songti SC", "STSong", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
  },
  kaiti: {
    sans: '"KaiTi", "楷体", "Kaiti SC", "STKaiti", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
  },
  fangsong: {
    sans: '"FangSong", "仿宋", "STFangsong", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
  },
  'youyuan': {
    sans: '"YouYuan", "幼圆", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
  },
}

const CORNER_MAP: Record<string, { xs: string; sm: string; md: string; lg: string; xl: string }> = {
  sharp: { xs: '0px', sm: '2px', md: '3px', lg: '4px', xl: '6px' },
  soft: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  round: { xs: '6px', sm: '10px', md: '14px', lg: '20px', xl: '28px' },
}

function readAppearance(): AppearanceSettings {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE
  try {
    const raw = window.localStorage.getItem(SETTINGS_APPEARANCE_KEY)
    if (!raw) return DEFAULT_APPEARANCE
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) as Partial<AppearanceSettings> }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

function applyAppearance(settings: AppearanceSettings) {
  const root = document.documentElement

  // Font family
  const fontFamily = FONT_MAP[settings.font] ?? FONT_MAP.geist!
  root.style.setProperty('--font-sans', fontFamily.sans)
  root.style.setProperty('--font-mono', fontFamily.mono)

  // Font size
  const base = settings.fontSize
  root.style.setProperty('--font-base', `${base}px`)
  root.style.setProperty('--font-sm', `${Math.max(10, base - 1)}px`)
  root.style.setProperty('--font-xs', `${Math.max(9, base - 2)}px`)
  root.style.setProperty('--font-lg', `${base + 1}px`)

  // Code ligature
  root.style.setProperty('--code-ligature', settings.codeLigature ? '"calt", "liga", "dlig", "ss02", "zero"' : 'normal')

  // Serif fonts should not apply Geist-specific OpenType features
  const isSerif = ['simsun', 'kaiti', 'fangsong'].includes(settings.font)
  root.style.setProperty('--font-feature-body', isSerif ? 'normal' : '"cv11", "ss01"')

  // Window corners
  const corners = CORNER_MAP[settings.windowCorners] ?? CORNER_MAP.soft!
  root.style.setProperty('--r-xs', corners.xs)
  root.style.setProperty('--r-sm', corners.sm)
  root.style.setProperty('--r-md', corners.md)
  root.style.setProperty('--r-lg', corners.lg)
  root.style.setProperty('--r-xl', corners.xl)

  // Backdrop blur
  root.dataset.backdropBlur = settings.backdropBlur ? '1' : '0'
  root.style.setProperty('--backdrop-blur', settings.backdropBlur ? 'blur(24px) saturate(1.4)' : 'none')
}

/** Apply appearance CSS variables on mount + changes. Call once in Shell. */
export function useAppearanceEffects() {
  useEffect(() => {
    applyAppearance(readAppearance())

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === SETTINGS_APPEARANCE_KEY) {
        applyAppearance(readAppearance())
      }
    }
    window.addEventListener(SETTINGS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, handler)
  }, [])
}

/** Reactive hook that returns current appearance settings and re-renders on change. */
export function useAppearanceSettings(): AppearanceSettings {
  const [settings, setSettings] = useState<AppearanceSettings>(readAppearance)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === SETTINGS_APPEARANCE_KEY) {
        setSettings(readAppearance())
      }
    }
    window.addEventListener(SETTINGS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, handler)
  }, [])

  return settings
}

export { readAppearance, DEFAULT_APPEARANCE }
export type { AppearanceSettings }
