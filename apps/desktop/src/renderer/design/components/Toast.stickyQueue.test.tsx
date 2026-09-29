// @vitest-environment jsdom

/**
 * 常驻提示（sticky）在「队列超上限」时的行为锁。
 *
 * base-ui 的 Toast 在存活条数超过 limit 时会把最旧一条标记为 limited
 * （opacity: 0 + inert），而常驻提示最早入队、因此最容易被隐藏。这里用桩掉的
 * lobe 底座（只复现 add/dismiss + onClose/onRemove 回调契约）验证行为：
 * 1) 队列没满时不做任何多余动作，常驻条不被打扰；
 * 2) 常驻条将要让位时会被重建置顶，而不是自己被隐藏；
 * 3) 用户手动关掉常驻条后，后续消息不会把它"复活"；
 * 4) 常驻语义不被调用方误传的 duration 破坏。
 */
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StubToastOptions = {
  description?: unknown
  duration?: number
  onClose?: () => void
  onRemove?: () => void
  actions?: unknown[]
}

const lobe = vi.hoisted(() => {
  const adds: { id: string; type: string; options: StubToastOptions }[] = []
  const dismisses: string[] = []
  let seq = 0

  const make = (type: string) => (options: StubToastOptions) => {
    const id = `${type}-${++seq}`
    adds.push({ id, type, options })
    return { id, close: () => undefined, update: () => undefined }
  }

  const dismiss = (id?: string) => {
    dismisses.push(id ?? '*')
    for (const entry of adds) {
      if (id == null || entry.id === id) entry.options.onClose?.()
    }
  }

  return {
    adds,
    dismisses,
    toast: Object.assign(make('default'), {
      success: make('success'),
      error: make('error'),
      info: make('info'),
      warning: make('warning'),
      loading: make('loading'),
      promise: () => undefined,
      dismiss,
    }),
    /** 模拟用户点关闭按钮/右滑（底座自己关，不经过我们的 dismiss）。 */
    closeByUser(index: number): void {
      const entry = adds[index]
      entry?.options.onClose?.()
      entry?.options.onRemove?.()
    },
    /** 每个用例前重置桩自身状态（登记表随 Provider 实例创建，无需反向清理）。 */
    reset(): void {
      for (const entry of adds) {
        entry.options.onClose?.()
        entry.options.onRemove?.()
      }
      adds.length = 0
      dismisses.length = 0
      seq = 0
    },
  }
})

vi.mock('@lobehub/ui/es/base-ui/Toast/imperative', () => ({
  ToastHost: () => null,
  toast: lobe.toast,
}))

import { ToastProvider, useToast } from './Toast'
import type { ToastCtx } from './Toast'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 挂载后由 Probe 写入：测试拿它调用真实的 useToast API。 */
const holder: { api: ToastCtx | null } = { api: null }

function Probe({ onReady }: { onReady: (ctx: ToastCtx) => void }): null {
  const ctx = useToast()
  useEffect(() => {
    onReady(ctx)
  }, [ctx, onReady])
  return null
}

