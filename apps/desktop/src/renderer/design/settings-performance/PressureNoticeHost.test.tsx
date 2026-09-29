// @vitest-environment jsdom

/**
 * 压力通知（2026-09-30 统一到右上角消息弹窗）的行为锁。
 *
 * 关注点：
 * - emergency 才提示，且必须走统一 Toast 的常驻模式（sticky），不再自绘横幅；
 * - 降级/恢复要主动关掉常驻弹窗，恢复时补一条成功提示；
 * - 挂载前已发生的级别不补发（避免每次切页重放历史事件）；
 * - 长时间停在 emergency 时不重复创建弹窗。
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PressureLevel, ResourcePressureChangedPayload } from '@spark/protocol'

type NoticeOptions = {
  sticky?: boolean
  duration?: number
  actions?: { label: string; onClick: () => void }[]
}

const toastMocks = vi.hoisted(() => {
  /** 记录最后一次常驻提示的消息与参数：避免对 mock.calls 做可能越界的索引。 */
  const captured: { message: string; options: NoticeOptions | undefined } = {
    message: '',
    options: undefined,
  }
  const warning = vi.fn((message: string, options?: NoticeOptions) => {
    captured.message = message
    captured.options = options
    return 'notice-1'
  })
  const toast = Object.assign(
    vi.fn((_message: string) => 'toast-default'),
    {
      success: vi.fn((_message: string, _options?: NoticeOptions) => 'toast-ok'),
      error: vi.fn((_message: string) => 'toast-err'),
      info: vi.fn((_message: string) => 'toast-info'),
      warning,
    },
  )
  return { toast, warning, captured, dismiss: vi.fn((_id?: string) => undefined) }
})

const appMocks = vi.hoisted(() => ({ setTweak: vi.fn() }))

vi.mock('../AppContext', () => ({
  useApp: () => ({ setTweak: appMocks.setTweak }),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: toastMocks.toast, dismiss: toastMocks.dismiss, toasts: [] }),
}))

import { PressureNoticeHost } from './PressureNoticeHost'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type PressureHandler = (payload: ResourcePressureChangedPayload) => void

let handler: PressureHandler | null = null
const offMock = vi.fn()

function payload(
  level: PressureLevel,
  previousLevel: PressureLevel,
  changedAt = new Date().toISOString(),
  triggeredBy: string[] = ['host-rss-pct'],
): ResourcePressureChangedPayload {
  return {
    level,
    previousLevel,
    changedAt,
    triggeredBy,
  } as unknown as ResourcePressureChangedPayload
}

function mount(): { unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<PressureNoticeHost />)
  })
  return {
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function emit(next: ResourcePressureChangedPayload): void {
  if (handler == null) throw new Error('压力事件未被订阅')
  act(() => handler?.(next))
}

beforeEach(() => {
  handler = null
  vi.clearAllMocks()
  toastMocks.captured.message = ''
  toastMocks.captured.options = undefined
  ;(window as unknown as { spark: { on: unknown } }).spark = {
    on: (_event: string, cb: PressureHandler) => {
      handler = cb
      return offMock
    },
  }
})

afterEach(() => {
  handler = null
})

describe('PressureNoticeHost', () => {
  it('emergency 走统一 Toast 的常驻提示，并带「查看性能」动作', () => {
    const view = mount()
    emit(payload('emergency', 'critical'))

    expect(toastMocks.toast.warning).toHaveBeenCalledTimes(1)
    expect(toastMocks.captured.message).toContain('已暂停新任务派发')
    expect(toastMocks.captured.message).toContain('而非应用故障')
    expect(toastMocks.captured.options?.sticky).toBe(true)
    const action = toastMocks.captured.options?.actions?.[0]
    expect(action?.label).toBe('查看性能')
    action?.onClick()
    expect(appMocks.setTweak).toHaveBeenCalledWith('view', 'settings')
    expect(appMocks.setTweak).toHaveBeenCalledWith('settingsSection', 'performance')
    view.unmount()
  })

  it('warning / critical 保持静默，不产生任何提示', () => {
    const view = mount()
    emit(payload('warning', 'nominal'))
    emit(payload('critical', 'warning'))

    expect(toastMocks.toast.warning).not.toHaveBeenCalled()
    expect(toastMocks.toast.success).not.toHaveBeenCalled()
    expect(toastMocks.dismiss).not.toHaveBeenCalled()
    view.unmount()
  })

  it('降级离开 emergency 时关闭常驻弹窗', () => {
    const view = mount()
    emit(payload('emergency', 'critical'))
    emit(payload('critical', 'emergency'))

    expect(toastMocks.dismiss).toHaveBeenCalledWith('notice-1')
    expect(toastMocks.toast.success).not.toHaveBeenCalled()
    view.unmount()
  })

  it('完全恢复到 nominal 时关闭弹窗并补一条成功提示', () => {
    const view = mount()
    emit(payload('emergency', 'critical'))
    emit(payload('nominal', 'emergency'))

    expect(toastMocks.dismiss).toHaveBeenCalledWith('notice-1')
    expect(toastMocks.toast.success).toHaveBeenCalledWith(
      '电脑资源已恢复，任务派发已继续',
      { duration: 4000 },
    )
    view.unmount()
  })

  it('挂载前已发生的事件不补发（避免切页重放历史）', () => {
    const view = mount()
    emit(payload('emergency', 'critical', '2020-01-01T00:00:00.000Z'))

    expect(toastMocks.toast.warning).not.toHaveBeenCalled()
    view.unmount()
  })

  it('长时间停在 emergency 且现象未变时不重复弹窗', () => {
    const view = mount()
    emit(payload('emergency', 'critical'))
    emit(payload('emergency', 'critical'))

    expect(toastMocks.toast.warning).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('现象变化时用新文案重建常驻弹窗', () => {
    const view = mount()
    emit(payload('emergency', 'critical'))
    emit(payload('emergency', 'critical', new Date().toISOString(), ['children-count']))

    expect(toastMocks.dismiss).toHaveBeenCalledWith('notice-1')
    expect(toastMocks.toast.warning).toHaveBeenCalledTimes(2)
    expect(toastMocks.captured.message).toContain('后台进程数量过多')
    view.unmount()
  })

  it('卸载时关闭常驻弹窗并退订事件流', () => {
    const view = mount()
    emit(payload('emergency', 'critical'))
    view.unmount()

    expect(toastMocks.dismiss).toHaveBeenCalledWith('notice-1')
    expect(offMock).toHaveBeenCalled()
  })
})
