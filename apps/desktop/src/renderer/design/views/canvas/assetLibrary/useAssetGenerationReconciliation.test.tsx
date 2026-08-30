// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetGenerationReconciliation } from './useAssetGenerationReconciliation'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function Harness({ active, refresh }: { active: boolean; refresh: () => Promise<void> }) {
  useAssetGenerationReconciliation(active, refresh, 100)
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container = null
  vi.useRealTimers()
})

describe('useAssetGenerationReconciliation', () => {
  it('仅在任务活动时轮询，并在终态后停止', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    await act(async () => root?.render(<Harness active refresh={refresh} />))

    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(refresh).toHaveBeenCalledTimes(1)

    await act(async () => root?.render(<Harness active={false} refresh={refresh} />))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('单次刷新失败不会让后续对账停摆', async () => {
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValue(undefined)
    await act(async () => root?.render(<Harness active refresh={refresh} />))

    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
