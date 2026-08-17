// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildThemeState } from './themeTokens'
import { THEME_PALETTE } from '../theme/LobeThemeProvider'

describe('buildThemeState', () => {
  it('深色主题映射到深色色板并携带主色', () => {
    const state = buildThemeState('dark', '#ff5500')
    expect(state.theme).toBe('dark')
    expect(state.primaryColor).toBe('#ff5500')
    expect(state.tokens.colorPrimary).toBe('#ff5500')
    expect(state.tokens.colorBgLayout).toBe(THEME_PALETTE.dark.bg)
    expect(state.tokens.colorBgContainer).toBe(THEME_PALETTE.dark.panel)
    expect(state.tokens.colorText).toBe(THEME_PALETTE.dark.text)
  })

  it('浅色主题映射到浅色色板', () => {
    const state = buildThemeState('light', '#6366f1')
    expect(state.theme).toBe('light')
    expect(state.tokens.colorBgLayout).toBe(THEME_PALETTE.light.bg)
    expect(state.tokens.colorBorder).toBe(THEME_PALETTE.light.border)
  })

  it('语义状态色（error/success/warning）来自宿主色板', () => {
    const state = buildThemeState('dark', '#6366f1')
    expect(state.tokens.colorError).toBe(THEME_PALETTE.dark.danger)
    expect(state.tokens.colorSuccess).toBe(THEME_PALETTE.dark.success)
    expect(state.tokens.colorWarning).toBe(THEME_PALETTE.dark.warning)
  })

  it('reducedMotion 缺省为 false，fontSize 有数值兜底', () => {
    const state = buildThemeState('light', '#6366f1')
    expect(state.reducedMotion).toBe(false)
    expect(state.fontSize).toBeGreaterThan(0)
  })
})
