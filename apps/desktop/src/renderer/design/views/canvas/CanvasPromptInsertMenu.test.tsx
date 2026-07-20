// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCanvasPromptMentionItems } from './canvasPromptMentions'
import { CanvasPromptInsertMenu } from './CanvasPromptInsertMenu'
import { filterCanvasPromptInsertItems } from './canvasPromptInsertMenuModel'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import './canvasPromptComposer.less'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
  window.localStorage.clear()
})

function node(
  id: string,
  title: string,
  type: CanvasNode['type'],
  data: CanvasNode['data'],
  assetId: string | null = null,
): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type,
    title,
    assetId,
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data,
    createdAt: '',
    updatedAt: '',
  }
}

const characterNode = {
  ...node(
    'character-xiaoman',
    '小满',
    'image',
    { pipelineRole: 'character', url: 'https://example.com/xiaoman.png' },
    'asset-character',
  ),
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-04T12:00:00.000Z',
}
const sceneNode = {
  ...node('scene-alley', '雨夜巷口', 'image', {
    pipelineRole: 'scene',
    url: 'https://example.com/alley.png',
  }),
  createdAt: '2026-07-03T00:00:00.000Z',
  updatedAt: '2026-07-03T00:00:00.000Z',
}
const videoNode = {
  ...node('video-rain', '雨夜片段', 'video', {
    url: 'https://example.com/rain.mp4',
    thumbnailUrl: 'https://example.com/rain-cover.png',
  }),
  createdAt: '2026-07-02T00:00:00.000Z',
  updatedAt: '2026-07-05T00:00:00.000Z',
}
const textNode = {
  ...node('text-briefcase', 'A04｜门口公文包', 'text', {
    text: '镜头从门口推进，公文包半掩在阴影中。',
  }),
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
}

const characterAsset: CanvasAsset = {
  id: 'asset-character',
  projectId: 'project-1',
  userId: 1,
  type: 'image',
  source: 'manual',
  title: '小满',
  url: 'https://example.com/xiaoman.png',
  metadata: {},
  createdAt: '',
  updatedAt: '',
}

async function mountMenu(
  overrides: {
    query?: string
    triggerElement?: HTMLElement | null
    fixedToTrigger?: boolean
    onQueryChange?: (query: string) => void
    onInsertParameter?: ReturnType<typeof vi.fn>
    onInsertReference?: ReturnType<typeof vi.fn>
    onRequestClose?: ReturnType<typeof vi.fn>
  } = {},
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root, container })
  const callbacks = {
    onQueryChange: overrides.onQueryChange ?? vi.fn(),
    onInsertParameter: overrides.onInsertParameter ?? vi.fn(),
    onInsertReference: overrides.onInsertReference ?? vi.fn(),
    onRequestClose: overrides.onRequestClose ?? vi.fn(),
  }
  await act(async () => {
    root.render(
      <CanvasPromptInsertMenu
        items={buildCanvasPromptMentionItems([characterNode, sceneNode, videoNode, textNode])}
        assetById={new Map([[characterAsset.id, characterAsset]])}
        query={overrides.query ?? ''}
        {...(overrides.triggerElement !== undefined
          ? { triggerElement: overrides.triggerElement }
          : {})}
        {...(overrides.fixedToTrigger !== undefined
          ? { fixedToTrigger: overrides.fixedToTrigger }
          : {})}
        {...callbacks}
      />,
    )
  })
  return {
    container,
    search: container.querySelector<HTMLInputElement>('[aria-label="搜索节点与资源"]')!,
    ...callbacks,
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  )!
}

