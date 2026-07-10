import {
  ToastHost as LobeToastHost,
  toast as lobeToast,
} from '@lobehub/ui/es/base-ui/Toast/imperative'
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

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

const MAX_TOASTS = 5

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

/* ---------- Context ---------- */

const Ctx = createContext<ToastCtx | null>(null)

/* ---------- Provider ---------- */

export function ToastProvider({ children }: { children: ReactNode }) {
  const dismiss = useCallback((id: string) => {
    lobeToast.dismiss(id)
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const duration = options?.duration ?? DEFAULT_DURATION[type]
      const toastOptions = {
        description: <SparkToastDescription type={type} message={message} />,
        duration: Number.isFinite(duration) ? duration : 0,
        icon: false,
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
      const instance = lobeToast[type](toastOptions)
      return instance.id
    },
    [],
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
