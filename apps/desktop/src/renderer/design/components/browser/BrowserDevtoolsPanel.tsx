import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  RefObject,
} from 'react'
import { Icons } from '../../Icons'

interface BrowserDevtoolsPanelProps {
  height: number
  bodyRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResizePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function BrowserDevtoolsPanel({
  height,
  bodyRef,
  onClose,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerEnd,
}: BrowserDevtoolsPanelProps): ReactElement {
  return (
    <section
      className="browser-devtools-panel"
      style={{ height } as CSSProperties}
      aria-label="网页控制台"
    >
      <div
        className="browser-devtools-resize-handle"
        role="separator"
        aria-label="调整网页控制台高度"
        aria-orientation="horizontal"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerEnd}
        onPointerCancel={onResizePointerEnd}
      />
      <header className="browser-devtools-header">
        <span className="browser-devtools-title">网页控制台</span>
        <span className="browser-devtools-target">当前标签页</span>
        <button
          type="button"
          className="browser-devtools-close"
          aria-label="关闭网页控制台"
          title="关闭"
          onClick={onClose}
        >
          <Icons.X size={14} />
        </button>
      </header>
      <div ref={bodyRef} className="browser-devtools-body" aria-hidden="true" />
    </section>
  )
}
