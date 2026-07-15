// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
} from 'lexical'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { CanvasPromptComposer } from './CanvasPromptComposer'
import { CANVAS_PROMPT_HOVER_MAX_HEIGHT } from './CanvasPromptHoverCard'
import './canvasPromptComposer.less'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 18)
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

function imageNode(): CanvasNode {
  return {
    id: 'hero', projectId: 'p', boardId: 'b', userId: 1, type: 'image', title: '小满',
    assetId: 'asset-hero', taskId: null, parentNodeId: null, x: 0, y: 0, width: 100, height: 100,
    rotation: 0, zIndex: 0, locked: false, hidden: false,
    data: { url: 'https://example.com/hero.png', thumbnailUrl: 'https://example.com/hero-thumb.png' },
    createdAt: '', updatedAt: '',
  }
}

function videoNode(): CanvasNode {
  return {
    ...imageNode(),
    id: 'clip',
    type: 'video',
    title: '参考视频',
    assetId: 'asset-clip',
    data: {
      url: 'https://example.com/clip.mp4',
      thumbnailUrl: 'https://example.com/clip-cover.png',
    },
  }
}

function textNode(): CanvasNode {
  return {
    ...imageNode(),
    id: 'storyboard',
    type: 'text',
    title: '分镜表',
    assetId: null,
    data: { text: '| 镜号 | 画面 |\n| 01 | 女主回头 |' },
  }
}

const asset: CanvasAsset = {
  id: 'asset-hero', projectId: 'p', userId: 1, type: 'image', source: 'upload', title: '小满',
  url: 'https://example.com/hero.png', thumbnailUrl: 'https://example.com/hero-thumb.png',
  metadata: {}, createdAt: '', updatedAt: '',
}

const videoAsset: CanvasAsset = {
  ...asset,
  id: 'asset-clip',
  type: 'video',
  title: '参考视频',
  url: 'https://example.com/clip.mp4',
  thumbnailUrl: 'https://example.com/clip-cover.png',
}

async function mountComposer(
  initialDocument: CanvasPromptDocument,
  nodes: CanvasNode[] = [imageNode()],
  assets: CanvasAsset[] = [asset],
) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root, container })
  let currentDocument = initialDocument
  let editor: LexicalEditor | null = null

  function Harness() {
    const [document, setDocument] = useState(initialDocument)
    currentDocument = document
    return (
      <CanvasPromptComposer
        document={document}
        mentionNodes={nodes}
        assets={assets}
        placeholder="输入提示词"
        onChange={setDocument}
        onEditorReady={(nextEditor) => {
          editor = nextEditor
        }}
      />
    )
  }

  await act(async () => root.render(<Harness />))
  await flushEditor()
  return {
    container,
    getDocument: () => currentDocument,
    getEditor: () => {
      if (!editor) throw new Error('Lexical editor is not ready')
      return editor
    },
  }
}

async function flushEditor() {
  await act(async () => {
    await Promise.resolve()
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  })
}

async function replaceEditorText(editor: LexicalEditor, text: string) {
  await act(async () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(text))
      root.append(paragraph)
    })
  })
  await flushEditor()
}

