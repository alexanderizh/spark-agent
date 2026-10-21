import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createLogger } from '@spark/shared'
import { Tooltip } from '@lobehub/ui'
import { Check, Copy, Download, Minus, Plus, UnfoldHorizontal, X } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { SessionShareSheet } from './SessionShareSheet'
import {
  captureSessionShareSheet,
  waitForShareSheet,
  type SessionShareImage,
} from './sessionShareCapture'
import {
  buildSessionShareFileName,
  maxShareSheetCssHeight,
  nextOmittedMessageCount,
  readLiveShareSheetMetrics,
} from './sessionShareModel'
import './SessionShareDialog.css'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5
const STAGE_GUTTER = 32
const logger = createLogger('session-share')

type Phase = 'prepare' | 'capture' | 'ready' | 'error'

export function SessionShareDialog({
  title,
  workspaceName,
  onCaptureHost,
  onOmitCount,
  onClose,
}: {
  title: string
  workspaceName?: string | null | undefined
  onCaptureHost: (host: HTMLElement | null) => void
  onOmitCount: (count: number) => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const sheetRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const generatedAt = useMemo(() => new Date(), [])
  const [sheetMetrics] = useState(readLiveShareSheetMetrics)
  const fileName = useMemo(
    () => buildSessionShareFileName(title, generatedAt),
    [generatedAt, title],
  )
  const [omitted, setOmitted] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [phase, setPhase] = useState<Phase>('prepare')
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState<SessionShareImage | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')
  const [copied, setCopied] = useState(false)

  const applyFitZoom = useCallback(() => {
    const stage = stageRef.current
    const naturalWidth = image?.width ?? 0
    if (stage == null || naturalWidth <= 0) return
    const available = Math.max(160, stage.clientWidth - STAGE_GUTTER)
    setZoom(Math.min(1, available / naturalWidth))
    setZoomMode('fit')
  }, [image?.width])

  const nudgeZoom = useCallback((direction: 1 | -1) => {
    setZoomMode('manual')
    setZoom((current) => clampZoom(current * (direction > 0 ? 1.2 : 1 / 1.2)))
  }, [])

  const toggleZoom = useCallback(() => {
    if (zoomMode === 'fit') {
      setZoom(1)
      setZoomMode('manual')
      return
    }
    applyFitZoom()
  }, [applyFitZoom, zoomMode])

  useLayoutEffect(() => {
    if (phase === 'ready' && zoomMode === 'fit') applyFitZoom()
  }, [applyFitZoom, phase, zoomMode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (phase !== 'ready') return
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        nudgeZoom(1)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        nudgeZoom(-1)
      } else if (event.key === '0') {
        event.preventDefault()
        applyFitZoom()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyFitZoom, nudgeZoom, onClose, phase])

  useEffect(() => {
    const stage = stageRef.current
    if (phase !== 'ready' || stage == null) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      nudgeZoom(event.deltaY < 0 ? 1 : -1)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [nudgeZoom, phase])

  useEffect(() => {
    if (phase !== 'prepare') return
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      const sheet = sheetRef.current
      if (cancelled || sheet == null) return
      const live = await waitForLiveShare(sheet)
      if (cancelled || sheetRef.current == null) return
      if (live == null) {
        setErrorMessage('没有读到会话内容')
        setPhase('error')
        return
      }
      const total = Number(live.getAttribute('data-share-count') ?? '0')
      setTotalCount(Number.isFinite(total) ? total : 0)
      if (total <= 0) {
        setErrorMessage('当前会话没有可以分享的内容')
        setPhase('error')
        return
      }
      try {
        await waitForShareSheet(sheet)
      } catch {
        // 排版等待失败时仍按当前布局继续量尺寸。
      }
      if (cancelled || sheetRef.current == null) return
      const height = sheetRef.current.scrollHeight
      const maxHeight = maxShareSheetCssHeight()
      if (height > maxHeight && omitted < total - 1) {
        const next = nextOmittedMessageCount(total, omitted, height, maxHeight)
        if (next > omitted) {
          setOmitted(next)
          onOmitCount(next)
          return
        }
      }
      if (!cancelled) setPhase('capture')
    })()
    return () => {
      cancelled = true
    }
  }, [attempt, omitted, onOmitCount, phase])

  useEffect(() => {
    if (phase !== 'capture') return
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      const sheet = sheetRef.current
      if (cancelled || sheet == null) return
      try {
        const captured = await captureSessionShareSheet(sheet)
        if (cancelled) return
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        const url = URL.createObjectURL(captured.blob)
        previewUrlRef.current = url
        setImage(captured)
        setPreviewUrl(url)
        setZoomMode('fit')
        setPhase('ready')
      } catch (error) {
        if (cancelled) return
        logger.error('event=capture_failed', error)
        setErrorMessage(error instanceof Error ? error.message : '生成长图失败')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attempt, phase])

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    if (image == null) return
    try {
      const ClipboardItemCtor = window.ClipboardItem
      if (typeof ClipboardItemCtor !== 'function' || navigator.clipboard?.write == null) {
        throw new Error('当前环境不支持复制图片，请用下载')
      }
      const png = image.blob.type === 'image/png' ? image.blob : await transcodePng(image.blob)
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': png })])
      setCopied(true)
      toast.success('长图已复制')
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  const handleDownload = () => {
    if (previewUrl == null) return
    const link = document.createElement('a')
    link.href = previewUrl
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const retry = () => {
    setOmitted(0)
    onOmitCount(0)
    setErrorMessage('')
    setPhase('prepare')
    setAttempt((current) => current + 1)
  }

  const showSheet = phase === 'prepare' || phase === 'capture'
  const zoomLabel = `${Math.round(zoom * 100)}%`
  const previewSize = previewPixelSize(image, zoom)

  return createPortal(
    <>
      {showSheet && (
        <div
          className="session-share-capture-host"
          style={{ width: sheetMetrics.width }}
          aria-hidden="true"
        >
          <SessionShareSheet
            ref={sheetRef}
            title={title}
            workspaceName={workspaceName}
            omittedCount={omitted}
            totalCount={totalCount}
            generatedAt={generatedAt}
            width={sheetMetrics.width}
            paddingLeft={sheetMetrics.paddingLeft}
            paddingRight={sheetMetrics.paddingRight}
            onLiveHost={onCaptureHost}
          />
        </div>
      )}
      <div
        className="session-share-modal"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          className={`session-share-panel ${phase === 'ready' ? 'is-preview' : 'is-status'}`}
          role="dialog"
          aria-modal="true"
          aria-busy={phase === 'prepare' || phase === 'capture'}
          aria-label={phase === 'ready' ? '会话长图预览' : '正在生成会话长图'}
        >
          {phase === 'ready' && previewUrl ? (
            <>
              <div className="session-share-toolbar">
                <div className="session-share-toolbar-title">
                  <strong>会话长图</strong>
                  <span>
                    {image ? `${image.width} × ${image.height} · ${formatScale(image.scale)}` : ''}
                  </span>
                </div>
                <div className="session-share-toolbar-spacer" />
                <div className="session-share-zoom">
                  <ShareIconButton title="缩小" onClick={() => nudgeZoom(-1)}>
                    <Minus size={14} strokeWidth={1.6} />
                  </ShareIconButton>
                  <span className="session-share-zoom-label">{zoomLabel}</span>
                  <ShareIconButton title="放大" onClick={() => nudgeZoom(1)}>
                    <Plus size={14} strokeWidth={1.6} />
                  </ShareIconButton>
                  <ShareIconButton title="适应宽度" onClick={applyFitZoom}>
                    <UnfoldHorizontal size={14} strokeWidth={1.6} />
                  </ShareIconButton>
                </div>
                <div className="session-share-actions">
                  <ShareIconButton
                    title={copied ? '已复制' : '复制'}
                    onClick={() => void handleCopy()}
                  >
                    {copied ? (
                      <Check size={14} strokeWidth={1.6} />
                    ) : (
                      <Copy size={14} strokeWidth={1.6} />
                    )}
                  </ShareIconButton>
                  <button type="button" className="is-primary" onClick={handleDownload}>
                    <Download size={14} />
                    下载
                  </button>
                </div>
                <ShareIconButton title="关闭" onClick={onClose}>
                  <X size={14} strokeWidth={1.6} />
                </ShareIconButton>
              </div>
              <div className="session-share-stage" ref={stageRef}>
                <div className="session-share-stage-inner">
                  <img
                    src={previewUrl}
                    alt="会话长图预览"
                    width={previewSize.width}
                    height={previewSize.height}
                    draggable={false}
                    style={{ width: previewSize.width, height: previewSize.height }}
                    className={zoomMode === 'manual' && zoom >= 0.98 ? 'is-actual' : undefined}
                    onLoad={() => {
                      if (zoomMode === 'fit') applyFitZoom()
                    }}
                    onClick={toggleZoom}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="session-share-status">
              <button
                type="button"
                className="session-share-status-close"
                aria-label="关闭"
                onClick={onClose}
              >
                <X size={14} />
              </button>
              {phase === 'error' ? (
                <>
                  <strong>没能生成长图</strong>
                  <p>{errorMessage || '请稍后重试'}</p>
                  {errorMessage !== '当前会话没有可以分享的内容' && (
                    <button type="button" className="is-primary" onClick={retry}>
                      重新生成
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="session-share-progress" aria-hidden="true">
                    <span />
                  </div>
                  <strong>正在生成长图</strong>
                  <p>按当前会话样式导出</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

async function waitForLiveShare(sheet: HTMLElement): Promise<HTMLElement | null> {
  const started = Date.now()
  while (Date.now() - started < 4000) {
    const live = sheet.querySelector<HTMLElement>('[data-share-live-ready]')
    if (live) return live
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
  return null
}

function ShareIconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip
      title={title}
      placement="bottom"
      mouseEnterDelay={0}
      arrow
      zIndex={10080}
      className="spark-icon-tooltip"
    >
      <button type="button" className="icon-btn" aria-label={title} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  )
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function previewPixelSize(
  image: SessionShareImage | null,
  zoom: number,
): { width: number; height: number } {
  const naturalWidth = image?.width ?? 1
  const naturalHeight = image?.height ?? 1
  const width = Math.max(1, Math.round(naturalWidth * zoom))
  const height = Math.max(1, Math.round((width * naturalHeight) / naturalWidth))
  return { width, height }
}

function formatScale(scale: number): string {
  const rounded = Math.round(scale * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}×`
}

async function transcodePng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (context == null) throw new Error('无法复制图片')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const png = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (png == null) throw new Error('无法复制图片')
  return png
}
