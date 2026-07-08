import { useEffect } from 'react'
import type { SessionId } from '@spark/protocol'
import type { SessionSummary } from '../SessionSidebarContext'
import { isEditableTarget } from './useKeyboard'

/** 是否存在会拦截全局快捷键的弹层（Ant Modal / 自定义 modal / Git 对话框等）。 */
export function isModalOverlayVisible(): boolean {
  if (document.querySelector('.ant-modal-root:not(.ant-modal-hidden)')) return true
  if (document.querySelector('.modal-backdrop')) return true
  if (document.querySelector('.git-dialog-overlay')) return true
  return false
}

function shouldSkipEnterConfirm(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName === 'INPUT') return true
  if (target.isContentEditable) return true
  return false
}

function getTopVisibleAntModal(): HTMLElement | null {
  const roots = Array.from(document.querySelectorAll('.ant-modal-root'))
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i]
    if (!root || root.classList.contains('ant-modal-hidden')) continue
    const wrap = root.querySelector('.ant-modal-wrap')
    if (wrap instanceof HTMLElement && wrap.offsetParent !== null) return wrap
  }
  return null
}

function clickDialogPrimaryButton(container: ParentNode): boolean {
  const selectors = [
    '.ant-modal-footer .ant-btn-primary:not([disabled])',
    '.ant-modal-footer .ant-btn-ok:not([disabled])',
    '.btn.primary:not(:disabled)',
    '.git-action-row.primary:not(:disabled)',
    '.clear-confirm-bar .danger-btn:not(:disabled)',
  ]
  for (const selector of selectors) {
    const btn = container.querySelector(selector)
    if (btn instanceof HTMLButtonElement && !btn.disabled) {
      btn.click()
      return true
    }
  }
  return false
}

/** 弹窗打开时按 Enter 触发主操作按钮（确认 / 提交 / 批准等）。 */
export function useGlobalDialogEnterConfirm(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Enter' || event.repeat) return
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
      if (shouldSkipEnterConfirm(event.target)) return

      const antModal = getTopVisibleAntModal()
      if (antModal && clickDialogPrimaryButton(antModal)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      for (const selector of ['.modal-backdrop', '.git-dialog-overlay']) {
        const overlays = Array.from(document.querySelectorAll<HTMLElement>(selector))
        const top = overlays.find((el) => el.offsetParent !== null)
        if (top && clickDialogPrimaryButton(top)) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }

      const clearConfirm = document.querySelector('.clear-confirm-bar')
      if (clearConfirm && clickDialogPrimaryButton(clearConfirm)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])
}

export function useSessionDeleteShortcut(options: {
  enabled: boolean
  activeSessionId: SessionId | null
  sessions: SessionSummary[]
  onDeleteSession: (session: SessionSummary) => void | Promise<void>
  isBlocked?: () => boolean
}): void {
  const { enabled, activeSessionId, sessions, onDeleteSession, isBlocked } = options

  useEffect(() => {
    if (!enabled) return

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (!activeSessionId) return
      if (isEditableTarget(event.target)) return
      if (isBlocked?.()) return

      const session = sessions.find((item) => item.id === activeSessionId)
      if (!session) return

      event.preventDefault()
      event.stopPropagation()
      void onDeleteSession(session)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeSessionId, enabled, isBlocked, onDeleteSession, sessions])
}
