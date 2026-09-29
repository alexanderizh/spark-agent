import {
  ToastHost as LobeToastHost,
  toast as lobeToast,
} from '@lobehub/ui/es/base-ui/Toast/imperative'
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_TOASTS, shouldRepinStickyToast } from './toast-sticky-policy'

/* ---------- Types ---------- */

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export type ToastAction = {
  label: string
  onClick: () => void
}

export type ToastItem = {
  id: string
  type: ToastType
  message: string
  duration: number
  actions: ToastAction[]
  /** Whether this toast is currently in exit animation */
  exiting: boolean
}

export type ToastOptions = {
  /** 自定义持续时间(ms)，默认 success/info/warning=5000, error=8000 */
  duration?: number
  /** 操作按钮 */
  actions?: ToastAction[]
  /**
   * 常驻提示（2026-09-30：性能监控压力横幅统一到右上角消息弹窗时引入）。
   * 语义：不自动消失（持续时间被强制为 0），并且在提示堆积、最旧一条要让位时
   * 优先保住它（见 `shouldRepinStickyToast`）。同一时刻只保留一条常驻提示，
   * 再次创建会替换上一条；用户手动关闭后不会因为后续消息被"复活"。
   */
  sticky?: boolean
}

export type ToastFn = {
  (type: ToastType, message: string, options?: ToastOptions): string
  success: (message: string, options?: ToastOptions) => string
  error: (message: string, options?: ToastOptions) => string
  info: (message: string, options?: ToastOptions) => string
  warning: (message: string, options?: ToastOptions) => string
}

export type ToastCtx = {
  toasts: ToastItem[]
  toast: ToastFn
  dismiss: (id: string) => void
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  info: 5000,
  warning: 5000,
}

const TOAST_ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
} as const

function SparkToastDescription({ type, message }: { type: ToastType; message: string }) {
  const Icon = TOAST_ICONS[type]

  return (
    <div className={`spark-toast-content spark-toast-${type}`}>
      <span className="spark-toast-status-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span className="spark-toast-message">{message}</span>
    </div>
  )
}

/* ---------- 常驻提示（sticky）可见性保障 ---------- */

type BuiltAction = {
  label: string
  onClick: () => void
  variant: 'primary' | 'ghost'
  props: { className: string }
}

/** 入队内容：生命周期回调与登记一一对应，重建置顶时重新绑定，故不放在这里。 */
type ToastContent = {
  type: ToastType
  description: ReactNode
  duration: number
  actions?: BuiltAction[]
}

type BuiltToastOptions = ToastContent & {
  icon: boolean
  onClose: () => void
  onRemove: () => void
}

/**
 * 存活提示登记（入队顺序：索引 0 最旧）。
 * 底座把新条放在数组头部，并按「最旧」标记 limited（`activeToasts.slice(-excess)`）；
 * 这里维护「最旧在前」的相反顺序，判定只看索引 0 即可。
 *
 * base-ui 的关闭/移除回调不回传 id，因此用登记对象本身做标识。
 */
type LiveToast = { sticky: boolean }

/**
 * 常驻提示登记表：随 ToastProvider 实例创建（useState 惰性初始化），而非模块级
 * 全局——多个 Provider（多窗口 / 测试用例）互不污染，卸载后随实例回收，不留残留。
 */
type ToastRegistry = {
  /** 存活提示登记，索引 0 最旧 */
  live: LiveToast[]
  /** 常驻提示登记：记住内容，拥堵时原样重建置顶 */
  sticky: { id: string; entry: LiveToast; content: ToastContent } | null
  /** 重建常驻提示期间抑制重入：重建本身就是「关旧条 + 入新条」两步 */
  repinning: boolean
}

function createToastRegistry(): ToastRegistry {
  return { live: [], sticky: null, repinning: false }
}

function buildToastContent(
  type: ToastType,
  message: string,
  options?: ToastOptions,
): ToastContent {
  const sticky = options?.sticky === true
  // 常驻提示强制 0：Lobe 把 duration 映射为底座的 timeout，底座只在 timeout > 0
  // 时才挂自动关闭定时器——即使调用方误传 duration，常驻条也不允许自己消失。
  const requested = sticky ? 0 : options?.duration ?? DEFAULT_DURATION[type]
  return {
    type,
    description: <SparkToastDescription type={type} message={message} />,
    duration: Number.isFinite(requested) ? requested : 0,
    ...(options?.actions != null && options.actions.length > 0
      ? {
          actions: options.actions.map((action, index) => ({
            label: action.label,
            onClick: action.onClick,
            variant: index === 0 ? 'primary' as const : 'ghost' as const,
            props: { className: 'spark-toast-action-button' },
          })),
        }
      : {}),
  }
}

