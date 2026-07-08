import { useEffect, useRef } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

/**
 * useSaveShortcut — 在编辑器内接管 Cmd/Ctrl+S 触发保存。
 *
 * 与全局 useGlobalShortcuts 不同：保存动作恰好在输入框聚焦时按，
 * 因此不受 isEditableTarget 限制；只在 enabled 为真时响应，
 * 避免列表页误触发。callback 经 ref 透传，监听器只挂一次。
 */
export function useSaveShortcut(callback: () => void, enabled: boolean = true): void {
  const cbRef = useRef(callback)
  cbRef.current = callback
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 's') return
      e.preventDefault()
      e.stopPropagation()
      cbRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
