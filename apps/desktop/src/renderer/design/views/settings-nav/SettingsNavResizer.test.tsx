// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SettingsNavResizer } from './SettingsNavResizer'
import {
  getSettingsNavWidth,
  resetSettingsNavWidthForTest,
  SETTINGS_NAV_WIDTH_BOUNDS,
  SETTINGS_NAV_WIDTH_DEFAULT,
  setSettingsNavWidth,
} from './settingsNavWidth'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function pointerEvent(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, init)
}

describe('设置导航宽度分隔条', () => {
  let container: HTMLDivElement
  let root: Root

  const handle = (): HTMLElement => {
    const el = container.querySelector<HTMLElement>('.settings-nav-resizer')
    if (el == null) throw new Error('分隔条未渲染')
    return el
  }

  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.style.removeProperty('--settings-nav-width')
    resetSettingsNavWidthForTest()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(React.createElement(SettingsNavResizer))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.classList.remove('settings-nav-resizing')
  })

  it('暴露 separator 语义与当前宽度', () => {
    expect(handle().getAttribute('role')).toBe('separator')
    expect(handle().getAttribute('aria-valuenow')).toBe(String(SETTINGS_NAV_WIDTH_DEFAULT))
    expect(handle().getAttribute('aria-valuemin')).toBe(String(SETTINGS_NAV_WIDTH_BOUNDS.min))
    expect(handle().getAttribute('aria-valuemax')).toBe(String(SETTINGS_NAV_WIDTH_BOUNDS.max))
  })

  it('拖拽按水平位移调宽（右移变宽），松手后失效', () => {
    act(() => {
      handle().dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }))
    })
    expect(document.body.classList.contains('settings-nav-resizing')).toBe(true)

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 180 }))
    })
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT + 80)
    expect(handle().getAttribute('aria-valuenow')).toBe(String(SETTINGS_NAV_WIDTH_DEFAULT + 80))

    act(() => {
      window.dispatchEvent(pointerEvent('pointerup', {}))
    })
    expect(document.body.classList.contains('settings-nav-resizing')).toBe(false)

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 500 }))
    })
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT + 80)
  })

  it('拖拽被 clamp 在允许区间内', () => {
    act(() => {
      handle().dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 10_000 }))
    })
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_BOUNDS.max)
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: -10_000 }))
    })
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_BOUNDS.min)
    act(() => {
      window.dispatchEvent(pointerEvent('pointerup', {}))
    })
  })

  it('双击恢复默认宽度', () => {
    act(() => {
      setSettingsNavWidth(320)
    })
    act(() => {
      handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT)
  })

  it('方向键步进 16px，Home / End 跳到两端', () => {
    const press = (key: string) => {
      act(() => {
        handle().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    }
    press('ArrowRight')
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT + 16)
    press('ArrowLeft')
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_DEFAULT)
    press('End')
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_BOUNDS.max)
    press('Home')
    expect(getSettingsNavWidth()).toBe(SETTINGS_NAV_WIDTH_BOUNDS.min)
  })
})
