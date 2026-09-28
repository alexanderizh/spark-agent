// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getSettingsNavWidth,
  resetSettingsNavWidthForTest,
  SETTINGS_NAV_WIDTH_BOUNDS,
  SETTINGS_NAV_WIDTH_DEFAULT,
  setSettingsNavWidth,
} from './settingsNavWidth'

const WIDTH_KEY = 'spark-agent:settings-nav-width'
const CSS_VAR = '--settings-nav-width'

function readVar(): string {
  return document.documentElement.style.getPropertyValue(CSS_VAR)
}

function clearAll(): void {
  window.localStorage.clear()
  document.documentElement.style.removeProperty(CSS_VAR)
  resetSettingsNavWidthForTest()
}

beforeEach(clearAll)
afterEach(clearAll)

describe('设置导航宽度', () => {
  it('未写入过偏好时用默认宽度 240，且不下发内联变量', () => {
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT)
    expect(readVar()).toBe('')
  })

  it('写入根节点 CSS 变量，让导航与设置页标题栏渐变拼同一份宽度', () => {
    setSettingsNavWidth(320)
    expect(getSettingsNavWidth()).toBe(320)
    expect(readVar()).toBe('320px')
  })

  it('调整后落盘，重新读取仍记得该宽度', () => {
    setSettingsNavWidth(320)
    resetSettingsNavWidthForTest()
    expect(getSettingsNavWidth()).toBe(320)
    expect(readVar()).toBe('320px')
  })

  it('clamp 到 [200, 460]', () => {
    setSettingsNavWidth(10)
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_BOUNDS.min)
    setSettingsNavWidth(9_999)
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_BOUNDS.max)
  })

  it('脏值回退默认宽度', () => {
    window.localStorage.setItem(WIDTH_KEY, 'abc')
    resetSettingsNavWidthForTest()
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT)
  })

  it('拖回默认宽度时清掉内联变量，让 styles.css 继续充当默认来源', () => {
    setSettingsNavWidth(320)
    expect(readVar()).toBe('320px')
    setSettingsNavWidth(SETTINGS_NAV_WIDTH_DEFAULT)
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT)
    expect(readVar()).toBe('')
  })

  it('宽度未变化时不重复写盘', () => {
    setSettingsNavWidth(320)
    window.localStorage.removeItem(WIDTH_KEY)
    setSettingsNavWidth(320)
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull()
  })
})
