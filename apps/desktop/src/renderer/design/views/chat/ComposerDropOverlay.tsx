import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ComposerDropOverlayProps {
  active: boolean
  className: string
  children: ReactNode
}

/**
 * 将拖拽遮罩挂到当前 Composer 所属的会话面板，而不是 document/viewport。
 *
 * Composer 既可能位于主会话 `.chat-main`，也可能位于侧聊 `.side-chat-panel`；
 * 用组件内 marker 找最近宿主，避免全屏 fixed 遮罩盖住统一侧面板、文件树或其他面板。
 */
export function ComposerDropOverlay({
  active,
  className,
  children,
}: ComposerDropOverlayProps): ReactNode {
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setHost(markerRef.current?.closest<HTMLElement>('.chat-main, .side-chat-panel') ?? null)
  }, [])

  return (
    <>
      <span ref={markerRef} className="composer-drop-overlay-anchor" aria-hidden="true" />
      {active && host != null
        ? createPortal(
            <div className={className} aria-live="polite">
              {children}
            </div>,
            host,
          )
        : null}
    </>
  )
}
