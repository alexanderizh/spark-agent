// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasOperationDraftAutosave } from './useCanvasOperationDraftAutosave'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
})

function Harness({
  value,
  revision,
  onSave,
}: {
  value: string
  revision: number
  onSave: (draft: { value: string }) => Promise<void> | void
}) {
  useCanvasOperationDraftAutosave({
    draft: { value },
    revision,
    onSave,
    debounceMs: 500,
  })
  return null
}

describe('useCanvasOperationDraftAutosave', () => {
  it('persists the latest dirty draft after the debounce', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<Harness value="初始" revision={0} onSave={onSave} />))
    await act(async () => root.render(<Harness value="新输入" revision={1} onSave={onSave} />))
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(onSave).toHaveBeenCalledWith({ value: '新输入' })

    await act(async () => root.unmount())
  })

  it('flushes a dirty draft when switching nodes unmounts the panel', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<Harness value="未保存输入" revision={1} onSave={onSave} />))
    await act(async () => root.unmount())
    await act(async () => Promise.resolve())
    expect(onSave).toHaveBeenCalledWith({ value: '未保存输入' })
  })
})
