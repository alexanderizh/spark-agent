// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from './ContextMenu'
import { isContextMenuOpen, type ContextMenuEntry } from './contextMenuModel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderMenu(root: Root, items: ContextMenuEntry[], onClose = vi.fn(), x = 40, y = 60) {
  act(() => root.render(<ContextMenu x={x} y={y} items={items} onClose={onClose} />))
  return onClose
}

function menuEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.context-action-menu')
}

function itemButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.action-menu-item')).find(
      (button) => button.textContent === label,
    ) ?? null
  )
}

describe('ContextMenu', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('渲染在 body 上的浮层里（不受容器 overflow / transform 影响），按点击坐标定位', () => {
    renderMenu(root, [{ key: 'copy', label: '复制图片', onClick: vi.fn() }])

    const menu = menuEl()
    expect(menu).not.toBeNull()
    expect(menu?.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
    expect(menu?.style.left).toBe('40px')
    expect(menu?.style.top).toBe('60px')
    expect(menu?.getAttribute('role')).toBe('menu')
    expect(isContextMenuOpen()).toBe(true)
  })

  it('靠近视口右下角时向内收敛，不溢出窗口', () => {
    renderMenu(root, [{ key: 'copy', label: '复制图片' }], vi.fn(), 2000, 2000)

    const menu = menuEl()
    expect(menu?.style.left).toBe(`${window.innerWidth - 8}px`)
    expect(menu?.style.top).toBe(`${window.innerHeight - 8}px`)
  })

  it('点击条目先关闭菜单再执行动作；禁用条目不触发', () => {
    const onClick = vi.fn()
    const onDisabled = vi.fn()
    const onClose = renderMenu(root, [
      { key: 'ok', label: '查看大图', onClick },
      { key: 'off', label: '不可用', disabled: true, onClick: onDisabled },
      { type: 'divider' },
      { key: 'del', label: '删除任务', danger: true, onClick: vi.fn() },
    ])

    expect(document.querySelector('.action-menu-divider')).not.toBeNull()
    expect(itemButton('删除任务')?.classList.contains('danger')).toBe(true)

    act(() => itemButton('不可用')?.click())
    expect(onDisabled).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    act(() => itemButton('查看大图')?.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('菜单外 mousedown 关闭，菜单内 mousedown 不关闭', () => {
    const onClose = renderMenu(root, [{ key: 'copy', label: '复制图片' }])

    act(() => menuEl()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()

    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc 只关菜单并吞掉事件，不会顺带关掉下层弹层', () => {
    const onClose = renderMenu(root, [{ key: 'copy', label: '复制图片' }])
    const lowerLayer = vi.fn()
    document.addEventListener('keydown', lowerLayer)

    const target = document.createElement('div')
    document.body.appendChild(target)
    act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    document.removeEventListener('keydown', lowerLayer)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(lowerLayer).not.toHaveBeenCalled()
  })

  it('↑/↓ 移动高亮、Enter 执行高亮项，方向键不会漏给下层', () => {
    const first = vi.fn()
    const second = vi.fn()
    const onClose = renderMenu(root, [
      { key: 'a', label: '查看大图', onClick: first },
      { key: 'b', label: '复用配置', onClick: second },
    ])
    const lowerLayer = vi.fn()
    document.addEventListener('keydown', lowerLayer)

    const press = (key: string) => {
      const target = document.createElement('div')
      document.body.appendChild(target)
      act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
      target.remove()
    }

    press('ArrowDown')
    expect(itemButton('查看大图')?.classList.contains('is-active')).toBe(true)

    press('ArrowDown')
    expect(itemButton('复用配置')?.classList.contains('is-active')).toBe(true)

    // 到底后回环到第一项
    press('ArrowDown')
    expect(itemButton('查看大图')?.classList.contains('is-active')).toBe(true)

    press('ArrowUp')
    expect(itemButton('复用配置')?.classList.contains('is-active')).toBe(true)

    press('Enter')
    document.removeEventListener('keydown', lowerLayer)

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(lowerLayer).not.toHaveBeenCalled()
  })

  it('↑/↓ 跳过禁用项与分割线', () => {
    renderMenu(root, [
      { key: 'off', label: '不可用', disabled: true },
      { type: 'divider' },
      { key: 'b', label: '复用配置' },
    ])

    act(() =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    )
    expect(itemButton('复用配置')?.classList.contains('is-active')).toBe(true)
  })
})