describe('CanvasPromptComposer', () => {
  it('renders image references as thumbnail chips', async () => {
    const mounted = await mountComposer({
      version: 2,
      blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '小满', order: 0 }],
    })
    expect(
      mounted.container.querySelector<HTMLImageElement>('.canvas-prompt-chip-thumb img')?.src,
    ).toBe('https://example.com/hero-thumb.png')
    expect(mounted.container.textContent).toContain('小满')
  })

  it('renders the referenced image instead of its URL data in the hover card', async () => {
    const referencedImage = imageNode()
    referencedImage.data.url = 'safe-file://x/hero.png'
    const mounted = await mountComposer(
      {
        version: 2,
        blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'reference_image', label: '小满', order: 0 }],
      },
      [referencedImage],
    )

    const chip = mounted.container.querySelector<HTMLButtonElement>('.canvas-prompt-chip')
    expect(chip).not.toBeNull()
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })

    expect(
      window.document.querySelector<HTMLImageElement>('.canvas-prompt-hover-media img')?.src,
    ).toBe('safe-file://x/hero.png')
    expect(window.document.querySelector('.canvas-prompt-hover-scroll')).toBeNull()
    expect(window.document.querySelector('.canvas-prompt-hover-head')).toBeNull()
    expect(window.document.querySelector('.canvas-prompt-hover-meta')).toBeNull()
  })

  it('renders only the video cover in the hover card', async () => {
    const mounted = await mountComposer(
      {
        version: 2,
        blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'clip', relation: 'reference_video', label: '参考视频', order: 0 }],
      },
      [videoNode()],
      [videoAsset],
    )

    const chip = mounted.container.querySelector<HTMLButtonElement>('.canvas-prompt-chip')
    expect(chip).not.toBeNull()
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })

    expect(
      window.document.querySelector<HTMLImageElement>('.canvas-prompt-hover-media img')?.src,
    ).toBe('https://example.com/clip-cover.png')
    expect(window.document.querySelector('.canvas-prompt-hover-head')).toBeNull()
    expect(window.document.querySelector('.canvas-prompt-hover-meta')).toBeNull()
  })

  it('renders only text or table content in the hover card', async () => {
    const mounted = await mountComposer(
      {
        version: 2,
        blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'storyboard', relation: 'storyboard', label: '分镜表', order: 0 }],
      },
      [textNode()],
      [],
    )

    const chip = mounted.container.querySelector<HTMLButtonElement>('.canvas-prompt-chip')
    expect(chip).not.toBeNull()
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })

    expect(window.document.querySelector('.canvas-prompt-hover-scroll')?.textContent).toBe(
      '| 镜号 | 画面 |\n| 01 | 女主回头 |',
    )
    expect(window.document.querySelector('.canvas-prompt-hover-head')).toBeNull()
    expect(window.document.querySelector('.canvas-prompt-hover-meta')).toBeNull()
  })

  it('renders structured and invalid references as atomic states', async () => {
    const mounted = await mountComposer(
      { version: 2, blocks: [{ kind: 'structured', id: 's1', sourceNodeId: 'missing', schema: 'storyboard', summary: '镜头 03–06' }] },
      [],
    )
    expect(mounted.container.textContent).toContain('镜头 03–06')
    expect(mounted.container.querySelector('[aria-invalid="true"]')).not.toBeNull()
  })

  it('keeps long hover content inside a scrolling viewport', () => {
    expect(CANVAS_PROMPT_HOVER_MAX_HEIGHT).toBe(280)
  })

  it('accepts arbitrary text in a clean editor', async () => {
    const mounted = await mountComposer({ version: 2, blocks: [] })
    await replaceEditorText(mounted.getEditor(), '自定义镜头描述')
    expect(mounted.getDocument().blocks).toEqual([
      expect.objectContaining({ kind: 'text', text: '自定义镜头描述' }),
    ])
  })

  it('inserts text at an arbitrary middle selection without jumping before tags', async () => {
    const mounted = await mountComposer({
      version: 2,
      blocks: [
        { kind: 'text', id: 'text-before-resource', text: '镜头中间文字' },
        { kind: 'reference', id: 'reference-hero', source: 'manual', sourceNodeId: 'hero', relation: 'reference_image', label: '小满', order: 0 },
      ],
    })
    await act(async () => {
      mounted.getEditor().update(() => {
        const paragraph = $getRoot().getFirstChild()
        if (!$isElementNode(paragraph)) throw new Error('Missing prompt paragraph')
        const textNode = paragraph.getFirstChild()
        if (!$isTextNode(textNode)) throw new Error('Missing prompt text')
        textNode.select(2, 2)
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) throw new Error('Missing range selection')
        selection.insertText('新')
      })
    })
    await flushEditor()
    expect(mounted.getDocument().blocks[0]).toMatchObject({ text: '镜头新中间文字' })
    expect(mounted.getDocument().blocks[1]).toMatchObject({ kind: 'reference', label: '小满' })
  })

  it('creates an editable parameter and focuses its value', async () => {
    const mounted = await mountComposer({ version: 2, blocks: [] })
    await act(async () => mounted.container.querySelector<HTMLButtonElement>('.canvas-prompt-composer-add')!.click())
    const durationButton = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>('.canvas-prompt-parameter-menu > button'),
    ).find((button) => button.textContent?.includes('镜头时长'))!
    await act(async () => durationButton.click())
    await flushEditor()

    const input = mounted.container.querySelector<HTMLInputElement>('input[aria-label="设置时长"]')!
    expect(window.document.activeElement).toBe(input)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '8')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '8' }))
    })
    await flushEditor()
    expect(mounted.getDocument().blocks).toContainEqual(
      expect.objectContaining({ kind: 'parameter', parameter: 'duration', value: '8', unit: '秒' }),
    )
  })

  it('adds character and image resources from the insert menu', async () => {
    const characterNode = { ...imageNode(), data: { ...imageNode().data, pipelineRole: 'character' as const } }
    const mounted = await mountComposer({ version: 2, blocks: [] }, [characterNode])
    await act(async () => mounted.container.querySelector<HTMLButtonElement>('.canvas-prompt-composer-add')!.click())
    const resourceButton = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>('.canvas-prompt-resource-list button'),
    ).find((button) => button.textContent?.includes('小满'))!
    await act(async () => resourceButton.click())
    await flushEditor()
    expect(mounted.getDocument().blocks).toContainEqual(
      expect.objectContaining({ kind: 'reference', sourceNodeId: 'hero', relation: 'character', label: '小满' }),
    )
  })

  it('keeps a resource tag and following text in one Lexical paragraph', async () => {
    const mounted = await mountComposer({
      version: 2,
      blocks: [
        { kind: 'reference', id: 'reference-hero', source: 'manual', sourceNodeId: 'hero', relation: 'reference_image', label: '小满', order: 0 },
        { kind: 'text', id: 'text-after-resource', text: '继续输入镜头描述' },
      ],
    })
    const paragraph = mounted.container.querySelector('.canvas-prompt-lexical-paragraph')!
    expect(paragraph.querySelector('.canvas-prompt-lexical-atomic')).not.toBeNull()
    expect(paragraph.textContent).toContain('继续输入镜头描述')
    expect(
      window.getComputedStyle(paragraph.querySelector<HTMLElement>('.canvas-prompt-lexical-atomic')!).display,
    ).toBe('inline')
  })

  it('deletes a manually inserted tag as one atomic unit', async () => {
    const mounted = await mountComposer({
      version: 2,
      blocks: [{ kind: 'reference', id: 'manual-hero', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '小满', order: 0 }],
    })
    await act(async () => mounted.container.querySelector<HTMLButtonElement>('[aria-label="删除小满"]')!.click())
    await flushEditor()
    expect(mounted.getDocument().blocks).toEqual([])
  })

  it('persists deletion of an automatic connection tag as a suppressed input', async () => {
    const mounted = await mountComposer({
      version: 2,
      blocks: [{ kind: 'reference', id: 'connection-hero', source: 'connection', sourceNodeId: 'hero', relation: 'character', connectionRelation: 'character', label: '小满', order: 0 }],
    })
    await act(async () => mounted.container.querySelector<HTMLButtonElement>('[aria-label="删除小满"]')!.click())
    await flushEditor()
    expect(mounted.getDocument().blocks).toContainEqual(
      expect.objectContaining({ id: 'connection-hero', suppressed: true }),
    )
    expect(mounted.container.querySelector('[aria-label="删除小满"]')).toBeNull()
  })

  it('opens @ suggestions and inserts the selected node as a tag', async () => {
    const mounted = await mountComposer({ version: 2, blocks: [] })
    await act(async () => {
      mounted.getEditor().update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const text = $createTextNode('@小')
        paragraph.append(text)
        root.append(paragraph)
        text.selectEnd()
      })
      mounted.getEditor().focus()
    })
    await flushEditor()
    const option = window.document.querySelector<HTMLButtonElement>('.canvas-prompt-mention-menu button')
    expect(option?.textContent).toContain('小满')
    await act(async () => option!.click())
    await flushEditor()
    expect(mounted.getDocument().blocks).toContainEqual(
      expect.objectContaining({ kind: 'reference', sourceNodeId: 'hero', label: '小满' }),
    )
  })
})
