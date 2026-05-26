/**
 * Toast — 轻量级全局通知系统
 *
 * 支持 success / error / info / warning 四种类型，
 * 自动消失（success/info/warning 3s，error 5s），可手动关闭，
 * 右上角弹出，堆叠排列。
 *
 * 使用方式：
 *   import { useToast } from './components/Toast'
 *   const { toast } = useToast()
 *   toast.success('操作成功')
 *   toast.error('连接失败', { duration: 8000 })
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

/* ---------- Types ---------- */

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export type ToastItem = {
  id: string
  type: ToastType
  message: string
  duration: number
}

export type ToastOptions = {
  /** 自定义持续时间(ms)，默认 success/info/warning=3000, error=5000 */
  duration?: number
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

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  info: 3000,
  warning: 3000,
}

/* ---------- Context ---------- */

const Ctx = createContext<ToastCtx | null>(null)

let _nextId = 0

/* ---------- Provider ---------- */

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const id = `toast-${++_nextId}`
      const duration = options?.duration ?? DEFAULT_DURATION[type]
      const item: ToastItem = { id, type, message, duration }
      setToasts((prev) => [...prev, item])
      // Auto-dismiss
      setTimeout(() => {
        dismiss(id)
      }, duration)
      return id
    },
    [dismiss],
  )

  const toastFn = useCallback<ToastFn>(
    ((type: ToastType, message: string, options?: ToastOptions) =>
      addToast(type, message, options)) as ToastFn,
    [addToast],
  )

  toastFn.success = (message, options) => addToast('success', message, options)
  toastFn.error = (message, options) => addToast('error', message, options)
  toastFn.info = (message, options) => addToast('info', message, options)
  toastFn.warning = (message, options) => addToast('warning', message, options)

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
  return (
    <div className={`toast toast-${item.type}`} role="alert">
      <span className="toast-icon">{TYPE_ICON[item.type]}</span>
      <span className="toast-msg">{item.message}</span>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icons.X size={12} />
      </button>
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
