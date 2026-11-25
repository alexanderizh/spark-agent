// @vitest-environment jsdom

/**
 * RemoteSessionFilterMenu 组件测试：行式弹层与本地 SidebarFilterMenu 同构，
 * 交互断言（hover 展开、多选累加/清空、开关、清除全部）沿用其 popover 测试手法。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REMOTE_FILTER, type RemoteSessionFilter } from './remoteSessionFilters'
import { RemoteSessionFilterMenu } from './RemoteSessionFilterMenu'
import type { RemoteProjectRow } from './remoteSessionStore'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECTS: RemoteProjectRow[] = [
  { id: 'p1', name: 'spark-agent', sessionCount: 3, runningCount: 1, kind: 'project' },
  { id: 'p2', name: 'telegram-group-bot', sessionCount: 5, runningCount: 0, kind: 'project' },
  { id: 'default', name: '未归属', sessionCount: 2, runningCount: 0, kind: 'unassigned' },
]

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  // antd Dropdown 子菜单会挂 rc-resize-observer，jsdom 无该全局对象
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
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

interface RenderedMenu {
  getState: () => RemoteSessionFilter
  getCalls: () => RemoteSessionFilter[]
  getClearCalls: () => number
}

/** 受控渲染：onChange 回填状态模拟真实数据流，可验证连续点选的累加/取消语义 */
function renderMenu(initial: RemoteSessionFilter = DEFAULT_REMOTE_FILTER): RenderedMenu {
  let state = initial
  const calls: RemoteSessionFilter[] = []
  let clearCalls = 0
  const rerender = (): void => {
    act(() => {
      if (root == null) root = createRoot(container)
      root.render(
        <RemoteSessionFilterMenu
          filter={state}
          projects={PROJECTS}
          onChange={(next) => {
            state = next
            calls.push(next)
            rerender()
          }}
          onClear={() => {
            state = DEFAULT_REMOTE_FILTER
            clearCalls += 1
            rerender()
          }}
        />,
      )
    })
  }
  rerender()
  return { getState: () => state, getCalls: () => calls, getClearCalls: () => clearCalls }
}

function openFilterPopup(): void {
  const trigger = document.querySelector<HTMLButtonElement>('.rc-icon-btn')
  act(() => {
    trigger?.click()
  })
}

function findRowByLabel(label: string): HTMLElement {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.sidebar-filter-row')).find((el) =>
    el.textContent?.includes(label),
  )
  if (row == null) throw new Error(`row not found: ${label}`)
  return row
}

