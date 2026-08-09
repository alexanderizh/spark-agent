// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canCopyNodeContent,
  copyImageBlobToClipboard,
  copyNodeContentToClipboard,
  copyTextToClipboard,
  loadImageBlobFromUrl,
} from './canvasClipboard'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasNode } from './canvas.types'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function makeNode(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'n1',
    projectId: 'p1',
    boardId: 'b1',
    userId: 1,
    type: 'text',
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeOutput(overrides: Partial<CanvasOperationOutputView>): CanvasOperationOutputView {
  return {
    id: 'o1',
    type: 'image',
    title: '产物',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('canCopyNodeContent', () => {
  it('text 节点有文本 → text', () => {
    const node = makeNode({ type: 'text', data: { text: '你好' } })
    expect(canCopyNodeContent(node)).toEqual({ kind: 'text' })
  })

  it('prompt 节点有文本 → text', () => {
    const node = makeNode({ type: 'prompt', data: { text: 'a girl, cinematic' } })
    expect(canCopyNodeContent(node)).toEqual({ kind: 'text' })
  })

  it('text 节点空文本 → none 并说明原因', () => {
    const node = makeNode({ type: 'text', data: { text: '   ' } })
    expect(canCopyNodeContent(node).kind).toBe('none')
  })

  it('image 节点有 url → image', () => {
    const node = makeNode({ type: 'image', data: { url: 'https://example.com/a.png' } })
    expect(canCopyNodeContent(node)).toEqual({ kind: 'image' })
  })

  it('image 节点只有 thumbnailUrl → image', () => {
    const node = makeNode({ type: 'image', data: { thumbnailUrl: 'safe-file://x/abc' } })
    expect(canCopyNodeContent(node)).toEqual({ kind: 'image' })
  })

  it('image 节点没有 url → none', () => {
    const node = makeNode({ type: 'image', data: {} })
    expect(canCopyNodeContent(node).kind).toBe('none')
  })

  it('任务节点无 output → none', () => {
    const node = makeNode({ type: 'text_to_image', data: {} })
    expect(canCopyNodeContent(node).kind).toBe('none')
  })

  it('任务节点 output 是文本 → text', () => {
    const node = makeNode({ type: 'text_generate', data: {} })
    const output = makeOutput({ type: 'text', text: '产物文本' })
    expect(canCopyNodeContent(node, output)).toEqual({ kind: 'text' })
  })

  it('任务节点 output 是图片 → image', () => {
    const node = makeNode({ type: 'image_to_image', data: {} })
    const output = makeOutput({ type: 'image', url: 'https://example.com/result.png' })
    expect(canCopyNodeContent(node, output)).toEqual({ kind: 'image' })
  })

  it('任务节点 output 既无文本也无 URL → none', () => {
    const node = makeNode({ type: 'text_to_image', data: {} })
    const output = makeOutput({ type: 'image' })
    expect(canCopyNodeContent(node, output).kind).toBe('none')
  })
})

describe('copyTextToClipboard', () => {
  it('调用 navigator.clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await copyTextToClipboard('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('空文本抛错', async () => {
    await expect(copyTextToClipboard('')).rejects.toThrow()
  })
})

describe('copyImageBlobToClipboard', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: class {
        static: unknown
        constructor(public data: Record<string, Blob>) {}
      },
    })
  })

  it('将 Blob 写入剪贴板', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    const blob = new Blob(['x'], { type: 'image/png' })
    await copyImageBlobToClipboard(blob)
    expect(write).toHaveBeenCalledOnce()
    const payload = write.mock.calls[0]![0] as [{ data: Record<string, Blob> }]
    expect(payload[0].data['image/png']).toBe(blob)
  })

  it('不支持 ClipboardItem 时抛错', async () => {
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: undefined })
    const write = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    await expect(copyImageBlobToClipboard(new Blob(['x']))).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  })
})

