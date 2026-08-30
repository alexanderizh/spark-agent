// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSyncPreviewResult } from '@spark/protocol'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
  onApplied: vi.fn(),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    toast: {
      success: vi.fn(),
      warning: vi.fn(),
      error: mocks.toastError,
    },
  }),
}))

import { AccountSyncConflictPanel } from './AccountSyncConflictPanel'

const previewResult: AccountSyncPreviewResult = {
  mode: 'preview',
  operationId: '22222222-2222-4222-8222-222222222222',
  status: 'partial',
  categories: [{ category: 'appearance', conflictCount: 1 }],
  conflicts: [
    {
      category: 'appearance',
      items: [
        {
          id: 'item-1',
          local: {
            updatedAt: '2026-08-30T00:00:00.000Z',
            deleted: false,
            summary: '深色主题',
            preview: 'theme=dark',
          },
          cloud: {
            updatedAt: '2026-08-30T01:00:00.000Z',
            deleted: false,
            summary: '深色主题',
            preview: 'theme=dark',
          },
        },
      ],
    },
  ],
  totalConflicts: 1,
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  )
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AccountSyncConflictPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.invoke.mockReset()
    mocks.toastError.mockReset()
    mocks.onApplied.mockReset()
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:preview') return previewResult
      if (channel === 'account-sync:execute') {
        return {
          result: {
            operationId: '22222222-2222-4222-8222-222222222222',
            status: 'success',
            categories: ['appearance'],
            stats: { uploaded: 0, downloaded: 1, conflicts: 1, skipped: 0 },
            errorCodes: [],
          },
          appliedAppearance: null,
        }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke: mocks.invoke },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('shows the conflict list after preview and lets the user choose a side', async () => {
    await act(async () => {
      root.render(<AccountSyncConflictPanel disabled={false} onApplied={mocks.onApplied} />)
      await flush()
    })

    await act(async () => {
      buttonByText('预览并处理冲突')?.click()
      await flush()
      await flush()
    })

    expect(mocks.invoke).toHaveBeenCalledWith('account-sync:preview', {})
    expect(container.textContent).toContain('冲突预览 · 1 项待处理')
    expect(container.textContent).toContain('深色主题')
    expect(container.textContent).toContain('本机')
    expect(container.textContent).toContain('云端')
    expect(buttonByText('应用选择并同步')).not.toBeUndefined()
  })

  it('applies chosen sides with category-prefixed keys and reports the result', async () => {
    await act(async () => {
      root.render(<AccountSyncConflictPanel disabled={false} onApplied={mocks.onApplied} />)
      await flush()
    })

    await act(async () => {
      buttonByText('预览并处理冲突')?.click()
      await flush()
      await flush()
    })
    await act(async () => {
      buttonByText('全部保留云端')?.click()
      await flush()
    })

    await act(async () => {
      buttonByText('应用选择并同步')?.click()
      await flush()
      await flush()
    })

    expect(mocks.invoke).toHaveBeenCalledWith('account-sync:execute', {
      conflictChoices: { 'appearance/item-1': 'cloud' },
    })
    expect(mocks.onApplied).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state when preview finds no conflicts', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:preview') {
        return { ...previewResult, conflicts: [], totalConflicts: 0 }
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncConflictPanel disabled={false} onApplied={mocks.onApplied} />)
      await flush()
    })
    await act(async () => {
      buttonByText('预览并处理冲突')?.click()
      await flush()
      await flush()
    })

    expect(container.textContent).toContain('未发现需要处理的冲突')
    expect(buttonByText('应用选择并同步')).toBeUndefined()
  })

  it('keeps the trigger disabled while sync is unavailable', async () => {
    await act(async () => {
      root.render(<AccountSyncConflictPanel disabled onApplied={mocks.onApplied} />)
      await flush()
    })

    expect(buttonByText('预览并处理冲突')?.disabled).toBe(true)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('shows the preview error message when the server rejects', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'account-sync:preview') {
        throw new Error('当前服务端暂不支持冲突预览，请升级服务端后重试')
      }
      throw new Error(`Unexpected IPC: ${channel}`)
    })

    await act(async () => {
      root.render(<AccountSyncConflictPanel disabled={false} onApplied={mocks.onApplied} />)
      await flush()
    })
    await act(async () => {
      buttonByText('预览并处理冲突')?.click()
      await flush()
      await flush()
    })

    expect(container.textContent).toContain('当前服务端暂不支持冲突预览')
  })
})
