// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clampPosition, parseStoredPosition, useVoiceHudDrag } from './useVoiceHudDrag'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖 HUD 拖拽定位的两层：
 * - 纯函数：持久化值解析（损坏回落 null）与视口夹取（越界收回、小视口退化贴边）
 * - hook 集成：拖拽位移写入内联 left/top（并摘除 right/bottom 锚）、
 *   松手持久化、挂载恢复时按视口夹取、isDragging 态切换、非左键不拖拽
 */

const STORAGE_KEY = 'spark-agent:voice-hud-position'

describe('parseStoredPosition', () => {
  it('null 与损坏 JSON 回落 null', () => {
    expect(parseStoredPosition(null)).toBeNull()
    expect(parseStoredPosition('not-json')).toBeNull()
  })

  it('字段缺失或非有限数字回落 null', () => {
    expect(parseStoredPosition('{}')).toBeNull()
    expect(parseStoredPosition('{"x":1}')).toBeNull()
    expect(parseStoredPosition('{"x":"a","y":2}')).toBeNull()
    expect(parseStoredPosition('{"x":null,"y":2}')).toBeNull()
    expect(parseStoredPosition('{"x":1e999,"y":2}')).toBeNull()
  })

  it('合法值原样解析', () => {
    expect(parseStoredPosition('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 })
    expect(parseStoredPosition('{"x":-5,"y":0}')).toEqual({ x: -5, y: 0 })
  })
})

describe('clampPosition', () => {
  it('视口内的位置原样保留', () => {
    expect(clampPosition({ x: 100, y: 80 }, 140, 90, 1024, 768)).toEqual({ x: 100, y: 80 })
  })

  it('越界位置收回视口内（含 8px 边距）', () => {
    expect(clampPosition({ x: -50, y: 5000 }, 140, 90, 1024, 768)).toEqual({ x: 8, y: 670 })
    expect(clampPosition({ x: 5000, y: -1 }, 140, 90, 1024, 768)).toEqual({ x: 876, y: 8 })
  })

  it('视口比卡片还小时退化为贴边（margin 处）', () => {
    expect(clampPosition({ x: 30, y: 40 }, 800, 600, 400, 300)).toEqual({ x: 8, y: 8 })
  })
})

let container: HTMLElement | null = null
let root: Root | null = null

function Probe(): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const { isDragging, dragHandlers } = useVoiceHudDrag(ref)
  return <div ref={ref} data-dragging={isDragging ? 'true' : 'false'} {...dragHandlers} />
}

function renderProbe(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<Probe />)
  })
  return container.firstElementChild as HTMLElement
}

function dispatchPointer(element: HTMLElement, type: string, init: MouseEventInit = {}): void {
  act(() => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))
  })
}

describe('useVoiceHudDrag 集成', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    window.localStorage.removeItem(STORAGE_KEY)
  })

  it('拖拽位移写入内联 left/top 并摘除 right/bottom 锚，松手持久化', () => {
    const card = renderProbe()
    // jsdom 无布局：rect 全 0，origin=(0,0)；视口 1024×768，卡片 0×0
    dispatchPointer(card, 'pointerdown', { button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(card, 'pointermove', { clientX: 150, clientY: 120 })

    expect(card.style.left).toBe('50px')
    expect(card.style.top).toBe('20px')
    expect(card.style.right).toBe('auto')
    expect(card.style.bottom).toBe('auto')
    expect(card.dataset.dragging).toBe('true')

    dispatchPointer(card, 'pointerup', { clientX: 150, clientY: 120 })
    expect(card.dataset.dragging).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({ x: 50, y: 20 })
  })

  it('拖拽超视口时夹取；恢复持久化位置时同样夹取', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 5000, y: -50 }))
    const card = renderProbe()
    // 挂载恢复：5000→1016、-50→8（卡片 0×0，视口 1024×768）
    expect(card.style.left).toBe('1016px')
    expect(card.style.top).toBe('8px')

    dispatchPointer(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 })
    dispatchPointer(card, 'pointermove', { clientX: -500, clientY: 2000 })
    // 从恢复位置 (1016, 8) 继续拖：x=1016-500=516（视口内不夹取）、y=8+2000→夹到 760
    expect(card.style.left).toBe('516px')
    expect(card.style.top).toBe('760px')
  })

  it('pointercancel 同样收尾并持久化', () => {
    const card = renderProbe()
    dispatchPointer(card, 'pointerdown', { button: 0, clientX: 10, clientY: 10 })
    dispatchPointer(card, 'pointercancel')
    expect(card.dataset.dragging).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({ x: 0, y: 0 })
  })

  it('非左键按下不进入拖拽', () => {
    const card = renderProbe()
    dispatchPointer(card, 'pointerdown', { button: 2, clientX: 10, clientY: 10 })
    expect(card.dataset.dragging).toBe('false')
  })

  it('未拖拽过不写内联定位（走 CSS 默认锚点）', () => {
    const card = renderProbe()
    expect(card.style.left).toBe('')
    expect(card.style.top).toBe('')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
