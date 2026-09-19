// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaArtifactViewer } from './MediaArtifactViewer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./Toast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}))

const MEDIA = {
  src: 'safe-file:///tmp/output-a.png',
  alt: '生成结果',
  fileName: 'output-a.png',
  filePath: '/tmp/output-a.png',
  type: 'image' as const,
}

function contextMenuElement(): HTMLElement {
  const menu = document.querySelector<HTMLElement>('.context-action-menu')
  if (!menu) throw new Error('右键菜单未渲染')
  return menu
}

describe('MediaArtifactViewer', () => {
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

  it('工具栏提供缩放、复制、下载、所在文件夹，缩放后可重置回适屏', () => {
    act(() => root.render(<MediaArtifactViewer media={MEDIA} onOpenFullscreen={vi.fn()} />))

    expect(document.querySelector('[title="复制图片"]')).not.toBeNull()
    expect(document.querySelector('[title="下载到本地"]')).not.toBeNull()
    expect(document.querySelector('[title="打开产物所在文件夹"]')).not.toBeNull()

    const zoomLabel = () => document.querySelector('.media-artifact-viewer-zoom-level')?.textContent
    expect(zoomLabel()).toBe('100%')

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="放大"]')?.click())
    expect(zoomLabel()).toBe('140%')

    act(() =>
      document.querySelector<HTMLButtonElement>('.media-artifact-viewer-zoom-level')?.click(),
    )
    expect(zoomLabel()).toBe('100%')
  })

  it('有参考图时提供对比开关，左侧输入图右侧输出图；无参考图时不渲染入口', () => {
    act(() =>
      root.render(
        <MediaArtifactViewer media={MEDIA} inputImage={{ src: 'safe-file:///tmp/input.png' }} />,
      ),
    )

    act(() => document.querySelector<HTMLButtonElement>('[title="并排查看输入与输出"]')?.click())
    const stage = document.querySelector('.media-artifact-viewer-stage.is-compare')
    expect(stage).not.toBeNull()
    const panes = stage?.querySelectorAll('.media-artifact-compare-pane img')
    expect(panes?.length).toBe(2)
    expect(panes?.[0]?.getAttribute('src')).toBe('safe-file:///tmp/input.png')
    expect(panes?.[1]?.getAttribute('src')).toBe(MEDIA.src)

    act(() => root.unmount())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => root.render(<MediaArtifactViewer media={MEDIA} />))
    expect(document.querySelector('[title="并排查看输入与输出"]')).toBeNull()
  })

  it('翻页插槽在多图时渲染并可切换，大图入口透传回调', () => {
    const onOpenFullscreen = vi.fn()
    act(() =>
      root.render(
        <MediaArtifactViewer
          media={MEDIA}
          pagination={{ index: 1, total: 3, onPrev: vi.fn(), onNext: vi.fn() }}
          onOpenFullscreen={onOpenFullscreen}
        />,
      ),
    )

    expect(document.querySelector('[title="并排查看输入与输出"]')).toBeNull()
    expect(document.body.textContent).toContain('2 / 3')
    expect(document.querySelector('[aria-label="上一项输出"]')).not.toBeNull()

    act(() => document.querySelector<HTMLButtonElement>('[title="打开全屏大图预览"]')?.click())
    expect(onOpenFullscreen).toHaveBeenCalledTimes(1)
  })

  it('多图时工具栏翻页区带出当前项归属标签', () => {
    act(() =>
      root.render(
        <MediaArtifactViewer
          media={MEDIA}
          pagination={{
            index: 0,
            total: 3,
            onPrev: vi.fn(),
            onNext: vi.fn(),
            label: '清晨窗边的静物',
          }}
        />,
      ),
    )

    expect(document.querySelector('.media-artifact-viewer-pager-label')?.textContent).toBe(
      '清晨窗边的静物',
    )
    expect(document.querySelector('[title="下一项（→）"]')).not.toBeNull()
    expect(document.querySelector('[title="上一项（←）"]')).not.toBeNull()
  })

  it('多图时键盘 ←/→ 翻页；输入框内与组合键不抢键', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    act(() =>
      root.render(
        <MediaArtifactViewer media={MEDIA} pagination={{ index: 0, total: 3, onPrev, onNext }} />,
      ),
    )

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    expect(onNext).toHaveBeenCalledTimes(1)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
    expect(onPrev).toHaveBeenCalledTimes(1)

    // 组合键交给全局快捷键 / 编辑器
    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true })),
    )
    expect(onNext).toHaveBeenCalledTimes(1)

    // 焦点在输入框时方向键归光标所有
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('单页不接管方向键，keyboardPaging=false 时交给上层', () => {
    const onNext = vi.fn()
    act(() =>
      root.render(
        <MediaArtifactViewer
          media={MEDIA}
          pagination={{ index: 0, total: 1, onPrev: vi.fn(), onNext }}
        />,
      ),
    )
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    expect(onNext).not.toHaveBeenCalled()

    act(() =>
      root.render(
        <MediaArtifactViewer
          media={MEDIA}
          pagination={{ index: 0, total: 3, onPrev: vi.fn(), onNext }}
          keyboardPaging={false}
        />,
      ),
    )
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
    expect(onNext).not.toHaveBeenCalled()
  })

  it('键盘 ↑/↓ 缩放：与工具栏同档位，触顶触底夹住，组合键与输入框不抢键', () => {
    act(() => root.render(<MediaArtifactViewer media={MEDIA} />))
    const zoomLabel = () => document.querySelector('.media-artifact-viewer-zoom-level')?.textContent
    expect(zoomLabel()).toBe('100%')

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe('140%')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })))
    expect(zoomLabel()).toBe('100%')

    // 触底：适屏状态继续缩小不再变化
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })))
    expect(zoomLabel()).toBe('100%')

    // 触顶：连续放大被 800% 夹住
    for (let i = 0; i < 12; i += 1) {
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    }
    expect(zoomLabel()).toBe('800%')

    // 组合键交给全局快捷键 / 编辑器
    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true })),
    )
    expect(zoomLabel()).toBe('800%')

    // 焦点在输入框时方向键归光标所有
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    )
    expect(zoomLabel()).toBe('800%')
  })

  it('对比模式与 keyboardZoom=false 时不接管 ↑/↓', () => {
    act(() =>
      root.render(
        <MediaArtifactViewer media={MEDIA} inputImage={{ src: 'safe-file:///tmp/input.png' }} />,
      ),
    )
    const zoomLabel = () => document.querySelector('.media-artifact-viewer-zoom-level')?.textContent

    // 对比模式下缩放对舞台无效（与滚轮缩放同一关闭条件）
    act(() => document.querySelector<HTMLButtonElement>('[title="并排查看输入与输出"]')?.click())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe('100%')

    act(() => document.querySelector<HTMLButtonElement>('[title="退出对比"]')?.click())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe('140%')

    // 上层盖住查看器（如全屏灯箱）时交出键盘
    act(() => root.render(<MediaArtifactViewer media={MEDIA} keyboardZoom={false} />))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe('140%')
  })

  it('被上层弹层盖住时（焦点在别的 dialog 内）不接管 ↑/↓', () => {
    act(() => root.render(<MediaArtifactViewer media={MEDIA} />))
    const zoomLabel = () => document.querySelector('.media-artifact-viewer-zoom-level')?.textContent

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.tabIndex = -1
    document.body.appendChild(dialog)

    act(() => dialog.focus())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe('100%')

    // 键盘回到查看器所在层级后恢复缩放
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe('140%')
  })

  it('查看器位于自己所在的弹层内时仍可 ↑/↓ 缩放（不误判为被盖住）', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.tabIndex = -1
    const inner = document.createElement('div')
    dialog.appendChild(inner)
    document.body.appendChild(dialog)
    const dialogRoot = createRoot(inner)

    try {
      act(() => dialogRoot.render(<MediaArtifactViewer media={MEDIA} />))
      act(() => dialog.focus())
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
      expect(document.querySelector('.media-artifact-viewer-zoom-level')?.textContent).toBe('140%')
    } finally {
      act(() => dialogRoot.unmount())
      dialog.remove()
    }
  })

  it('视频产物回退为原生播放器，不提供缩放与对比', () => {
    act(() =>
      root.render(
        <MediaArtifactViewer
          media={{ ...MEDIA, type: 'video', src: 'safe-file:///tmp/out.mp4' }}
          inputImage={{ src: 'safe-file:///tmp/input.png' }}
          onOpenFullscreen={vi.fn()}
        />,
      ),
    )

    expect(document.querySelector('.media-artifact-video')).not.toBeNull()
    expect(document.querySelector('.media-artifact-viewer-zoom')).toBeNull()
    expect(document.querySelector('[title="并排查看输入与输出"]')).toBeNull()
    // 视频不参与缩放：↑/↓ 不应产生缩放控件
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(document.querySelector('.media-artifact-viewer-zoom')).toBeNull()
    expect(document.querySelector('[title="打开全屏大图预览"]')).toBeNull()
  })

  it('舞台右键给出产物动作，调用方追加的任务动作排在分割线之后', () => {
    const onOpenFullscreen = vi.fn()
    const onDelete = vi.fn()
    act(() =>
      root.render(
        <MediaArtifactViewer
          media={MEDIA}
          onOpenFullscreen={onOpenFullscreen}
          contextMenuExtraItems={[
            { key: 'delete_task', label: '删除任务', danger: true, onClick: onDelete },
          ]}
        />,
      ),
    )

    const stage = document.querySelector('.media-artifact-viewer-stage')
    act(() =>
      stage?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
      ),
    )

    const menu = document.querySelector('.context-action-menu')
    expect(menu).not.toBeNull()
    expect(
      Array.from(contextMenuElement().children).map((child) =>
        child.classList.contains('action-menu-divider') ? '---' : (child.textContent ?? ''),
      ),
    ).toEqual(['复制图片', '全屏大图预览', '另存为…', '打开所在文件夹', '---', '删除任务'])

    act(() =>
      Array.from(contextMenuElement().querySelectorAll<HTMLButtonElement>('.action-menu-item'))
        .find((button) => button.textContent === '删除任务')
        ?.click(),
    )
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.context-action-menu')).toBeNull()
  })

  it('视频产物的右键菜单不提供复制图片', () => {
    act(() =>
      root.render(
        <MediaArtifactViewer media={{ ...MEDIA, src: 'safe-file:///tmp/a.mp4', type: 'video' }} />,
      ),
    )

    act(() =>
      document
        .querySelector('.media-artifact-viewer-stage')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })),
    )

    const labels = Array.from(
      document.querySelectorAll('.context-action-menu .action-menu-item'),
    ).map((item) => item.textContent)
    expect(labels).toEqual(['另存为…', '打开所在文件夹'])
  })

  it('右键菜单打开时 ↑/↓ 归菜单，查看器不再缩放', () => {
    act(() => root.render(<MediaArtifactViewer media={MEDIA} onOpenFullscreen={vi.fn()} />))
    const zoomLabel = () => document.querySelector('.media-artifact-viewer-zoom-level')?.textContent
    const before = zoomLabel()

    act(() =>
      document
        .querySelector('.media-artifact-viewer-stage')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })),
    )
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).toBe(before)

    // 菜单关闭后 ↑/↓ 恢复缩放
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })))
    expect(zoomLabel()).not.toBe(before)
  })
})
