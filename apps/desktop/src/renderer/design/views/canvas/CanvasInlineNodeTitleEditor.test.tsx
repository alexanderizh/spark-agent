// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasInlineNodeTitleEditor } from './CanvasInlineNodeTitleEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

async function mountEditor({
  nodeId = 'node-1',
  title = '旧名称',
  fallbackTitle = 'Text note',
  onRename = vi.fn().mockResolvedValue(undefined),
}: {
  nodeId?: string
  title?: string | null
  fallbackTitle?: string
  onRename?: ReturnType<typeof vi.fn>
} = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root, container })

  const render = async (next?: {
    nodeId?: string
    title?: string | null
    fallbackTitle?: string
  }) => {
    await act(async () => {
      root.render(
        <CanvasInlineNodeTitleEditor
          nodeId={next?.nodeId ?? nodeId}
          title={next && 'title' in next ? (next.title ?? null) : title}
          fallbackTitle={next?.fallbackTitle ?? fallbackTitle}
          onRename={onRename}
        />,
      )
    })
  }

  await render()

  return {
    container,
    onRename,
    render,
    renameButton: () => container.querySelector<HTMLButtonElement>('[aria-label="重命名节点"]')!,
    input: () => container.querySelector<HTMLInputElement>('[aria-label="节点名称"]')!,
  }
}

async function click(element: HTMLElement) {
  await act(async () => element.click())
}

async function changeValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function pressKey(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.focus()
    input.blur()
  })
}

describe('CanvasInlineNodeTitleEditor', () => {
  it('focuses and selects the current title when editing starts', async () => {
    const mounted = await mountEditor()

    await click(mounted.renameButton())

    expect(mounted.input()).toBe(document.activeElement)
    expect(mounted.input().selectionStart).toBe(0)
    expect(mounted.input().selectionEnd).toBe('旧名称'.length)
  })

  it('saves a trimmed title on Enter and exits edit mode', async () => {
    const mounted = await mountEditor()
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '  新名称  ')

    await pressKey(mounted.input(), 'Enter')

    expect(mounted.onRename).toHaveBeenCalledWith('新名称')
    expect(mounted.renameButton().textContent).toBe('新名称')
  })

  it('saves on blur and normalizes a blank title to null', async () => {
    const mounted = await mountEditor()
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '   ')

    await blur(mounted.input())

    expect(mounted.onRename).toHaveBeenCalledWith(null)
    expect(mounted.renameButton().textContent).toBe('Text note')
  })

  it('cancels on Escape without letting the following blur save', async () => {
    const mounted = await mountEditor()
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '未保存名称')

    await pressKey(mounted.input(), 'Escape')

    expect(mounted.onRename).not.toHaveBeenCalled()
    expect(mounted.renameButton().textContent).toBe('旧名称')
  })

  it('skips persistence when the normalized title is unchanged', async () => {
    const mounted = await mountEditor()
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '  旧名称  ')

    await pressKey(mounted.input(), 'Enter')

    expect(mounted.onRename).not.toHaveBeenCalled()
    expect(mounted.renameButton().textContent).toBe('旧名称')
  })

  it('deduplicates Enter and blur while a save is in flight', async () => {
    let resolveSave: (() => void) | undefined
    const onRename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const mounted = await mountEditor({ onRename })
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '新名称')

    await act(async () => {
      mounted.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      mounted.input().blur()
    })

    expect(onRename).toHaveBeenCalledTimes(1)
    await act(async () => resolveSave?.())
  })

  it('keeps the draft open after failure and allows retry', async () => {
    const onRename = vi
      .fn()
      .mockRejectedValueOnce(new Error('保存失败'))
      .mockResolvedValueOnce(undefined)
    const mounted = await mountEditor({ onRename })
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '重试名称')

    await pressKey(mounted.input(), 'Enter')

    expect(mounted.input().value).toBe('重试名称')
    await pressKey(mounted.input(), 'Enter')
    expect(onRename).toHaveBeenCalledTimes(2)
    expect(mounted.renameButton().textContent).toBe('重试名称')
  })

  it('syncs external titles while idle but preserves an active draft', async () => {
    const mounted = await mountEditor()

    await mounted.render({ title: '外部名称' })
    expect(mounted.renameButton().textContent).toBe('外部名称')

    await click(mounted.renameButton())
    await changeValue(mounted.input(), '本地草稿')
    await mounted.render({ title: '另一个外部名称' })
    expect(mounted.input().value).toBe('本地草稿')
  })

  it('resets editing state when switching to another node', async () => {
    const mounted = await mountEditor()
    await click(mounted.renameButton())
    await changeValue(mounted.input(), '前一个节点草稿')

    await mounted.render({ nodeId: 'node-2', title: '新节点名称' })

    expect(mounted.renameButton().textContent).toBe('新节点名称')
    expect(mounted.onRename).not.toHaveBeenCalled()
  })
})
