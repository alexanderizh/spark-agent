/**
 * Toast — 轻量级全局通知系统
 *
 * 支持 success / error / info / warning 四种类型，
 * 自动消失（默认 5s，error 默认不消失），可手动关闭，
 * 右上角弹出，堆叠排列（最多 5 个），从右侧滑入/滑出。
 * 支持操作按钮（如"重试"、"查看详情"）。
 *
 * 使用方式：
 *   import { useToast } from './components/Toast'
 *   const { toast } = useToast()
 *   toast.success('操作成功')
 *   toast.error('连接失败', { duration: 8000 })
 *   toast.error('保存失败', { actions: [{ label: '重试', onClick: () => retry() }] })
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

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
  /** 自定义持续时间(ms)，默认 success/info/warning=5000, error=Infinity (不消失) */
  duration?: number
  /** 操作按钮 */
  actions?: ToastAction[]
}

type ToastFn = {
  (type: ToastType, message: string, options?: ToastOptions): string
  success: (message: string, options?: ToastOptions) => string
  error: (message: string, options?: ToastOptions) => string
  info: (message: string, options?: ToastOptions) => string
  warning: (message: string, options?: ToastOptions) => string
}

type ToastCtx = {
  toasts: ToastItem[]
  toast: ToastFn
  dismiss: (id: string) => void
}

const MAX_TOASTS = 5

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 5000,
  error: Infinity,
  info: 5000,
  warning: 5000,
}

/* ---------- Context ---------- */

const Ctx = createContext<ToastCtx | null>(null)

let _nextId = 0

/* ---------- Provider ---------- */

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    // Mark as exiting first (triggers slide-out animation)
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))

    // Remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 260)
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const id = `toast-${++_nextId}`
      const duration = options?.duration ?? DEFAULT_DURATION[type]
      const actions = options?.actions ?? []
      const item: ToastItem = { id, type, message, duration, actions, exiting: false }

      setToasts((prev) => {
        // Keep at most MAX_TOASTS - add new one and trim from the front
        const next = [...prev, item]
        // If over limit, dismiss the oldest non-exiting toast
        if (next.length > MAX_TOASTS) {
          const oldest = next.find((t) => !t.exiting)
          if (oldest) {
            const idx = next.indexOf(oldest)
            next.splice(idx, 1)
          }
        }
        return next
      })

      // Auto-dismiss (only if duration is finite)
      if (isFinite(duration) && duration > 0) {
        setTimeout(() => {
          dismiss(id)
        }, duration)
      }

      return id
    },
    [dismiss],
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
    () => ({ toasts, toast: toastFn, dismiss }),
    [toasts, toastFn, dismiss],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* ---------- Hook ---------- */

export function useToast(): ToastCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast must be inside <ToastProvider>')
  return v
}

/* ---------- Toast Container (rendered in App) ---------- */

const TYPE_ICON: Record<ToastType, ReactNode> = {
  success: <Icons.CheckCircle size={16} />,
  error: <Icons.XCircle size={16} />,
  info: <Icons.Bell size={16} />,
  warning: <Icons.AlertTriangle size={16} />,
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const animClass = item.exiting ? 'toast-exit' : 'toast-enter'
  const showProgress = isFinite(item.duration) && item.duration > 0

  return (
    <div className={`toast toast-${item.type} ${animClass}`} role="alert">
      <span className="toast-icon">{TYPE_ICON[item.type]}</span>
      <div className="toast-body">
        <span className="toast-msg">{item.message}</span>
        {item.actions.length > 0 && (
          <div className="toast-actions">
            {item.actions.map((action, i) => (
              <button
                key={i}
                className={i === 0 ? 'btn primary sm' : 'btn ghost sm'}
                onClick={() => { action.onClick(); onDismiss() }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icons.X size={12} />
      </button>
      {showProgress && (
        <div
          className="toast-progress"
          style={{ animationDuration: `${item.duration}ms` }}
        />
      )}
    </div>
  )
}

export function ToastContainer() {
  const { toasts, dismiss } = useToast()
  if (toasts.length === 0) return null
  return (
    <div className="toast-container">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>
  )
}
