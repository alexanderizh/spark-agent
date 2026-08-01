import FileViewer from '@file-viewer/react'
import type { FileViewerHandle, FileViewerProps, ViewerViewState } from '@file-viewer/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { createOfficeViewerOptions } from './officeViewerOptions'
import { useOptionalCapabilities } from '../optional-capabilities/useOptionalCapabilities'

export default function OfficeFileViewer({
  options: _options,
  onStateChange,
  ...props
}: FileViewerProps): ReactNode {
  const capabilities = useOptionalCapabilities()
  const resolvedTheme = useResolvedTheme()
  const [viewerTheme, setViewerTheme] = useState(resolvedTheme)
  const viewerRef = useRef<FileViewerHandle>(null)
  const pendingViewStateRef = useRef<ViewerViewState | null>(null)
  const options = useMemo(
    () => createOfficeViewerOptions(viewerTheme, 'capability-asset://office-viewer/'),
    [viewerTheme],
  )

  useEffect(() => {
    if (resolvedTheme === viewerTheme) return
    pendingViewStateRef.current = viewerRef.current?.getViewState() ?? null
    const frame = window.requestAnimationFrame(() => setViewerTheme(resolvedTheme))
    return () => window.cancelAnimationFrame(frame)
  }, [resolvedTheme, viewerTheme])

  const handleStateChange = useCallback<NonNullable<FileViewerProps['onStateChange']>>(
    (state, event) => {
      onStateChange?.(state, event)
      const pendingViewState = pendingViewStateRef.current
      if (!state.ready || pendingViewState == null) return
      pendingViewStateRef.current = null
      void viewerRef.current?.applyViewState(pendingViewState, {
        action: 'restore',
        source: 'api',
      })
    },
    [onStateChange],
  )

  const office = capabilities.snapshot?.capabilities.find((item) => item.id === 'office-viewer')
  const officeReady = office?.installedVersion != null && office.state !== 'damaged'
  if (!officeReady) {
    const progress = capabilities.progress['office-viewer']
    const installing =
      progress != null &&
      ['queued', 'downloading', 'verifying', 'extracting', 'activating'].includes(progress.phase)
    return (
      <div className="office-viewer-capability-placeholder" role="status">
        <strong>需要安装离线 Office 预览资源</strong>
        <span>
          {office?.targetVersion
            ? `需下载约 ${(office.downloadSize / 1024 / 1024).toFixed(1)} MB，安装后会自动重试预览。`
            : '当前平台暂时没有可用的 Office 预览资源。'}
        </span>
        {installing ? (
          <span>{progress.message}{progress.percent != null ? ` · ${progress.percent}%` : ''}</span>
        ) : (
          <button
            type="button"
            disabled={office?.targetVersion == null}
            onClick={() => void capabilities.install('office-viewer').catch(() => undefined)}
          >
            安装 Office 预览资源
          </button>
        )}
      </div>
    )
  }

  return (
    <FileViewer {...props} ref={viewerRef} onStateChange={handleStateChange} options={options} />
  )
}
