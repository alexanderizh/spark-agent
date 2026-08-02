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
  const [installError, setInstallError] = useState<string | null>(null)
  const viewerRef = useRef<FileViewerHandle>(null)
  const pendingViewStateRef = useRef<ViewerViewState | null>(null)
  const manifestRefreshAttemptedRef = useRef(false)
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
  const { loading: capabilityLoading, refresh: refreshCapabilities, snapshot } = capabilities
  useEffect(() => {
    if (
      officeReady ||
      snapshot == null ||
      office?.targetVersion != null ||
      capabilityLoading ||
      manifestRefreshAttemptedRef.current
    ) {
      return
    }
    manifestRefreshAttemptedRef.current = true
    void refreshCapabilities(true).catch(() => undefined)
  }, [capabilityLoading, refreshCapabilities, snapshot, office?.targetVersion, officeReady])

  const installOfficeViewer = async () => {
    setInstallError(null)
    try {
      await capabilities.install('office-viewer')
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Office 预览资源安装失败，请重试')
    }
  }
  if (!officeReady) {
    const progress = capabilities.progress['office-viewer']
    const installing =
      progress != null &&
      ['queued', 'downloading', 'verifying', 'extracting', 'activating'].includes(progress.phase)
    return (
      <div className="office-viewer-capability-placeholder" role="status">
        <strong>需要安装离线 Office 预览资源</strong>
        <span>
          {capabilities.loading
            ? '正在检查当前平台可用的 Office 预览资源…'
            : office?.targetVersion
              ? `需下载约 ${(office.downloadSize / 1024 / 1024).toFixed(1)} MB，安装后会自动重试预览。`
              : '当前平台暂时没有可用的 Office 预览资源。'}
        </span>
        {office?.error && <span className="integrity-sdk-error">{office.error}</span>}
        {installError && !office?.error && (
          <span className="integrity-sdk-error">{installError}</span>
        )}
        {installing ? (
          <span>
            {progress.message}
            {progress.percent != null ? ` · ${progress.percent}%` : ''}
          </span>
        ) : (
          <button
            type="button"
            disabled={capabilities.loading || office?.targetVersion == null}
            onClick={() => void installOfficeViewer()}
          >
            {capabilities.loading ? '正在检查资源…' : '安装 Office 预览资源'}
          </button>
        )}
      </div>
    )
  }

  return (
    <FileViewer {...props} ref={viewerRef} onStateChange={handleStateChange} options={options} />
  )
}
