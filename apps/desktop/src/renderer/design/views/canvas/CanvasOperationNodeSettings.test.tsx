// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasOperationNodeSettings } from './CanvasOperationNodeSettings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

async function mountSettings(title: string | null, onRename = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root, container })
  await act(async () => {
    root.render(
      <CanvasOperationNodeSettings nodeId="operation-1" title={title} onRename={onRename} />,
    )
  })
  return {
    container,
    input: container.querySelector<HTMLInputElement>('[aria-label="节点名称"]')!,
    onRename,
  }
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

describe('CanvasOperationNodeSettings', () => {
  it('saves a changed title on Enter and skips an unchanged blur', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined)
    const mounted = await mountSettings('旧名称', onRename)

    await changeValue(mounted.input, '  新名称  ')
    await pressKey(mounted.input, 'Enter')
    expect(onRename).toHaveBeenCalledWith('新名称')

    await act(async () => {
      mounted.input.focus()
      mounted.input.blur()
    })
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('restores the saved title on Escape without saving', async () => {
    const mounted = await mountSettings('旧名称')
    await changeValue(mounted.input, '未保存名称')
    await pressKey(mounted.input, 'Escape')

    expect(mounted.input.value).toBe('旧名称')
    expect(mounted.onRename).not.toHaveBeenCalled()
  })

  it('normalizes a blank title to null on blur', async () => {
    const mounted = await mountSettings('旧名称')
    await changeValue(mounted.input, '   ')
    await act(async () => {
      mounted.input.focus()
      mounted.input.blur()
    })

    expect(mounted.onRename).toHaveBeenCalledWith(null)
  })

  it('keeps the draft after a failed save so the user can retry', async () => {
    const mounted = await mountSettings('旧名称', vi.fn().mockRejectedValue(new Error('保存失败')))
    await changeValue(mounted.input, '重试名称')
    await pressKey(mounted.input, 'Enter')

    expect(mounted.input.value).toBe('重试名称')
    expect(mounted.container.textContent).toContain('保存失败')
  })

  it('deduplicates Enter and blur while the same save is in flight', async () => {
    let resolveSave: (() => void) | undefined
    const onRename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const mounted = await mountSettings('旧名称', onRename)
    await changeValue(mounted.input, '新名称')

    await act(async () => {
      mounted.input.focus()
      mounted.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      mounted.input.blur()
    })
    expect(onRename).toHaveBeenCalledTimes(1)

    await act(async () => resolveSave?.())
  })
})
