import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import './SidebarProjectDropZone.less'
import { Icons } from '../Icons'
import { useI18n } from '../i18n'
import { getDataTransferFilePaths, isUnresolvableFileDrop } from '../services/composer-attachments'
import { getDirectoryDropIntent } from '../services/project-folder-drop'
import { useToast } from './Toast'

export function SidebarProjectDropZone({
  children,
  onDropPaths,
}: {
  children: ReactNode
  onDropPaths: (paths: string[]) => Promise<void>
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const dragDepthRef = useRef(0)
  const [active, setActive] = useState(false)

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0
    setActive(false)
  }, [])

  useEffect(() => {
    window.addEventListener('blur', resetDragState)
    return () => window.removeEventListener('blur', resetDragState)
  }, [resetDragState])

  const canHandle = (dataTransfer: DataTransfer | null) =>
    getDirectoryDropIntent(dataTransfer) !== 'reject'

  return (
    <div
      className={`sidebar-project-drop-zone${active ? ' is-file-drop-active' : ''}`}
      data-sidebar-project-drop-zone=""
      onDragEnter={(event) => {
        if (!canHandle(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        dragDepthRef.current += 1
        setActive(true)
      }}
      onDragOver={(event) => {
        if (!canHandle(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
        setActive(true)
      }}
      onDragLeave={(event) => {
        if (!canHandle(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setActive(false)
      }}
      onDrop={(event) => {
        if (!canHandle(event.dataTransfer)) {
          resetDragState()
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const paths = getDataTransferFilePaths(event.dataTransfer)
        const unresolvable = isUnresolvableFileDrop(event.dataTransfer, paths)
        resetDragState()
        if (unresolvable) {
          toast.error(t('sidebar.dropProjects.unresolvable'))
          return
        }
        if (paths.length > 0) void onDropPaths(paths)
      }}
    >
      {children}
      {active && (
        <div className="sidebar-project-drop-overlay" aria-live="polite">
          <div className="sidebar-project-drop-message">
            <span className="sidebar-project-drop-icon" aria-hidden="true">
              <Icons.FolderPlus size={24} />
            </span>
            <strong>{t('sidebar.dropProjects.title')}</strong>
            <span>{t('sidebar.dropProjects.hint')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
