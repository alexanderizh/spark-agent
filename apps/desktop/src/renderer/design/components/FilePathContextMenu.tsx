import { useEffect, useRef } from 'react'
import { Icons } from '../Icons'

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
}: {
  filePath: string
  x: number
  y: number
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

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
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