async function hoverRowAndOpenSubmenu(rowLabel: string): Promise<void> {
  const row = findRowByLabel(rowLabel)
  await act(async () => {
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    // rc-trigger 的 hover 展开带 mouseEnterDelay，需要等一个 tick
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
}

function findSubmenuItem(text: string): HTMLElement {
  const target = Array.from(
    document.querySelectorAll<HTMLElement>('.sidebar-filter-submenu-item'),
  ).find((el) => el.textContent?.trim() === text)
  if (target == null) throw new Error(`submenu item not found: ${text}`)
  return target
}

describe('RemoteSessionFilterMenu 行式弹层', () => {
  it('打开后每个维度收起为一行，默认显示「全部/不限」且清除全部禁用', () => {
    renderMenu()
    openFilterPopup()

    expect(findRowByLabel('状态').textContent).toContain('全部')
    expect(findRowByLabel('项目').textContent).toContain('全部项目')
    expect(findRowByLabel('最近活动').textContent).toContain('不限')
    expect(findRowByLabel('标记').textContent).toContain('全部')
    expect(document.querySelector('.sidebar-filter-setting-label')?.textContent).toBe('只看置顶')

    const clear = document.querySelector<HTMLButtonElement>('.sidebar-filter-clear')
    expect(clear?.textContent).toBe('清除全部')
    expect(clear?.disabled).toBe(true)
  })

  it('选了筛选后行值高亮、清除全部可用且回调 onClear', () => {
    const menu = renderMenu({ ...DEFAULT_REMOTE_FILTER, statuses: ['running'] })
    openFilterPopup()

    const statusValue = findRowByLabel('状态').querySelector('.sidebar-filter-row-value')
    expect(statusValue?.className).toContain('is-highlight')
    expect(statusValue?.textContent).toBe('运行中')

    const clear = document.querySelector<HTMLButtonElement>('.sidebar-filter-clear')
    expect(clear?.disabled).toBe(false)
    act(() => {
      clear?.click()
    })
    expect(menu.getClearCalls()).toBe(1)
    expect(menu.getState()).toEqual(DEFAULT_REMOTE_FILTER)
  })
})

describe('RemoteSessionFilterMenu 状态维度（多选）', () => {
  it('子菜单为「全部 + 五个状态」，点选回调 statuses', async () => {
    const menu = renderMenu()
    openFilterPopup()
    await hoverRowAndOpenSubmenu('状态')

    const texts = Array.from(
      document.querySelectorAll<HTMLElement>('.sidebar-filter-submenu-item'),
    ).map((el) => el.textContent?.trim())
    expect(texts).toEqual(['全部', '运行中', '空闲', '已完成', '已取消', '失败'])

    act(() => {
      findSubmenuItem('运行中').click()
    })
    expect(menu.getState().statuses).toEqual(['running'])
  })

  it('连续点选累加、再次点选取消、「全部」清空', async () => {
    const menu = renderMenu()
    openFilterPopup()
    await hoverRowAndOpenSubmenu('状态')

    act(() => {
      findSubmenuItem('运行中').click()
    })
    act(() => {
      findSubmenuItem('失败').click()
    })
    expect(menu.getState().statuses).toEqual(['running', 'error'])

    act(() => {
      findSubmenuItem('运行中').click()
    })
    expect(menu.getState().statuses).toEqual(['error'])

    act(() => {
      findSubmenuItem('全部').click()
    })
    expect(menu.getState().statuses).toEqual([])
  })
})

describe('RemoteSessionFilterMenu 项目维度（多选，含未归属）', () => {
  it('子菜单列出全部项目行，点选回调 projectIds，行值显示项目名', async () => {
    const menu = renderMenu()
    openFilterPopup()
    await hoverRowAndOpenSubmenu('项目')

    act(() => {
      findSubmenuItem('spark-agent').click()
    })
    expect(menu.getState().projectIds).toEqual(['p1'])
    expect(findRowByLabel('项目').textContent).toContain('spark-agent')
  })

  it('「全部项目」清空选择', async () => {
    const menu = renderMenu({ ...DEFAULT_REMOTE_FILTER, projectIds: ['p1', 'default'] })
    openFilterPopup()
    await hoverRowAndOpenSubmenu('项目')

    // 多选行值文案：「首个 +N」
    expect(findRowByLabel('项目').textContent).toContain('spark-agent +1')

    act(() => {
      findSubmenuItem('全部项目').click()
    })
    expect(menu.getState().projectIds).toEqual([])
  })
})

describe('RemoteSessionFilterMenu 其余维度', () => {
  it('最近活动单选：点「今天」回调 activity，且替换而非累加', async () => {
    const menu = renderMenu()
    openFilterPopup()
    await hoverRowAndOpenSubmenu('最近活动')

    act(() => {
      findSubmenuItem('今天').click()
    })
    expect(menu.getState().activity).toBe('today')

    act(() => {
      findSubmenuItem('近 7 天').click()
    })
    expect(menu.getState().activity).toBe('7d')
  })

  it('只看置顶开关回调 pinnedOnly', () => {
    const menu = renderMenu()
    openFilterPopup()

    const settingRow = document.querySelector<HTMLElement>('.sidebar-filter-setting')
    const switchInput = settingRow?.querySelector<HTMLInputElement>(
      'button[role="switch"], input[type="checkbox"]',
    )
    act(() => {
      switchInput?.click()
    })
    expect(menu.getState().pinnedOnly).toBe(true)
  })

  it('标记子菜单：未标记在前、具体标记带色点', async () => {
    const menu = renderMenu()
    openFilterPopup()
    await hoverRowAndOpenSubmenu('标记')

    act(() => {
      findSubmenuItem('未标记').click()
    })
    expect(menu.getState().labels).toEqual(['unlabeled'])

    const dots = document.querySelectorAll('.sidebar-filter-submenu-item .session-label-dot')
    expect(dots.length).toBe(5)
  })
})
