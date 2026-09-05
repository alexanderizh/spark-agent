/**
 * BuiltInTerminalContextMenu — 内置终端右键菜单。
 *
 * 复用 FilePathContextMenu / UrlContextMenu 的 .action-menu 样式与交互习惯
 * （fixed 定位、外部 mousedown / ESC 关闭）。菜单项按上下文裁剪：
 *   - 有选区 → 复制
 *   - 始终   → 粘贴 / 全选 / 清屏
 *   - 点在链接上 → 打开链接 / 复制链接地址
 */
import { useEffect, useRef } from 'react'
import { Icons } from '../../Icons'

export interface TerminalContextMenuState {
  x: number
  y: number
  terminalId: string
  hasSelection: boolean
  /** 鼠标位置所在逻辑行的 URL；null 时隐藏链接相关菜单项 */
  linkUrl: string | null
}

export interface TerminalContextMenuActions {
  onCopy: () => void
  onPaste: () => void
  onSelectAll: () => void
  onClear: () => void
  onOpenLink: (url: string) => void
  onCopyLink: (url: string) => void
}

/** 视口边缘安全边距：菜单统一向内收，避免溢出窗口 */
const VIEWPORT_MARGIN_X = 200
const VIEWPORT_MARGIN_Y = 280

export function BuiltInTerminalContextMenu({
  state,
  actions,
  onClose,
}: {
  state: TerminalContextMenuState
  actions: TerminalContextMenuActions
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const left = Math.max(4, Math.min(state.x, window.innerWidth - VIEWPORT_MARGIN_X))
  const top = Math.max(4, Math.min(state.y, window.innerHeight - VIEWPORT_MARGIN_Y))

  const run = (action: () => void) => {
    onClose()
    action()
  }

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu"
      style={{ position: 'fixed', left, top, zIndex: 10000 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.hasSelection && (
        <button type="button" className="action-menu-item" onClick={() => run(actions.onCopy)}>
          <Icons.Copy size={14} />
          <span>复制</span>
        </button>
      )}
      <button type="button" className="action-menu-item" onClick={() => run(actions.onPaste)}>
        <Icons.Clipboard size={14} />
        <span>粘贴</span>
      </button>
      <button type="button" className="action-menu-item" onClick={() => run(actions.onSelectAll)}>
        <Icons.CheckSquare size={14} />
        <span>全选</span>
      </button>
      {state.linkUrl != null && (
        <>
          <div className="terminal-context-menu-divider" role="separator" />
          <button
            type="button"
            className="action-menu-item"
            onClick={() => run(() => actions.onOpenLink(state.linkUrl as string))}
          >
            <Icons.ExternalLink size={14} />
            <span>打开链接</span>
          </button>
          <button
            type="button"
            className="action-menu-item"
            onClick={() => run(() => actions.onCopyLink(state.linkUrl as string))}
          >
            <Icons.Link size={14} />
            <span>复制链接地址</span>
          </button>
        </>
      )}
      <div className="terminal-context-menu-divider" role="separator" />
      <button type="button" className="action-menu-item" onClick={() => run(actions.onClear)}>
        <Icons.Eraser size={14} />
        <span>清屏</span>
      </button>
    </div>
  )
}
