/**
 * EditorContextMenu —— Monaco 编辑器自建中文右键菜单浮层。
 *
 * monaco 原生右键菜单文案无法运行时中文化（见 editorMenuActions.ts 说明），故 CodeViewerEditor
 * 禁用原生 contextmenu、改由本浮层承载。菜单项由 getEditorMenuItems 生成：
 *  - 原生项（剪切/复制/粘贴/全选/查找/替换/格式化/折叠展开）点击调 editor.getAction(id).run()
 *    复用 monaco 原生能力，环境不支持的项自动隐藏；
 *  - 底部「添加选中代码到会话」「添加文件到会话」走 composerInsert 追加通道。
 *
 * 样式复用项目已有的 .action-menu / .action-menu-item（与 FilePathContextMenu 同源），
 * 分隔线用内联样式 + var(--border) 适配主题，避免新增 less 文件。
 */
import { useEffect, useRef } from 'react'
import type * as Monaco from 'monaco-editor'
import { getEditorMenuItems } from './editorMenuActions'

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor

export interface EditorContextMenuProps {
  editor: MonacoEditor
  filePath: string
  readOnly: boolean
  /** 浮层左上角屏幕坐标（onContextMenu 的 clientX/clientY） */
  x: number
  y: number
  onClose: () => void
}

const MENU_WIDTH = 210
const MENU_ITEM_HEIGHT = 32
const MENU_SEP_HEIGHT = 9

export function EditorContextMenu({
  editor,
  filePath,
  readOnly,
  x,
  y,
  onClose,
}: EditorContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  // 点击浮层外部 / 按 Esc 关闭（与 FilePathContextMenu 一致的行为）
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const items = getEditorMenuItems(editor, filePath, readOnly)

  // 边界检测：避免菜单溢出视口右/下边缘
  const approxHeight = items.reduce(
    (sum, item) => sum + (item.separator ? MENU_SEP_HEIGHT : MENU_ITEM_HEIGHT),
    0,
  )
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - approxHeight - 8))

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu editor-context-menu"
      style={{ position: 'fixed', left, top, zIndex: 10000, minWidth: MENU_WIDTH }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        // 浮层内再右键：关闭当前浮层（交给编辑器重新触发，避免叠层）
        event.preventDefault()
        onClose()
      }}
    >
      {items.map((item) =>
        item.separator ? (
          <div
            key={item.key}
            style={{ height: 1, margin: '4px 8px', background: 'var(--border)' }}
          />
        ) : (
          <button
            key={item.key}
            type="button"
            className="action-menu-item"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect?.()
            }}
          >
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  )
}
