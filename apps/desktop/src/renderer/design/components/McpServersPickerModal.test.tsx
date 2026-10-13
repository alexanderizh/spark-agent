// @vitest-environment jsdom

import { type ReactNode, useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerItem } from '@spark/protocol'
import {
  McpServersPickerModal,
  allSelectableMcpIds,
  normalizeMcpSelection,
  resolveMcpSelectionLabel,
  staleMcpSelectionIds,
} from './McpServersPickerModal'

// 轻量替身：仅还原 Modal 的容器语义与 Checkbox 的受控行为，其余透传 children。
vi.mock('@lobehub/ui', () => ({
  Modal: ({ children }: { children?: ReactNode }) => <div className="modal">{children}</div>,
  Checkbox: ({
    checked,
    disabled,
    onChange,
  }: {
    checked?: boolean
    disabled?: boolean
    onChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.checked)}
      data-testid="checkbox"
    />
  ),
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
}))
vi.mock('antd', () => ({
  Input: {
    Search: () => <input type="search" data-testid="search" />,
  },
}))
vi.mock('../Icons', () => ({
  Icons: {
    X: () => <span>x</span>,
    Lock: () => <span>lock</span>,
    Skills: () => <span>s</span>,
  },
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const userServers: McpServerItem[] = [
  {
    id: 'srv-enabled',
    scope: 'user',
    name: 'enabled_mcp',
    configJson: '{}',
    enabled: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'srv-disabled',
    scope: 'user',
    name: 'disabled_mcp',
    configJson: '{}',
    enabled: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
]

describe('staleMcpSelectionIds / allSelectableMcpIds / resolveMcpSelectionLabel', () => {
  it('已删除 server 的 id 判为失效；停用 server 与内置合成 id 不算失效', () => {
    expect(
      staleMcpSelectionIds(
        ['srv-enabled', 'srv-disabled', 'builtin:spark_search', 'ghost-deleted'],
        userServers,
      ),
    ).toEqual(['ghost-deleted'])
    expect(staleMcpSelectionIds([], userServers)).toEqual([])
  })

  it('可选集 = 全部可选内置 + enabled 用户 server（停用 server 不可选但有效）', () => {
    const ids = allSelectableMcpIds(userServers)
    expect(ids).toContain('builtin:spark_platform')
    expect(ids).toContain('builtin:spark_search')
    expect(ids).toContain('srv-enabled')
    expect(ids).not.toContain('srv-disabled')
  })

  it('失效 id 的 chips 预览显示「已删除」标记，正常 id 显示名称', () => {
    expect(resolveMcpSelectionLabel('builtin:spark_search', userServers)).toBe('联网搜索')
    expect(resolveMcpSelectionLabel('srv-enabled', userServers)).toBe('enabled_mcp')
    expect(resolveMcpSelectionLabel('ghost-deleted-abcdef01', userServers)).toMatch(
      /^已删除（ghost-de/,
    )
  })
})

describe('McpServersPickerModal 失效选择分组（T5）', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let onChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    onChange = vi.fn()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container.remove()
    root = null
  })

  function render(selectedIds: string[]): void {
    act(() => {
      root = createRoot(container)
      root.render(
        <McpServersPickerModal
          visible
          userServers={userServers}
          selectedIds={selectedIds}
          onChange={onChange}
          onConfirm={() => {}}
          onClose={() => {}}
        />,
      )
    })
  }

  it('选择集含已删除 server 时渲染「已失效选择」分组并提供单独移除', () => {
    render(['srv-enabled', 'ghost-deleted-1234567890'])
    const html = container.innerHTML
    expect(html).toContain('已失效选择')
    expect(html).toContain('已删除')
    // 移除按钮点击 → onChange 仅剔除该失效 id，保留有效选择
    const removeBtn = container.querySelector<HTMLButtonElement>('.mcp-picker-remove-btn')
    expect(removeBtn).not.toBeNull()
    act(() => {
      removeBtn?.click()
    })
    expect(onChange).toHaveBeenCalledWith(['srv-enabled'])
  })

  it('无失效 id 时不渲染失效分组', () => {
    render(['srv-enabled', 'builtin:spark_search'])
    expect(container.innerHTML).not.toContain('已失效选择')
  })
})

describe('normalizeMcpSelection', () => {
  it('覆盖全部可选项时归一化为 []，部分选择保留显式清单', () => {
    expect(normalizeMcpSelection(allSelectableMcpIds(userServers), userServers)).toEqual([])
    expect(normalizeMcpSelection([], userServers)).toEqual([])
    expect(normalizeMcpSelection(['builtin:spark_search'], userServers)).toEqual([
      'builtin:spark_search',
    ])
  })

  it('失效 id 不参与「覆盖全部」判等，归一化时随空集一并丢弃', () => {
    const ids = [...allSelectableMcpIds(userServers), 'ghost-deleted-abcdef01']
    expect(normalizeMcpSelection(ids, userServers)).toEqual([])
  })
})

describe('McpServersPickerModal 视图态（空选择 = 全部可用，按全勾呈现）', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let latest: string[] = []

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    latest = []
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container.remove()
    root = null
  })

  // 受控宿主：模拟 AgentsView 的 draft 往返，让连续点击能累积到最新选择集。
  function Harness({ initial }: { initial: string[] }): ReactNode {
    const [ids, setIds] = useState<string[]>(initial)
    latest = ids
    return (
      <McpServersPickerModal
        visible
        userServers={userServers}
        selectedIds={ids}
        onChange={setIds}
        onConfirm={() => {}}
        onClose={() => {}}
      />
    )
  }

  function render(initial: string[]): void {
    act(() => {
      root = createRoot(container)
      root.render(<Harness initial={initial} />)
    })
  }

  function clickRow(name: string): void {
    const row = Array.from(container.querySelectorAll<HTMLElement>('.mcp-picker-row')).find((r) =>
      r.textContent?.includes(name),
    )
    if (row == null) throw new Error(`未找到 MCP 行：${name}`)
    act(() => {
      row.click()
    })
  }

  it('空选择时按「全部可用」呈现为全部勾选（停用 server 除外）', () => {
    render([])
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.mcp-picker-row'))
    const boxOf = (row: HTMLElement) =>
      row.querySelector<HTMLInputElement>('[data-testid="checkbox"]')

    // 停用 server 不参与挂载，保持未勾选
    const disabledRow = rows.find((r) => r.textContent?.includes('disabled_mcp'))
    if (disabledRow == null) throw new Error('未找到停用 server 行')
    expect(boxOf(disabledRow)?.checked).toBe(false)

    // 其余可选行（可选档内置 + enabled 用户 server）全部勾选
    const selectableBoxes = rows
      .filter((r) => !r.textContent?.includes('disabled_mcp'))
      .map(boxOf)
      .filter((box): box is HTMLInputElement => box != null)
    expect(selectableBoxes.length).toBeGreaterThan(0)
    expect(selectableBoxes.every((box) => box.checked)).toBe(true)
    expect(container.innerHTML).toContain('全部可用（默认，无需勾选）')
  })

  it('全量模式下取消单项即落为不含该项的显式白名单', () => {
    render([])
    clickRow('enabled_mcp')

    expect(latest).not.toContain('srv-enabled')
    expect(latest).toContain('builtin:spark_search')
    expect(latest.length).toBe(allSelectableMcpIds(userServers).length - 1)
  })

  it('白名单模式下勾满全部可选项归一化回 []（动态全量）', () => {
    render(['srv-enabled'])
    for (const label of [
      '平台管理',
      '插件工具',
      '子应用',
      '多媒体生成',
      '图片生成',
      '浏览器自动化',
      '桌面控制',
      '联网搜索',
    ]) {
      clickRow(label)
    }
    expect(latest).toEqual([])
  })

  it('取消后再勾回，选择集恢复全部即归一化回 []', () => {
    render([])
    clickRow('enabled_mcp')
    expect(latest.length).toBe(allSelectableMcpIds(userServers).length - 1)

    clickRow('enabled_mcp')
    expect(latest).toEqual([])
  })

  it('部分选择模式下按实际清单呈现，未选项不显示为勾选', () => {
    render(['srv-enabled'])
    const checkedCount = Array.from(
      container.querySelectorAll<HTMLInputElement>('[data-testid="checkbox"]'),
    ).filter((box) => box.checked).length
    // 仅 srv-enabled 勾选；表头全选为未全选态，不计入 checked
    expect(checkedCount).toBe(1)
    expect(container.innerHTML).toContain('仅挂载所选')
  })
})
