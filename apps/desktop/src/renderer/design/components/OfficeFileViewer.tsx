import FileViewer from '@file-viewer/react'
import type { FileViewerHandle, FileViewerProps, ViewerViewState } from '@file-viewer/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { createOfficeViewerOptions } from './officeViewerOptions'

export default function OfficeFileViewer({
  options: _options,
  onStateChange,
  ...props
}: FileViewerProps): ReactNode {
  const resolvedTheme = useResolvedTheme()
  const [viewerTheme, setViewerTheme] = useState(resolvedTheme)
  const viewerRef = useRef<FileViewerHandle>(null)
  const pendingViewStateRef = useRef<ViewerViewState | null>(null)
  const options = useMemo(() => createOfficeViewerOptions(viewerTheme), [viewerTheme])

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

  return (
    <FileViewer {...props} ref={viewerRef} onStateChange={handleStateChange} options={options} />
  )
}
