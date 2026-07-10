import { useEffect, useState, useCallback } from 'react'
import { syncArcoThemeFromDom } from '../arcoTheme'

type AppearanceSettings = {
  font: string
  fontSize: number
  uiZoom: number
  codeLigature: boolean
  windowCorners: string
  backdropBlur: boolean
  autoCollapseTools: boolean
  inlineTokenCount: boolean
  syntaxHighlight: boolean
  timestampFormat: string
}

export const UI_ZOOM_MIN = 80
export const UI_ZOOM_MAX = 150
export const UI_ZOOM_STEP = 5
export const UI_ZOOM_DEFAULT = 100

const DEFAULT_APPEARANCE: AppearanceSettings = {
  font: 'geist',
  fontSize: 14,
  uiZoom: UI_ZOOM_DEFAULT,
  codeLigature: false,
  windowCorners: 'soft',
  // Keep the navigation panel translucent by default; users can still disable it.
  backdropBlur: true,
  autoCollapseTools: true,
  inlineTokenCount: false,
  syntaxHighlight: true,
  timestampFormat: 'rel',
}

const SETTINGS_APPEARANCE_KEY = 'spark-settings-appearance'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'
const BROWSER_ZOOM_CHANGED_EVENT = 'spark:browser-zoom-changed'

type AppearanceFontMeta = {
  label: string
  sans: string
  mono: string
  availabilityFamilies: string[]
  alwaysAvailable?: boolean
}

/**
 * Font stack map for the appearance selector.
 *
 * Note: `@lobehub/webfont-geist/css/index.css` registers the family as
 * `Geist` (NOT `Geist Sans`), so the first entry in the `geist.sans` stack
 * must match that exact name. Using `"Geist Sans"` would always fall back
 * to the next family and silently break the "Geist (recommended)" option.
 */
const FONT_MAP: Record<string, AppearanceFontMeta> = {
  geist: {
    label: 'Geist + Geist Mono（推荐）',
    sans: '"Geist", "SF Pro Text", "SF Pro Display", "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"Geist Mono", "SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['Geist', 'Geist Mono'],
    alwaysAvailable: true,
  },
  system: {
    label: '系统默认',
    sans: '"SF Pro Text", "SF Pro Display", "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif',
    mono: '"SFMono-Regular", "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, ui-monospace, monospace',
    availabilityFamilies: [],
    alwaysAvailable: true,
  },
  'ibm-plex': {
    label: 'IBM Plex',
    sans: '"IBM Plex Sans", "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['IBM Plex Sans', 'IBM Plex Mono'],
  },
  jetbrains: {
    label: 'JetBrains',
    sans: '"JetBrains Sans", "Inter", "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", "SFMono-Regular", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['JetBrains Sans', 'JetBrains Mono'],
  },
  inter: {
    label: 'Inter',
    sans: '"Inter", "SF Pro Text", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['Inter'],
  },
  'segoe-ui': {
    label: 'Segoe UI',
    sans: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
    mono: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['Segoe UI Variable', 'Segoe UI', 'Cascadia Code'],
  },
  'microsoft-yahei': {
    label: '微软雅黑',
    sans: '"Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", "Segoe UI", system-ui, sans-serif',
    mono: '"Cascadia Code", "JetBrains Mono", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['Microsoft YaHei', 'Microsoft YaHei UI'],
  },
  simsun: {
    label: '宋体',
    sans: '"SimSun", "宋体", "Songti SC", "STSong", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['SimSun', '宋体', 'Songti SC', 'STSong'],
  },
  kaiti: {
    label: '楷体',
    sans: '"KaiTi", "楷体", "Kaiti SC", "STKaiti", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['KaiTi', '楷体', 'Kaiti SC', 'STKaiti'],
  },
  fangsong: {
    label: '仿宋',
    sans: '"FangSong", "仿宋", "STFangsong", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['FangSong', '仿宋', 'STFangsong'],
  },
  'youyuan': {
    label: '幼圆',
    sans: '"YouYuan", "幼圆", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
    availabilityFamilies: ['YouYuan', '幼圆'],
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

function writeAppearance(settings: AppearanceSettings): void {
  window.localStorage.setItem(SETTINGS_APPEARANCE_KEY, JSON.stringify(settings))
}

function notifyAppearanceUpdated(): void {
  window.dispatchEvent(
    new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { key: SETTINGS_APPEARANCE_KEY } }),
  )
}

