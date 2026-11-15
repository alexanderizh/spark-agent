// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DreamRunState } from '@spark/protocol'

type ToastAction = { label: string; onClick: () => void }
type ToastOptions = { actions?: ToastAction[] }

const toastMocks = vi.hoisted(() => {
  const success = vi.fn((_message: string, _options?: ToastOptions) => 'success-1')
  const toast = Object.assign(vi.fn((_message: string) => 'toast-1'), {
    success,
    error: vi.fn((_message: string) => 'error-1'),
    info: vi.fn((_message: string) => 'info-1'),
    warning: vi.fn((_message: string) => 'warning-1'),
  })
  return { toast, dismiss: vi.fn((_id?: string) => undefined) }
})

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: toastMocks.toast, dismiss: toastMocks.dismiss, toasts: [] }),
}))

import { DreamNoticeHost } from './DreamNoticeHost'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DreamHandler = (state: DreamRunState) => void
let handler: DreamHandler | null = null

function mount(onOpenTrack: (track: DreamRunState['track'], pendingReview: number) => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<DreamNoticeHost onOpenTrack={onOpenTrack} />))
  return {
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function state(
  track: DreamRunState['track'],
  status: DreamRunState['status'],
  pendingReview = 0,
): DreamRunState {
  return {
    track,
    runId: `run-${track}`,
    trigger: 'manual',
    status,
    phase: 'settle',
    startedAt: 1,
    updatedAt: 2,
    sessionId: null,
    stats: { proposals: 1, autoApplied: 1, pendingReview, rejectedInvalid: 0, droppedByLimit: 0 },
  }
}

function emit(next: DreamRunState): void {
  if (handler == null) throw new Error('自动整编事件未被订阅')
  act(() => handler?.(next))
}

beforeEach(() => {
  vi.clearAllMocks()
  handler = null
  ;(window as unknown as { spark: { on: (event: string, callback: DreamHandler) => () => void } }).spark = {
    on: (_event, callback) => {
      handler = callback
      return () => {
        handler = null
      }
    },
  }
})

afterEach(() => {
  handler = null
  document.body.innerHTML = ''
})

describe('DreamNoticeHost', () => {
  it('记忆轨有待审候选时提供可点击的「去处理」入口', () => {
    const onOpenTrack = vi.fn()
    const view = mount(onOpenTrack)
    emit(state('memory', 'running', 2))
    emit(state('memory', 'succeeded', 2))

    const options = toastMocks.toast.success.mock.calls[0]?.[1]
    expect(options?.actions?.[0]?.label).toBe('去处理')
    options?.actions?.[0]?.onClick()
    expect(toastMocks.dismiss).toHaveBeenCalledWith('success-1')
    expect(onOpenTrack).toHaveBeenCalledWith('memory', 2)
    view.unmount()
  })

  it('知识库轨无待审候选时仍可打开整理记录', () => {
    const onOpenTrack = vi.fn()
    const view = mount(onOpenTrack)
    emit(state('wiki', 'queued'))
    emit(state('wiki', 'succeeded'))

    const options = toastMocks.toast.success.mock.calls[0]?.[1]
    expect(options?.actions?.[0]?.label).toBe('查看记录')
    options?.actions?.[0]?.onClick()
    expect(onOpenTrack).toHaveBeenCalledWith('wiki', 0)
    view.unmount()
  })
})
