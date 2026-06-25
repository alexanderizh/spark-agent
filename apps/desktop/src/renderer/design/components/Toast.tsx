import {
  ToastHost as LobeToastHost,
  toast as lobeToast,
} from '@lobehub/ui/es/base-ui/Toast/imperative'
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

/* ---------- Provider ---------- */

export function ToastProvider({ children }: { children: ReactNode }) {
  const dismiss = useCallback((id: string) => {
    lobeToast.dismiss(id)
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const duration = options?.duration ?? DEFAULT_DURATION[type]
      const toastOptions = {
        description: message,
        duration: Number.isFinite(duration) ? duration : 0,
        ...(options?.actions != null && options.actions.length > 0
          ? {
              actions: options.actions.map((action, index) => ({
                label: action.label,
                onClick: action.onClick,
                variant: index === 0 ? 'primary' as const : 'ghost' as const,
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

export function ToastContainer() {
  return (
    <LobeToastHost
      className="spark-lobe-toast-host"
      duration={5000}
      limit={MAX_TOASTS}
      position="top-right"
      swipeDirection={['right', 'up']}
    />
  )
}
