// @vitest-environment jsdom

import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from './canvas.types'

const mocks = vi.hoisted(() => ({
  openSnapshot: vi.fn(async () => ({ assets: [] })),
}))

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    loading: _loading,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean
    icon?: React.ReactNode
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

vi.mock('antd', () => ({
  Modal: ({
    open,
    title,
    children,
    onCancel,
  }: {
    open: boolean
    title?: React.ReactNode
    children?: React.ReactNode
    onCancel?: () => void
  }) =>
    open ? (
      <div role="dialog">
        <span>{title}</span>
        {children}
        <button type="button" aria-label="关闭封面预览" onClick={onCancel}>
          关闭
        </button>
      </div>
    ) : null,
  Spin: () => <span>loading</span>,
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('./canvas.api', () => ({ canvasApi: { openSnapshot: mocks.openSnapshot } }))

import { CanvasProjectDetail } from './CanvasProjectDetail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseProject: CanvasProject = {
  id: 'project-1',
  userId: 0,
  title: '电影项目',
  status: 'active',
  coverUrl: 'safe-file://project/cover.png',
  nodeCount: 3,
  assetCount: 2,
  taskCount: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
}

let container: HTMLDivElement
let root: Root

const renderDetail = async (project: CanvasProject, onUploadCover = vi.fn()) => {
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
        onUploadCover={onUploadCover}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('CanvasProjectDetail project cover', () => {
  it('renders one decorative cover layer and one complete foreground image', async () => {
    await renderDetail(baseProject)
    const ambient = container.querySelector<HTMLImageElement>('.canvas-detail-cover-ambient')
    const foreground = container.querySelector<HTMLImageElement>('.canvas-detail-cover-image')
    expect(ambient?.getAttribute('src')).toBe('safe-file://project/cover.png')
    expect(ambient?.alt).toBe('')
    expect(foreground?.getAttribute('src')).toBe('safe-file://project/cover.png')
    expect(foreground?.alt).toBe('电影项目')
  })

  it('opens preview from the cover and keeps replacement as a separate action', async () => {
    await renderDetail(baseProject)
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const clickFileInput = vi.spyOn(fileInput!, 'click')

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="查看项目封面：电影项目"]')
        ?.click(),
    )
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(clickFileInput).not.toHaveBeenCalled()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="更换项目封面"]')?.click(),
    )
    expect(clickFileInput).toHaveBeenCalledOnce()
  })

  it('keeps the empty cover as the upload entry', async () => {
    await renderDetail({ ...baseProject, coverUrl: null })
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const clickFileInput = vi.spyOn(fileInput!, 'click')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="上传项目封面"]')?.click(),
    )
    expect(clickFileInput).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('falls back to the upload entry when the foreground image fails', async () => {
    await renderDetail(baseProject)
    const foreground = container.querySelector<HTMLImageElement>('.canvas-detail-cover-image')
    await act(async () => foreground?.dispatchEvent(new Event('error')))
    expect(container.textContent).toContain('封面加载失败，点击重新上传')
    expect(container.querySelector('[aria-label="上传项目封面"]')).not.toBeNull()
  })

  it('keeps pin and more actions out of the cover', async () => {
    await renderDetail(baseProject)
    const cover = container.querySelector('.canvas-detail-cover')
    const headerActions = container.querySelector('.canvas-detail-header-right')
    expect(cover?.querySelector('[aria-label="置顶"]')).toBeNull()
    expect(cover?.querySelector('[aria-label="更多项目操作"]')).toBeNull()
    expect(headerActions?.querySelector('[aria-label="置顶"]')).not.toBeNull()
    expect(headerActions?.querySelector('[aria-label="更多项目操作"]')).not.toBeNull()
  })
})

describe('CanvasProjectDetail cover styles', () => {
  const styles = readFileSync(
    resolve(process.cwd(), 'src/renderer/design/views/canvas/uiux-v4/projects.less'),
    'utf8',
  )

  it('contains the ambient layer, contain foreground and responsive height', () => {
    expect(styles).toContain('.canvas-detail-cover-ambient')
    expect(styles).toMatch(/\.canvas-detail-cover-image\s*\{[\s\S]*?object-fit:\s*contain/)
    expect(styles).toContain('@media (max-width: 720px)')
    expect(styles).toContain('height: 180px')
  })

  it('supports reduced motion', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('.canvas-detail-cover-toolbar')
  })
})
