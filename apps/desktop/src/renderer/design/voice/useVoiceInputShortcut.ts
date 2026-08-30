import { useEffect, useLayoutEffect, useRef } from 'react'
import { isModalOverlayVisible } from '../hooks/useAppDialogKeyboard'

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

export const VOICE_INPUT_SHORTCUT_LABEL = isMac ? '⌃⇧D' : 'Ctrl+Shift+D'
export const VOICE_INPUT_ARIA_SHORTCUT = 'Control+Shift+D'

export function isVoiceInputShortcut(event: {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat: boolean
}): boolean {
  return (
    event.key.toLowerCase() === 'd' &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.repeat
  )
}

/** Composer 存在时，用 Control+Shift+D 在开始/结束语音输入之间切换。 */
export function useVoiceInputShortcut(options: {
  disabled: boolean
  onToggle: () => void
}): void {
  const disabledRef = useRef(options.disabled)
  const onToggleRef = useRef(options.onToggle)
  useLayoutEffect(() => {
    disabledRef.current = options.disabled
    onToggleRef.current = options.onToggle
  }, [options.disabled, options.onToggle])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isVoiceInputShortcut(event)) return
      if (event.isComposing || event.keyCode === 229) return
      if (disabledRef.current || isModalOverlayVisible()) return
      event.preventDefault()
      event.stopPropagation()
      onToggleRef.current()
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])
}
