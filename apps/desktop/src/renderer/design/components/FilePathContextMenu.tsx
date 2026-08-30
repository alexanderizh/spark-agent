import { useEffect, useRef } from 'react'
import { Icons } from '../Icons'
import { canOpenInEditor, canOpenPreview, type FileOpenMode } from './fileOpenRouting'

async function copyFilePath(filePath: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(filePath)
  } catch {
    // Clipboard access can be unavailable in an untrusted renderer context.
  }
}

export function FilePathContextMenu({
  filePath,
  x,
  y,
  onClose,
  onOpenWithMode,
}: {
  filePath: string
  x: number
  y: number
  onClose: () => void
  /** 显式选择打开方式（预览/编辑）；不传则不显示对应菜单项 */
  onOpenWithMode?: (mode: FileOpenMode) => void
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

  const showPreview = onOpenWithMode != null && canOpenPreview(filePath)
  const showEdit = onOpenWithMode != null && canOpenInEditor(filePath)

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {showPreview && (
        <button
          type="button"
          className="action-menu-item"
          onClick={() => {
            onClose()
            onOpenWithMode?.('preview')
          }}
        >
          <Icons.Eye size={14} />
          <span>预览</span>
        </button>
      )}
      {showEdit && (
        <button
          type="button"
          className="action-menu-item"
          onClick={() => {
            onClose()
            onOpenWithMode?.('edit')
          }}
        >
          <Icons.Edit size={14} />
          <span>编辑</span>
        </button>
      )}
      <button
        type="button"
        className="action-menu-item"
        onClick={() => {
          onClose()
          void copyFilePath(filePath)
        }}
      >
        <Icons.Copy size={14} />
        <span>复制文件地址</span>
      </button>
    </div>
  )
}
