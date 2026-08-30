// @vitest-environment jsdom

import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useElementPicker, type ElementPickerController } from './useElementPicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

type PickerOptions = Parameters<typeof useElementPicker>[0]

let controller: ElementPickerController | null = null

function PickerHarness(props: PickerOptions) {
  const picker = useElementPicker(props)
  useEffect(() => {
    controller = picker
    return () => {
      controller = null
    }
  }, [picker])
  return null
}

async function renderPickerWithWebview(
  executeJavaScript: (script: string) => Promise<unknown>,
): Promise<ReturnType<typeof vi.fn>> {
  const exec = vi.fn(executeJavaScript)
  const props: PickerOptions = {
    getWebview: () => ({ executeJavaScript: exec }) as unknown as Electron.WebviewTag,
    onPickedElement: vi.fn(),
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<PickerHarness {...props} />))
  return exec
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item == null) break
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('useElementPicker.stop', () => {
  it('拾取从未开启时不向 webview 注入取消脚本（地址栏提交等高频防御路径）', async () => {
    const exec = await renderPickerWithWebview(() => Promise.resolve(null))
    expect(controller).not.toBeNull()
    act(() => controller?.stop())
    expect(exec).not.toHaveBeenCalled()
  })

  it('拾取开启后 stop() 正常注入取消脚本', async () => {
    // 元素拾取脚本 resolve null（用户 Esc / 空结果）后 runLoop 自动 stop
    const exec = await renderPickerWithWebview(() => Promise.resolve(null))
    act(() => controller?.toggle())
    await act(async () => {
      await Promise.resolve()
    })
    expect(controller?.active).toBe(false)
    expect(exec).toHaveBeenCalledWith(expect.stringContaining('window.__sparkPickerCancel'))
  })

  it('guest 未 attach（executeJavaScript 同步 throw）时 stop() 不向外冒泡异常', async () => {
    const exec = await renderPickerWithWebview(() => {
      // 模拟 Electron webview dom-ready 前：getWebContentsId 同步 throw
      throw new Error(
        'The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.',
      )
    })
    expect(() => {
      act(() => {
        // 修复前：runLoop 自动 stop / 手动 stop 都会同步抛出，炸到全局错误弹窗
        controller?.toggle()
        controller?.stop()
      })
    }).not.toThrow()
    expect(exec.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