function isFontFamilyAvailable(family: string): boolean {
  if (typeof document === 'undefined') return true
  const fontSet = document.fonts
  if (fontSet == null || typeof fontSet.check !== 'function') return true
  return fontSet.check(`14px "${family}"`)
}

export function isAppearanceFontAvailable(font: string): boolean {
  const meta = FONT_MAP[font]
  if (meta == null) return false
  if (meta.alwaysAvailable) return true
  return meta.availabilityFamilies.some((family) => isFontFamilyAvailable(family))
}

function resolveAppearanceFont(font: string): AppearanceFontMeta {
  const selected = FONT_MAP[font]
  if (selected != null && isAppearanceFontAvailable(font)) return selected
  return FONT_MAP.geist!
}

export function getAppearanceFontOptions(currentFont?: string): Array<{
  label: string
  value: string
  disabled?: boolean
}> {
  return Object.entries(FONT_MAP).map(([value, meta]) => {
    const available = isAppearanceFontAvailable(value)
    const unavailableSelected = currentFont === value && !available
    return {
      value,
      label: available || unavailableSelected ? meta.label : `${meta.label}（未安装）`,
      disabled: !available && !unavailableSelected,
    }
  })
}

function applyAppearance(settings: AppearanceSettings) {
  const root = document.documentElement

  // Font family
  const fontFamily = resolveAppearanceFont(settings.font)
  root.style.setProperty('--font-sans', fontFamily.sans)
  root.style.setProperty('--font-mono', fontFamily.mono)
  root.dataset.fontUnavailable = isAppearanceFontAvailable(settings.font) ? '0' : '1'

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

  // Electron/Chromium owns page zoom. Remove styling left by older builds.
  const zoomPercent = clampUiZoom(settings.uiZoom ?? UI_ZOOM_DEFAULT)
  root.style.removeProperty('--ui-zoom')
  root.style.removeProperty('--ui-zoom-inverse')
  root.style.removeProperty('zoom')
  document.body.style.removeProperty('zoom')
  window.spark?.invoke('window:set-zoom', { zoomPercent }).catch(() => {
    /* ignore IPC errors outside Electron */
  })
}

function clampUiZoom(value: number): number {
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(value / UI_ZOOM_STEP) * UI_ZOOM_STEP))
}

export function patchAppearance(patch: Partial<AppearanceSettings>): void {
  const next = { ...readAppearance(), ...patch }
  if (patch.uiZoom != null) {
    next.uiZoom = clampUiZoom(patch.uiZoom)
  }
  writeAppearance(next)
  applyAppearance(next)
  notifyAppearanceUpdated()
  window.spark
    ?.invoke('settings:set', { category: 'appearance', key: 'data', value: next })
    .catch(() => {
      /* ignore IPC errors */
    })
}

/** Apply appearance CSS variables on mount + changes. Call once in Shell. */
export function useAppearanceEffects() {
  useEffect(() => {
    const syncAppearance = () => {
      applyAppearance(readAppearance())
      syncArcoThemeFromDom()
    }
    syncAppearance()
    window.spark
      ?.invoke('settings:get', { category: 'appearance', key: 'data' })
      .then((res) => {
        if (res?.value == null || typeof res.value !== 'object') return
        const next = {
          ...DEFAULT_APPEARANCE,
          ...(res.value as Partial<AppearanceSettings>),
        }
        next.uiZoom = clampUiZoom(next.uiZoom)
        writeAppearance(next)
        applyAppearance(next)
        notifyAppearanceUpdated()
        syncArcoThemeFromDom()
      })
      .catch(() => {
        /* ignore IPC errors outside Electron */
      })

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === SETTINGS_APPEARANCE_KEY) {
        syncAppearance()
      }
    }

    const onBrowserZoomChanged = (e: Event) => {
      const zoomPercent = (e as CustomEvent<{ zoomPercent?: number }>).detail?.zoomPercent
      if (typeof zoomPercent === 'number') patchAppearance({ uiZoom: zoomPercent })
    }

    window.addEventListener(SETTINGS_UPDATED_EVENT, handler)
    window.addEventListener(BROWSER_ZOOM_CHANGED_EVENT, onBrowserZoomChanged)
    return () => {
      window.removeEventListener(SETTINGS_UPDATED_EVENT, handler)
      window.removeEventListener(BROWSER_ZOOM_CHANGED_EVENT, onBrowserZoomChanged)
    }
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
