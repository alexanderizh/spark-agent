// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkinPicker } from './SkinPicker'
import { APP_SKINS, type AppSkinId } from '../skins/skinRegistry'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('SkinPicker', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  })

  function renderPicker(value: AppSkinId, onChange: (id: AppSkinId) => void) {
    act(() => {
      const nextRoot = createRoot(container)
      nextRoot.render(<SkinPicker value={value} onChange={onChange} />)
      root = nextRoot
    })
  }

  function cards(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('.skin-picker-card'))
  }

  it('renders one accessible card per registered skin, in registry order', () => {
    renderPicker('verdant', () => {})
    const rendered = cards()
    expect(rendered).toHaveLength(APP_SKINS.length)
    // 按子元素分别断言：名称与描述是两个独立 span，拼 textContent 会得到无分隔的连串。
    expect(
      rendered.map((card) => ({
        name: card.querySelector('.skin-picker-name')?.textContent,
        desc: card.querySelector('.skin-picker-desc')?.textContent,
      })),
    ).toEqual(APP_SKINS.map((skin) => ({ name: skin.name, desc: skin.description })))
    // 卡片必须是原生 button：键盘可达、读屏可念，不能是可点击的 div。
    expect(rendered.every((card) => card.tagName === 'BUTTON')).toBe(true)
  })

  it('marks only the active skin with aria-pressed', () => {
    renderPicker('dawnmelt', () => {})
    const pressed = cards().map((card) => card.getAttribute('aria-pressed'))
    // 只允许一个选中态，不写死注册表长度与位置。
    expect(pressed.filter((state) => state === 'true')).toHaveLength(1)
    const dawnmeltIndex = APP_SKINS.findIndex((skin) => skin.id === 'dawnmelt')
    expect(cards()[dawnmeltIndex]?.getAttribute('aria-pressed')).toBe('true')
  })

  it('reports the clicked skin id to the caller', () => {
    const onChange = vi.fn()
    renderPicker('none', onChange)
    const dawnmeltIndex = APP_SKINS.findIndex((skin) => skin.id === 'dawnmelt')
    const target = cards()[dawnmeltIndex]
    if (target == null) throw new Error('Dawnmelt card missing')
    act(() => {
      click(target)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('dawnmelt')
  })

  it('exposes the skin section as a labelled group', () => {
    renderPicker('none', () => {})
    const group = container.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBeTruthy()
  })
})
