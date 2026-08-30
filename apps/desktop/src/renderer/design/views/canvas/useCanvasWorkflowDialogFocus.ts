import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useCanvasWorkflowDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current
      const preferred = container?.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      const first = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(preferred ?? first)?.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [containerRef, open])
}
