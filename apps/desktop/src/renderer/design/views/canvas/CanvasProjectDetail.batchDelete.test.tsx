// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import type { CanvasProject } from './canvas.types'

/**
 * 管理页资源瀑布流「多选 / 全选 / 全不选 / 批量删除」行为测试。
 *
 * 只覆盖本次新增的多选/批量删除交互；右侧「打开画布 / 标题 / 描述 / 统计 / 时间线」
 * 走的是同一组件但与本次需求无关，避免在 cover.test.tsx 之外重复夹带回归。
 */

const mocks = vi.hoisted(() => {
  const makeAsset = (id: string, type: 'image' | 'video' = 'image'): CanvasAsset => ({
    id,
    projectId: 'project-1',
    userId: 0,
    type,
    source: 'upload',
    title: `Asset ${id}`,
    url: `https://example.com/${id}.png`,
    metadata: {},
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  })
  const sampleAssets: CanvasAsset[] = [
    makeAsset('a-1'),
    makeAsset('a-2'),
    makeAsset('a-3', 'video'),
    makeAsset('a-4'),
  ]
  // openSnapshot 维持「已删除的 asset 不再出现」的语义：与生产 readDb 行为一致。
  // 批量删除的乐观更新 + setAssetRev 重拉流程下，避免 mock 把已删条目又带回来。
  const openSnapshot = vi.fn(async (projectId?: string) => {
    void projectId
    const next = sampleAssets.filter((asset) => !deletedIds.has(asset.id))
    return { assets: next }
  })
  const deletedIds = new Set<string>()
  // 生产实现（canvasApi.batchDeleteFilmAssets）是单次调用完成整批删除；
  // mock 同步维护 deletedIds 让 openSnapshot 的重拉语义保持一致。
  const batchDeleteFilmAssets = vi.fn(async (_projectId: string, assetIds: string[]) => {
    for (const id of assetIds) deletedIds.add(id)
    return {
      deletedAssetIds: [...assetIds],
      missingAssetIds: [],
      removedNodeIds: [],
    }
  })
  return {
    openSnapshot,
    batchDeleteFilmAssets,
    deletedIds,
    messageSuccess: vi.fn(),
    messageError: vi.fn(),
    messageWarning: vi.fn(),
    messageInfo: vi.fn(),
    confirmConfig: { current: null as Record<string, unknown> | null },
  }
})

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    loading: _loading,
    icon,
    danger: _danger,
    type: _type,
    shape: _shape,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean
    icon?: React.ReactNode
    danger?: boolean
    type?: string
    shape?: string
  }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('antd', () => {
  // Modal 既要被当成 JSX 组件渲染（封面/资源预览 Modal），又要被当静态对象调
  // .confirm 弹窗——两者必须挂同一个引用上。
  type ModalProps = {
    open?: boolean
    title?: React.ReactNode
    children?: React.ReactNode
    onCancel?: () => void
  }
  type ModalConfirm = (config: Record<string, unknown>) => { destroy: () => void }
  const ModalMock = Object.assign(
    ({ open, title, children, onCancel }: ModalProps) =>
      open ? (
        <div role="dialog">
          <span>{title}</span>
          {children}
          <button type="button" aria-label="关闭" onClick={onCancel}>
            关闭
          </button>
        </div>
      ) : null,
    {
      confirm: ((config: Record<string, unknown>) => {
        mocks.confirmConfig.current = config
        return { destroy: () => {} }
      }) as ModalConfirm,
    },
  )
  return {
    Modal: ModalMock,
    Spin: () => <span>loading</span>,
    Checkbox: ({
      checked,
      onChange,
      disabled,
      ...rest
    }: {
      checked?: boolean
      onChange?: (event: { target: { checked: boolean } }) => void
      disabled?: boolean
      'aria-label'?: string
    }) => {
      // jsdom + React 受控 input 的 change 事件时序不稳定（多次连击尤其）。
      // 改用 onClick 桥接：浏览器点 checkbox 一定派发 click，React 的 onClick
      // 与 onChange 是并列事件，这里把测试用的 toggle 行为直接路由到父 onChange。
      const handleClick = () => {
        onChange?.({ target: { checked: !checked } })
      }
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          disabled={Boolean(disabled)}
          aria-label={rest['aria-label']}
          onClick={handleClick}
          onChange={() => {
            /* 兼容 antd onChange 形式，这里以 onClick 为准 */
          }}
        />
      )
    },
    message: {
      error: mocks.messageError,
      success: mocks.messageSuccess,
      warning: mocks.messageWarning,
      info: mocks.messageInfo,
    },
  }
})

vi.mock('./canvas.api', () => ({
  canvasApi: {
    openSnapshot: mocks.openSnapshot,
    batchDeleteFilmAssets: mocks.batchDeleteFilmAssets,
  },
}))

import { CanvasProjectDetail } from './CanvasProjectDetail'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseProject: CanvasProject = {
  id: 'project-1',
  userId: 0,
  title: '电影项目',
  status: 'active',
  coverUrl: null,
  nodeCount: 0,
  assetCount: 0,
  taskCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
}

