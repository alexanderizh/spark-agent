// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCanvasPromptMentionItems } from './canvasPromptMentions'
import { CanvasPromptInsertMenu } from './CanvasPromptInsertMenu'
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

const characterNode = node(
  'character-xiaoman',
  '小满',
  'image',
  { pipelineRole: 'character', url: 'https://example.com/xiaoman.png' },
  'asset-character',
)
const sceneNode = node('scene-alley', '雨夜巷口', 'image', {
  pipelineRole: 'scene',
  url: 'https://example.com/alley.png',
})
const textNode = node('text-briefcase', 'A04｜门口公文包', 'text', {
  text: '镜头从门口推进，公文包半掩在阴影中。',
})

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
        items={buildCanvasPromptMentionItems([characterNode, sceneNode, textNode])}
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

  it('shows five compact shortcuts and uses character/scene shortcuts as filters', async () => {
    const mounted = await mountMenu()
    expect(
      Array.from(
        mounted.container.querySelectorAll<HTMLButtonElement>(
          '.canvas-prompt-insert-shortcuts button',
        ),
      ).map((button) => button.textContent?.trim()),
    ).toEqual(['镜头时长', '台词', '站位', '角色', '场景'])

    await act(async () => buttonByText(mounted.container, '角色').click())
    expect(
      Array.from(
        mounted.container.querySelectorAll<HTMLElement>('.canvas-prompt-insert-result strong'),
      ).map((element) => element.textContent),
    ).toEqual(['小满'])
  })

  it('matches text content from the search field', async () => {
    const onQueryChange = vi.fn()
    const mounted = await mountMenu({ query: '公文包', onQueryChange })

    expect(mounted.search.value).toBe('公文包')
    expect(mounted.container.textContent).toContain('A04｜门口公文包')
    expect(mounted.container.textContent).not.toContain('雨夜巷口')
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
})
