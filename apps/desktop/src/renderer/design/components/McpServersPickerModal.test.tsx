// @vitest-environment jsdom

import { type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerItem } from '@spark/protocol'
import {
  McpServersPickerModal,
  allSelectableMcpIds,
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