describe('CanvasPromptInsertMenu', () => {
  it('keeps a trigger-anchored menu inside the viewport and scrolls its results', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    let triggerTop = 100
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this === trigger) {
          return {
            top: triggerTop,
            right: 140,
            bottom: triggerTop + 30,
            left: 100,
            width: 40,
            height: 30,
            x: 100,
            y: triggerTop,
            toJSON: () => ({}),
          }
        }
        if (this.classList.contains('canvas-prompt-insert-menu')) {
          return {
            top: 0,
            right: 440,
            bottom: 390,
            left: 100,
            width: 340,
            height: 390,
            x: 100,
            y: 0,
            toJSON: () => ({}),
          }
        }
        return new DOMRect()
      })

    try {
      const mounted = await mountMenu({ triggerElement: trigger, fixedToTrigger: true })
      const menu = mounted.container.querySelector<HTMLElement>('.canvas-prompt-insert-menu')!
      expect(menu.style.position).toBe('fixed')
      expect(menu.style.top).toBe('136px')
      expect(menu.style.left).toBe('100px')
      expect(menu.style.maxHeight).toBe('252px')

      triggerTop = 350
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(menu.style.top).toBe('12px')
      expect(menu.style.maxHeight).toBe('332px')
    } finally {
      rectSpy.mockRestore()
      trigger.remove()
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it('repositions after a detached typeahead anchor is attached and positioned', async () => {
    const trigger = document.createElement('div')
    const rectSpy = vi
      .spyOn(trigger, 'getBoundingClientRect')
      .mockImplementation(() =>
        trigger.isConnected ? new DOMRect(240, 180, 2, 18) : new DOMRect(0, 0, 0, 0),
      )

    const mounted = await mountMenu({ triggerElement: trigger, fixedToTrigger: true })
    const menu = mounted.container.querySelector<HTMLElement>('.canvas-prompt-insert-menu')
    if (!menu) throw new Error('Expected the insert menu to render')
    expect(menu.style.visibility).toBe('hidden')

    await act(async () => {
      document.body.appendChild(trigger)
      trigger.style.left = '240px'
      await Promise.resolve()
    })

    expect(menu.style.left).toBe('240px')
    expect(menu.style.top).toBe('204px')
    expect(menu.style.visibility).toBe('')
    rectSpy.mockRestore()
    trigger.remove()
  })

  it('shows five compact shortcuts and filters all canvas image/video nodes by type', async () => {
    const mounted = await mountMenu()
    expect(
      Array.from(
        mounted.container.querySelectorAll<HTMLButtonElement>(
          '.canvas-prompt-insert-shortcuts button',
        ),
      ).map((button) => button.textContent?.trim()),
    ).toEqual(['镜头时长', '台词', '站位', '图片', '视频'])

    await act(async () => buttonByText(mounted.container, '图片').click())
    expect(
      Array.from(
        mounted.container.querySelectorAll<HTMLElement>('.canvas-prompt-insert-result strong'),
      ).map((element) => element.textContent),
    ).toEqual(['小满', '雨夜巷口'])

    await act(async () => buttonByText(mounted.container, '视频').click())
    expect(
      Array.from(
        mounted.container.querySelectorAll<HTMLElement>('.canvas-prompt-insert-result strong'),
      ).map((element) => element.textContent),
    ).toEqual(['雨夜片段'])
  })

  it('matches text content from the search field', async () => {
    const onQueryChange = vi.fn()
    const mounted = await mountMenu({ query: '公文包', onQueryChange })

    expect(mounted.search.value).toBe('公文包')
    expect(mounted.container.textContent).toContain('A04｜门口公文包')
    expect(mounted.container.textContent).not.toContain('雨夜巷口')
  })

  it('searches resource file names from URLs', async () => {
    const mounted = await mountMenu({ query: 'xiaoman.png' })

    expect(mounted.container.textContent).toContain('小满')
    expect(mounted.container.textContent).not.toContain('雨夜巷口')
  })

  it('does not index embedded media payloads as file names', () => {
    const embeddedNode = {
      ...sceneNode,
      id: 'embedded-image',
      title: '内嵌图片',
      assetId: null,
      data: { url: 'data:image/png;base64,SECRET_PAYLOAD_FOR_SEARCH' },
    }
    const items = buildCanvasPromptMentionItems([embeddedNode])

    expect(
      filterCanvasPromptInsertItems(items, 'SECRET_PAYLOAD_FOR_SEARCH', 'all', new Map()),
    ).toEqual([])
  })

  it('sorts by latest modification or latest addition', async () => {
    const mounted = await mountMenu()
    const resultLabels = () =>
      Array.from(
        mounted.container.querySelectorAll<HTMLElement>('.canvas-prompt-insert-result strong'),
      ).map((element) => element.textContent)

    expect(resultLabels()).toEqual(['雨夜片段', '小满', 'A04｜门口公文包', '雨夜巷口'])

    const sortSelect =
      mounted.container.querySelector<HTMLSelectElement>('[aria-label="列表排序"]')!
    await act(async () => {
      sortSelect.value = 'created'
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(resultLabels()).toEqual(['A04｜门口公文包', '雨夜巷口', '雨夜片段', '小满'])
  })

  it('pins and unpins an item above the current time sort and persists it per project', async () => {
    const mounted = await mountMenu()
    const pinButton =
      mounted.container.querySelector<HTMLButtonElement>('[aria-label="置顶雨夜巷口"]')!

    expect(
      mounted.container.querySelector('.canvas-prompt-insert-results')?.getAttribute('role'),
    ).toBe('list')
    expect(mounted.container.querySelectorAll('[role="listitem"]')).toHaveLength(4)
    expect(mounted.container.querySelector('[role="option"]')).toBeNull()

    await act(async () => pinButton.click())
    expect(
      mounted.container.querySelector<HTMLElement>('.canvas-prompt-insert-result strong')
        ?.textContent,
    ).toBe('雨夜巷口')
    expect(pinButton.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem('spark-canvas:prompt-insert-pinned:v1:project-1')).toContain(
      'scene-alley',
    )

    await act(async () => pinButton.click())
    expect(pinButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows an external text or image preview for the hovered result', async () => {
    const mounted = await mountMenu()
    const textResult = buttonByText(mounted.container, 'A04｜门口公文包')
    await act(async () => {
      textResult.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(mounted.container.querySelector('.canvas-prompt-insert-preview')?.textContent).toContain(
      '镜头从门口推进',
    )

    const imageResult = buttonByText(mounted.container, '小满')
    await act(async () => {
      imageResult.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(
      mounted.container.querySelector<HTMLImageElement>('.canvas-prompt-insert-preview img')?.src,
    ).toContain('xiaoman.png')
  })

  it('closes on outside pointer down but not when interacting inside the menu', async () => {
    const onRequestClose = vi.fn()
    const mounted = await mountMenu({ onRequestClose })

    await act(async () => {
      mounted.search.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(onRequestClose).not.toHaveBeenCalled()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(onRequestClose).toHaveBeenCalledOnce()
  })

  it('shows a jump-to-bottom button when results overflow and scrolls on click', async () => {
    const mounted = await mountMenu()
    const results = mounted.container.querySelector<HTMLElement>('.canvas-prompt-insert-results')!
    // 初始内容未溢出（jsdom 默认 scrollHeight/clientHeight 均为 0）→ 不显示按钮
    expect(mounted.container.querySelector('[aria-label="跳到底部"]')).toBeNull()

    // 模拟列表溢出：scrollHeight 远大于 clientHeight
    Object.defineProperty(results, 'scrollHeight', { configurable: true, value: 600 })
    Object.defineProperty(results, 'clientHeight', { configurable: true, value: 200 })
    await act(async () => {
      results.dispatchEvent(new Event('scroll'))
    })
    const jump = mounted.container.querySelector<HTMLButtonElement>('[aria-label="跳到底部"]')!
    expect(jump).toBeTruthy()

    // jsdom 未实现 Element.prototype.scrollTo，手动注入 mock 以断言点击行为
    const scrollToCalls: Array<{ top: number; behavior: string }> = []
    ;(
      results as unknown as {
        scrollTo: (args: { top: number; behavior: string }) => void
      }
    ).scrollTo = (args) => {
      scrollToCalls.push(args)
    }
    await act(async () => {
      jump.click()
    })
    expect(scrollToCalls[0]).toEqual(expect.objectContaining({ top: 600 }))
  })
})