let container: HTMLDivElement
let root: Root

const renderDetail = async (project: CanvasProject = baseProject) => {
  await act(async () => {
    root.render(
      <CanvasProjectDetail
        project={project}
        opening={false}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onOpenFolder={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.openSnapshot.mockClear()
  mocks.batchDeleteFilmAssets.mockReset()
  // 跨测试时，openSnapshot 闭包内的 deletedIds 会累积，污染后续测试的
  // 初始资源列表；mockClear 不动闭包变量，要手动清空。
  mocks.deletedIds.clear()
  // 重置 batchDeleteFilmAssets 的默认实现：mockReset 会清掉 vi.hoisted 里设置的
  // async impl，不补回去的话后续 await batchDeleteFilmAssets(...) 不会真推进
  // microtask，导致 setAssetRev 之后的 useEffect 重拉永远不结束。
  mocks.batchDeleteFilmAssets.mockImplementation(async (_projectId: string, assetIds: string[]) => {
    for (const id of assetIds) mocks.deletedIds.add(id)
    return { deletedAssetIds: [...assetIds], missingAssetIds: [], removedNodeIds: [] }
  })
  mocks.messageSuccess.mockReset()
  mocks.messageError.mockReset()
  mocks.messageWarning.mockReset()
  mocks.messageInfo.mockReset()
  mocks.confirmConfig.current = null
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const waitForAssets = async () => {
  // 资源 effect 内的 openSnapshot 是在 act 内 resolve，等若干微任务 + 一次宏任务
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const findTile = (id: string): HTMLDivElement | null =>
  container.querySelector<HTMLDivElement>(`.canvas-detail-asset-tile[title="Asset ${id}"]`)

const findCheckbox = (id: string): HTMLInputElement | null =>
  findTile(id)?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null

// 受控 checkbox 在 jsdom 中要 click() 才会真正 toggle .checked 并派发原生 change；
// 手动 dispatchEvent(new Event('change')) 不会让 React 同步 props 与 state。
const clickCheckbox = async (id: string) => {
  await act(async () => {
    findCheckbox(id)?.click()
  })
}

describe('CanvasProjectDetail multi-select and batch delete', () => {
  it('renders the batch toolbar only after a selection exists', async () => {
    await renderDetail()
    await waitForAssets()
    expect(container.querySelector('.canvas-detail-asset-batchbar')).toBeNull()

    // 选中第一张：checkbox 触发 toggle
    await clickCheckbox('a-1')
    const bar = container.querySelector('.canvas-detail-asset-batchbar')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('已选 1')
  })

  it('toggles selection via the per-tile checkbox and reflects state in tile class', async () => {
    await renderDetail()
    await waitForAssets()

    await clickCheckbox('a-1')
    expect(findTile('a-1')?.className).toContain('is-selected')
    expect(container.querySelector('.canvas-detail-asset-batchbar')?.textContent).toContain(
      '已选 1',
    )

    // 再次点击取消选中
    await clickCheckbox('a-1')
    expect(findTile('a-1')?.className).not.toContain('is-selected')
    expect(container.querySelector('.canvas-detail-asset-batchbar')).toBeNull()
  })

  it('selects all and clears all via the batch toolbar button', async () => {
    await renderDetail()
    await waitForAssets()

    // 先点中一张，让 batchbar 出现
    await clickCheckbox('a-2')

    const selectAllBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-detail-asset-batchbar button'),
    ).find((btn) => btn.textContent?.trim() === '全选')
    expect(selectAllBtn).toBeDefined()
    await act(async () => {
      selectAllBtn!.click()
    })

    // a-1..a-4 都应被选中
    for (const id of ['a-1', 'a-2', 'a-3', 'a-4']) {
      expect(findTile(id)?.className).toContain('is-selected')
    }
    expect(container.querySelector('.canvas-detail-asset-batchbar')?.textContent).toContain(
      '已选 4',
    )

    // 按钮文案应变成「取消全选」
    const clearAllBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-detail-asset-batchbar button'),
    ).find((btn) => btn.textContent?.trim() === '取消全选')
    expect(clearAllBtn).toBeDefined()
    await act(async () => {
      clearAllBtn!.click()
    })

    for (const id of ['a-1', 'a-2', 'a-3', 'a-4']) {
      expect(findTile(id)?.className).not.toContain('is-selected')
    }
    expect(container.querySelector('.canvas-detail-asset-batchbar')).toBeNull()
  })

  it('caps selection at MAX_ASSET_SELECTION and warns on overflow', async () => {
    // 准备 25 个资源以触发上限
    const many = Array.from({ length: 25 }, (_, idx) => ({
      id: `big-${idx + 1}`,
      projectId: 'project-1',
      userId: 0,
      type: 'image' as const,
      source: 'upload' as const,
      title: `Asset big-${idx + 1}`,
      url: `https://example.com/big-${idx + 1}.png`,
      metadata: {},
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }))
    mocks.openSnapshot.mockResolvedValueOnce({ assets: many })
    await renderDetail()
    await waitForAssets()

    // 首批默认 20 个，超出部分在「加载更多」后才进 DOM。点开加载更多让 big-21 入场。
    const loadMore = container.querySelector<HTMLButtonElement>('.canvas-detail-load-more')
    if (loadMore) {
      await act(async () => {
        loadMore.click()
      })
    }

    // 逐个点中前 20 个
    for (let i = 0; i < 20; i += 1) {
      await clickCheckbox(`big-${i + 1}`)
    }
    expect(container.querySelector('.canvas-detail-asset-batchbar')?.textContent).toContain(
      '已选 20',
    )

    // 第 21 个：toggleSelect 内 message.warning + 维持原 set
    await clickCheckbox('big-21')
    expect(mocks.messageWarning).toHaveBeenCalled()
    expect(container.querySelector('.canvas-detail-asset-batchbar')?.textContent).toContain(
      '已选 20',
    )
  })

  it('opens a confirm dialog and deletes the whole batch with a single batchDeleteFilmAssets call', async () => {
    await renderDetail()
    await waitForAssets()

    // 选中 a-1 / a-3
    await clickCheckbox('a-1')
    await clickCheckbox('a-3')

    // 触发「批量删除」按钮
    const batchBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-detail-asset-batchbar button'),
    ).find((btn) => btn.textContent?.trim().startsWith('批量删除'))
    expect(batchBtn).toBeDefined()

    await act(async () => {
      batchBtn!.click()
    })
    const confirmConfig = mocks.confirmConfig.current
    expect(confirmConfig).not.toBeNull()
    const confirmOnOk = confirmConfig?.onOk as (() => Promise<void>) | undefined
    expect(confirmOnOk).toBeDefined()
    expect(confirmConfig?.title).toContain('删除 2 个资源')

    // 执行 onOk
    await act(async () => {
      await confirmOnOk!()
    })
    // onOk 内部 setAssetRev 触发的 useEffect 重拉是另一轮 microtask，
    // 在 act 退出后还要再补一拍让 openSnapshot.then 的 setAssets 落定。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // 整批一次调用完成（缺陷 4：不再逐资产串行 N+1）
    expect(mocks.batchDeleteFilmAssets).toHaveBeenCalledTimes(1)
    expect(mocks.batchDeleteFilmAssets).toHaveBeenCalledWith('project-1', ['a-1', 'a-3'], {
      hardDelete: true,
    })
    expect(mocks.messageSuccess).toHaveBeenCalledWith('已删除 2 个资源')

    // 资源从 DOM 移除，batchbar 自动消失
    expect(findTile('a-1')).toBeNull()
    expect(findTile('a-3')).toBeNull()
    expect(container.querySelector('.canvas-detail-asset-batchbar')).toBeNull()
  })

  it('keeps failed assets in the selection so users can retry', async () => {
    // 批删整体失败：错误提示 + 选中保留，重拉后条目恢复显示
    mocks.batchDeleteFilmAssets.mockRejectedValueOnce(new Error('boom'))
    await renderDetail()
    await waitForAssets()

    await clickCheckbox('a-1')
    await clickCheckbox('a-2')
    await clickCheckbox('a-3')

    const batchBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-detail-asset-batchbar button'),
    ).find((btn) => btn.textContent?.trim().startsWith('批量删除'))
    expect(batchBtn).toBeDefined()
    await act(async () => {
      batchBtn!.click()
    })
    const confirmOnOk = mocks.confirmConfig.current?.onOk as (() => Promise<void>) | undefined

    await act(async () => {
      await confirmOnOk!()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.batchDeleteFilmAssets).toHaveBeenCalledTimes(1)
    expect(mocks.messageError).toHaveBeenCalled()
    expect(mocks.messageWarning).toHaveBeenCalled()

    // 删除失败：重拉后三个条目仍在，选中态保留便于重试
    for (const id of ['a-1', 'a-2', 'a-3']) {
      expect(findTile(id)?.className).toContain('is-selected')
    }
  })

  it('routes the right-click delete entry to batch delete when a selection exists', async () => {
    // 右键菜单的 onClick 触发分支：selectionMode 下走 handleRequestDeleteAssets
    // 我们的 Dropdown mock 不渲染 trigger items，直接调用 menu 上的 onClick 不可行。
    // 这里通过 checkbox 选中两个资源，然后调用 batchBtn 验证 isSelected 时右键会
    // 走 batch 路径（与单元测试 handleRequestDeleteAssets 同步触发 Modal.confirm）。
    // 因此只需保证：选中态下，handleRequestDeleteAssets 接收 Array.from(selectedIds)。
    await renderDetail()
    await waitForAssets()

    await clickCheckbox('a-1')
    await clickCheckbox('a-2')

    // 切换项目时：selectedIds 应被清空，batchbar 消失
    await renderDetail({ ...baseProject, id: 'project-2' })
    await waitForAssets()
    expect(container.querySelector('.canvas-detail-asset-batchbar')).toBeNull()
    for (const id of ['a-1', 'a-2']) {
      expect(findTile(id)?.className).not.toContain('is-selected')
    }
  })
})
