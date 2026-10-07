// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIDEBAR_FILTER,
  SidebarFilterMenu,
  type SidebarFilterState,
} from './SidebarFilterMenu'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./i18n', () => ({
  useI18n: () => ({
    lang: 'zh',
    t: (key: string) => {
      const map: Record<string, string> = {
        'sidebar.filterSessions': '筛选会话',
        'sidebar.filter.clearFilters': '清除筛选',
        'sidebar.filter.all': '全部',
        'sidebar.filter.allProjects': '全部项目',
        'sidebar.filter.rowStatus': '状态',
        'sidebar.filter.status.active': '活跃',
        'sidebar.filter.status.unread': '未读',
        'sidebar.filter.status.running': '运行中',
        'sidebar.filter.status.completed': '已完成',
        'sidebar.filter.status.cancelled': '中止',
        'sidebar.filter.status.archived': '已归档',
        'sidebar.filter.rowProject': '项目',
        'sidebar.filter.rowLastActivity': '最近活动',
        'sidebar.filter.rowScheduledTasks': '计划任务',
        'sidebar.filter.rowLabels': '标记',
        'sidebar.filter.rowGroupBy': '分组方式',
        'sidebar.filter.rowCanvasProjects': '画布项目',
        'sidebar.filter.labels.labeled': '已标记',
        'sidebar.filter.labels.unlabeled': '未标记',
        'sidebar.label.suspended': '挂起',
        'sidebar.label.notStarted': '未开始',
        'sidebar.label.pendingReview': '待审查',
        'sidebar.label.pendingAdvance': '待推进',
        'sidebar.label.undelivered': '未交付',
      }
      return map[key] ?? key
    },
  }),
}))

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
  getState: () => SidebarFilterState
  getCalls: () => SidebarFilterState[]
}

/**
 * 受控渲染：onChange 返回的新状态会回填到组件，模拟真实筛选器的状态流，
 * 使连续点选可以验证多选累加 / 取消语义。
 */
function renderMenu(onChange?: (next: SidebarFilterState) => void): RenderedMenu {
  let state = DEFAULT_SIDEBAR_FILTER
  const calls: SidebarFilterState[] = []
  const rerender = (): void => {
    act(() => {
      if (root == null) root = createRoot(container)
      root.render(
        <SidebarFilterMenu
          state={state}
          workspaces={[]}
          onChange={(next) => {
            state = next
            calls.push(next)
            onChange?.(next)
            rerender()
          }}
          onClear={() => {}}
        />,
      )
    })
  }
  rerender()
  return { getState: () => state, getCalls: () => calls }
}

function findRowByLabel(label: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.sidebar-filter-row'))
  const row = rows.find((el) => el.textContent?.includes(label))
  if (row == null) throw new Error(`row not found: ${label}`)
  return row
}

async function openFilterPopup(): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>('.sidebar-filter-btn')
  act(() => {
    trigger?.click()
  })
}

async function hoverRowAndOpenSubmenu(rowLabel: string): Promise<void> {
  const row = findRowByLabel(rowLabel)
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }),
    )
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

describe('SidebarFilterMenu 展开后的「状态」行', () => {
  it('状态子菜单包含「未读」选项且位于「活跃」之后', async () => {
    renderMenu()
    await openFilterPopup()

    const statusRow = findRowByLabel('状态')
    expect(statusRow.textContent).toContain('活跃')

    await hoverRowAndOpenSubmenu('状态')

    const texts = Array.from(
      document.querySelectorAll<HTMLElement>('.sidebar-filter-submenu-item'),
    ).map((el) => el.textContent?.trim())
    expect(texts).toEqual(['活跃', '未读', '运行中', '已完成', '中止', '已归档', '全部'])
  })

  it('选择「未读」回调 status: [unread]', async () => {
    const menu = renderMenu()
    await openFilterPopup()
    await hoverRowAndOpenSubmenu('状态')
    act(() => {
      findSubmenuItem('未读').click()
    })
    expect(menu.getState().status).toEqual(['unread'])
  })

  it('连续点选累加、再次点选取消、「全部」清空', async () => {
    const menu = renderMenu()
    await openFilterPopup()
    await hoverRowAndOpenSubmenu('状态')

    act(() => {
      findSubmenuItem('未读').click()
    })
    act(() => {
      findSubmenuItem('已完成').click()
    })
    expect(menu.getState().status).toEqual(['unread', 'completed'])

    act(() => {
      findSubmenuItem('未读').click()
    })
    expect(menu.getState().status).toEqual(['completed'])

    act(() => {
      findSubmenuItem('全部').click()
    })
    expect(menu.getState().status).toEqual([])
  })
})

describe('SidebarFilterMenu 展开后的「标记」行', () => {
  it('打开筛选弹层后能看到「标记」行并展开出 8 个选项', async () => {
    renderMenu()
    await openFilterPopup()

    const labelRow = findRowByLabel('标记')
    expect(labelRow.className).toContain('sidebar-filter-row')
    expect(labelRow.textContent).toContain('全部')

    await hoverRowAndOpenSubmenu('标记')

    const items = Array.from(
      document.querySelectorAll<HTMLElement>('.sidebar-filter-submenu-item'),
    ).filter((el) =>
      ['全部', '已标记', '未标记', '挂起', '未开始', '待审查', '待推进', '未交付'].some((x) =>
        el.textContent?.includes(x),
      ),
    )
    const texts = items.map((el) => el.textContent?.trim())
    expect(texts).toEqual([
      '全部',
      '已标记',
      '未标记',
      '挂起',
      '未开始',
      '待审查',
      '待推进',
      '未交付',
    ])
    // 具体标记带状态色点
    const dots = document.querySelectorAll('.sidebar-filter-submenu-item .session-label-dot')
    expect(dots.length).toBe(5)
  })

  it('选择「待审查」回调 labels: [pending-review]', async () => {
    const menu = renderMenu()
    await openFilterPopup()
    await hoverRowAndOpenSubmenu('标记')
    act(() => {
      findSubmenuItem('待审查').click()
    })
    expect(menu.getState().labels).toEqual(['pending-review'])
  })

  it('未标记与具体标记可共存（OR 语义）', async () => {
    const menu = renderMenu()
    await openFilterPopup()
    await hoverRowAndOpenSubmenu('标记')

    act(() => {
      findSubmenuItem('未标记').click()
    })
    act(() => {
      findSubmenuItem('未交付').click()
    })
    expect(menu.getState().labels).toEqual(['unlabeled', 'undelivered'])
  })
})