function mountProvider(): { unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ToastProvider>
        <Probe onReady={(ctx) => { holder.api = ctx }} />
      </ToastProvider>,
    )
  })
  return {
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/**
 * 取当前 Provider 暴露的 API。未挂载即用例自身写错，直接抛错比非空断言可读。
 */
function toastApi(): ToastCtx {
  if (holder.api == null) throw new Error('ToastProvider 未挂载')
  return holder.api
}

function warningAdds(): typeof lobe.adds {
  return lobe.adds.filter((entry) => entry.type === 'warning')
}

function infoAdds(): typeof lobe.adds {
  return lobe.adds.filter((entry) => entry.type === 'info')
}

beforeEach(() => {
  lobe.reset()
  holder.api = null
  vi.clearAllMocks()
})

describe('sticky 常驻提示的队列上限保护', () => {
  it('常驻提示不自动消失（强制 duration 0）', () => {
    const provider = mountProvider()
    const id = toastApi().toast.warning('资源压力高', { sticky: true, actions: [{ label: '查看性能', onClick: vi.fn() }] })

    expect(id).toBe('warning-1')
    expect(warningAdds()[0]?.options.duration).toBe(0)
    expect(warningAdds()[0]?.options.actions).toHaveLength(1)
    provider.unmount()
  })

  it('队列没满时不动常驻提示，也不提前关闭别的提示', () => {
    const provider = mountProvider()
    toastApi().toast.warning('资源压力高', { sticky: true })
    for (let i = 0; i < 4; i += 1) toastApi().toast.info(`临时提示 ${i + 1}`)

    expect(infoAdds()).toHaveLength(4)
    expect(warningAdds()).toHaveLength(1)
    expect(lobe.dismisses).toEqual([])
    provider.unmount()
  })

  it('第 5 条临时提示入队前把常驻提示重建置顶，而不是让它自己被隐藏', () => {
    const provider = mountProvider()
    toastApi().toast.warning('资源压力高', { sticky: true, actions: [{ label: '查看性能', onClick: vi.fn() }] })
    for (let i = 0; i < 4; i += 1) toastApi().toast.info(`临时提示 ${i + 1}`)
    toastApi().toast.info('临时提示 5')

    // 重建 = 关掉旧常驻条 + 用同样的内容重新入队
    expect(lobe.dismisses).toEqual(['warning-1'])
    expect(warningAdds()).toHaveLength(2)
    const rebuilt = warningAdds()[1]
    expect(rebuilt?.options.duration).toBe(0)
    expect(rebuilt?.options.actions).toHaveLength(1)
    // 重建发生在第 5 条临时提示入队之前：新常驻条比它更早入队，
    // 底座按「最旧一条」标记 limited 时，命中的是临时提示而非常驻条。
    expect(lobe.adds.map((entry) => entry.id)).toEqual([
      'warning-1',
      'info-2',
      'info-3',
      'info-4',
      'info-5',
      'warning-6',
      'info-7',
    ])
    provider.unmount()
  })

  it('调用方误传 duration 也强制 0（常驻条不允许自己消失）', () => {
    const provider = mountProvider()
    toastApi().toast.warning('资源压力高', { sticky: true, duration: 5000 })

    expect(warningAdds()).toHaveLength(1)
    expect(warningAdds()[0]?.options.duration).toBe(0)
    provider.unmount()
  })

  it('上层主动 dismiss 常驻提示后，队列积满也不会把它重建出来', () => {
    const provider = mountProvider()
    const id = toastApi().toast.warning('资源压力高', { sticky: true })
    for (let i = 0; i < 4; i += 1) toastApi().toast.info(`临时提示 ${i + 1}`)

    // 上层主动关闭（例如压力已恢复）
    toastApi().dismiss(id)
    expect(lobe.dismisses).toEqual([id])

    // 队列随后继续堆积到上限：已关闭的常驻条不得被重建（否则看起来像关不掉）
    for (let i = 5; i <= 9; i += 1) toastApi().toast.info(`临时提示 ${i}`)

    expect(warningAdds()).toHaveLength(1)
    expect(lobe.dismisses).toEqual([id])
    provider.unmount()
  })

  it('用户手动关掉常驻提示后，后续消息不会把它复活', () => {
    const provider = mountProvider()
    toastApi().toast.warning('资源压力高', { sticky: true })
    expect(warningAdds()).toHaveLength(1)

    // 用户在界面上关掉它（底座自己触发 onClose/onRemove）
    lobe.closeByUser(0)

    for (let i = 0; i < 6; i += 1) toastApi().toast.info(`临时提示 ${i + 1}`)

    expect(warningAdds()).toHaveLength(1)
    expect(lobe.dismisses).toEqual([])
    provider.unmount()
  })

  it('重新创建常驻提示会替换上一条，避免多条常驻叠加', () => {
    const provider = mountProvider()
    toastApi().toast.warning('资源压力高', { sticky: true })
    toastApi().toast.warning('资源压力更高', { sticky: true })

    expect(lobe.dismisses).toEqual(['warning-1'])
    expect(warningAdds()).toHaveLength(2)
    provider.unmount()
  })

  it('普通提示保持原有语义（默认时长、不进入常驻登记）', () => {
    const provider = mountProvider()
    toastApi().toast.success('普通成功')
    toastApi().toast.error('普通失败')

    expect(lobe.adds[0]?.options.duration).toBe(5000)
    expect(lobe.adds[1]?.options.duration).toBe(8000)
    expect(warningAdds()).toHaveLength(0)
    provider.unmount()
  })
})