describe('loadImageBlobFromUrl', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('data URL 走 dataUrlToBlob，不调用 fetch', async () => {
    const blob = await loadImageBlobFromUrl(PNG_DATA_URL)
    expect(blob.type).toBe('image/png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('https URL 走 fetch 拿 Blob', async () => {
    const arrayBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
    const fakeBlob = new Blob([arrayBuffer], { type: 'image/png' })
    fetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    })
    const blob = await loadImageBlobFromUrl('https://example.com/a.png')
    expect(blob).toBe(fakeBlob)
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/a.png')
  })

  it('fetch 失败抛错', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, blob: () => Promise.resolve(new Blob()) })
    await expect(loadImageBlobFromUrl('https://example.com/missing.png')).rejects.toThrow(/404/)
  })

  it('空字符串 / 无法识别形态抛错', async () => {
    await expect(loadImageBlobFromUrl('')).rejects.toThrow()
    await expect(loadImageBlobFromUrl('not-a-url')).rejects.toThrow()
  })
})

describe('copyNodeContentToClipboard', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: class {
        constructor(public data: Record<string, Blob>) {}
      },
    })
  })

  function mockClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, write },
    })
    return { writeText, write }
  }

  it('text 节点 → writeText', async () => {
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'text', data: { text: '段落正文' } })
    const result = await copyNodeContentToClipboard(node)
    expect(result).toEqual({ kind: 'text' })
    expect(writeText).toHaveBeenCalledWith('段落正文')
    expect(write).not.toHaveBeenCalled()
  })

  it('image 节点 data URL → 直接写 Blob，不 fetch', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'image', data: { url: PNG_DATA_URL } })
    const result = await copyNodeContentToClipboard(node)
    expect(result).toEqual({ kind: 'image' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('image 节点 https URL → fetch 后写 Blob', async () => {
    const fakeBlob = new Blob(['x'], { type: 'image/png' })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    }) as unknown as typeof fetch
    const { write, writeText } = mockClipboard()
    const node = makeNode({ type: 'image', data: { url: 'https://example.com/a.png' } })
    const result = await copyNodeContentToClipboard(node)
    expect(result).toEqual({ kind: 'image' })
    expect(write).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('image 节点 fetch 失败 → 直接抛错，不偷塞文本', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      blob: () => Promise.reject(new Error('boom')),
    }) as unknown as typeof fetch
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'image', data: { url: 'https://example.com/a.png' } })
    // 关键：不能再降级到 writeText(url) 把 safe-file:// 字符串塞进剪贴板。
    // 失败必须直接抛给上层 toast。
    await expect(copyNodeContentToClipboard(node)).rejects.toThrow(/500|boom|复制图片/)
    expect(writeText).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('image 节点 safe-file:// URL fetch 失败 → 直接抛错', async () => {
    // 模拟 safe-file:// 资源已被清理 / 不在白名单：fetch reject。
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'image', data: { url: 'safe-file://x/abc' } })
    await expect(copyNodeContentToClipboard(node)).rejects.toThrow()
    expect(writeText).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('image 节点 ClipboardItem 不可用 → 直接抛错，不降级 writeText', async () => {
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: undefined })
    const fakeBlob = new Blob(['x'], { type: 'image/png' })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    }) as unknown as typeof fetch
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'image', data: { url: 'https://example.com/a.png' } })
    await expect(copyNodeContentToClipboard(node)).rejects.toThrow(/不支持/)
    expect(writeText).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('任务节点 output 是文本 → writeText', async () => {
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'text_generate', data: {} })
    const output = makeOutput({ type: 'text', text: '生成结果' })
    const result = await copyNodeContentToClipboard(node, output)
    expect(result).toEqual({ kind: 'text' })
    expect(writeText).toHaveBeenCalledWith('生成结果')
    expect(write).not.toHaveBeenCalled()
  })

  it('任务节点 output 是图片 → fetch 后写 Blob', async () => {
    const fakeBlob = new Blob(['x'], { type: 'image/png' })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    }) as unknown as typeof fetch
    const { write, writeText } = mockClipboard()
    const node = makeNode({ type: 'image_to_image', data: {} })
    const output = makeOutput({ type: 'image', url: 'https://example.com/result.png' })
    const result = await copyNodeContentToClipboard(node, output)
    expect(result).toEqual({ kind: 'image' })
    expect(write).toHaveBeenCalledOnce()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('任务节点无 output → none，不调用 clipboard', async () => {
    const { writeText, write } = mockClipboard()
    const node = makeNode({ type: 'text_to_image', data: {} })
    const result = await copyNodeContentToClipboard(node)
    expect(result.kind).toBe('none')
    expect(writeText).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