/**
 * 注销存活登记：关闭一开始就注销，保证上限判断贴近底座的真实存活数。
 * 顺带只在登记对象仍是当前常驻条时清常驻登记——重建置顶后旧条的回调迟到，
 * 不能把刚入队的新常驻条一起清掉。
 */
function detachLiveToast(registry: ToastRegistry, entry: LiveToast): void {
  const index = registry.live.indexOf(entry)
  if (index >= 0) registry.live.splice(index, 1)
  if (registry.sticky?.entry === entry) registry.sticky = null
}

function enqueueToast(
  registry: ToastRegistry,
  content: ToastContent,
  sticky: boolean,
): string {
  const entry: LiveToast = { sticky }
  const toastOptions: BuiltToastOptions = {
    ...content,
    icon: false,
    // 用户手动关闭（右上角关闭、右滑）与底座自动关闭都会走 onClose；
    // 触发即注销登记，后续消息不会把它「复活」（看起来像关不掉）。
    onClose: () => detachLiveToast(registry, entry),
    onRemove: () => detachLiveToast(registry, entry),
  }
  const instance = lobeToast[content.type](toastOptions)
  registry.live.push(entry)
  if (sticky) registry.sticky = { id: instance.id, entry, content }
  return instance.id
}

/** 队列满且常驻条将要让位时，把它重建置顶（内容与动作保持不变）。 */
function keepStickyToastVisible(registry: ToastRegistry): void {
  const sticky = registry.sticky
  if (sticky == null || registry.repinning) return
  if (!shouldRepinStickyToast(registry.live, MAX_TOASTS)) return
  registry.repinning = true
  try {
    // 旧条正在退场，不再代表常驻登记，避免同一批入队重复判定。
    sticky.entry.sticky = false
    lobeToast.dismiss(sticky.id)
    enqueueToast(registry, sticky.content, true)
  } finally {
    registry.repinning = false
  }
}

/* ---------- Context ---------- */

const Ctx = createContext<ToastCtx | null>(null)

/* ---------- Provider ---------- */

export function ToastProvider({ children }: { children: ReactNode }) {
  // 登记表随 Provider 实例存在：多 Provider 不互相污染，卸载即回收。
  const [registry] = useState(createToastRegistry)

  // 底座的 close() 会同步回调 onClose，登记在同一 tick 内即被注销，
  // 因此这里只转发关闭即可（常驻登记不会残留成「关不掉的幽灵」）。
  const dismiss = useCallback((id: string) => {
    lobeToast.dismiss(id)
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const content = buildToastContent(type, message, options)
      if (options?.sticky === true) {
        // 单条常驻：先替换上一条，避免多条常驻提示叠加。
        if (registry.sticky != null) lobeToast.dismiss(registry.sticky.id)
        return enqueueToast(registry, content, true)
      }
      keepStickyToastVisible(registry)
      return enqueueToast(registry, content, false)
    },
    [registry],
  )

  const toastFn = useMemo<ToastFn>(() => Object.assign(
    (type: ToastType, message: string, options?: ToastOptions) => addToast(type, message, options),
    {
      success: (message: string, options?: ToastOptions) => addToast('success', message, options),
      error: (message: string, options?: ToastOptions) => addToast('error', message, options),
      info: (message: string, options?: ToastOptions) => addToast('info', message, options),
      warning: (message: string, options?: ToastOptions) => addToast('warning', message, options),
    },
  ), [addToast])

  const value = useMemo<ToastCtx>(
    () => ({ toasts: [], toast: toastFn, dismiss }),
    [toastFn, dismiss],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* ---------- Hook ---------- */

export function useToast(): ToastCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast must be inside <ToastProvider>')
  return v
}

export function useOptionalToast(): ToastCtx | null {
  return useContext(Ctx)
}

export function ToastContainer() {
  const root = typeof document === 'undefined' ? null : document.body

  return (
    <LobeToastHost
      className="spark-lobe-toast-host"
      duration={5000}
      limit={MAX_TOASTS}
      position="top-right"
      root={root}
      swipeDirection={['right', 'up']}
    />
  )
}
