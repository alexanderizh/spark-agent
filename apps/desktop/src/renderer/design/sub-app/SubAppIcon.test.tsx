// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubAppIcon } from './SubAppIcon'

// 自绘图标集用 Proxy mock，便于通过 data-icon 断言解析结果；
// lucide-react 不 mock，验证受控图标真实渲染出 SVG。
vi.mock('../Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get:
        (_target: unknown, prop: string) =>
        ({ size }: { size?: number }) =>
          React.createElement('span', { 'data-icon': prop, 'data-size': size }),
    },
  ),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SubAppIcon', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function renderIcon(icon: string | null | undefined): HTMLElement {
    act(() => {
      root.render(<SubAppIcon icon={icon} size={20} />)
    })
    return container.firstElementChild as HTMLElement
  }

  it('builtin: 受控图标渲染为 SVG 且描边与全局图标体系一致', () => {
    const el = renderIcon('builtin:list-todo')
    expect(el.tagName).toBe('svg')
    expect(el.getAttribute('stroke-width')).toBe('1.6')
  })

  it('不带前缀的受控 key 与历史别名均可解析', () => {
    expect(renderIcon('list-todo').tagName).toBe('svg')
    expect(renderIcon('todo').tagName).toBe('svg')
    expect(renderIcon('reading').tagName).toBe('svg')
    expect(renderIcon('builtin:app-window').getAttribute('data-icon')).toBe('AppWindow')
  })

  it('自绘 canvas 图标仍走 Icons.Canvas 渲染', () => {
    expect(renderIcon('builtin:canvas').getAttribute('data-icon')).toBe('Canvas')
  })

  it('未知说明文本回退为默认应用图标', () => {
    expect(renderIcon('to do').getAttribute('data-icon')).toBe('AppWindow')
    expect(renderIcon('随便一句说明').getAttribute('data-icon')).toBe('AppWindow')
  })

  it('短 Emoji 仅作为历史数据保留兼容渲染', () => {
    const el = renderIcon('📊')
    expect(el.tagName).toBe('SPAN')
    expect(el.getAttribute('role')).toBe('img')
    expect(el.textContent).toBe('📊')
  })

  it('空值渲染默认应用图标', () => {
    expect(renderIcon(null).getAttribute('data-icon')).toBe('AppWindow')
    expect(renderIcon(undefined).getAttribute('data-icon')).toBe('AppWindow')
    expect(renderIcon('  ').getAttribute('data-icon')).toBe('AppWindow')
  })
})
