/**
 * FilePreviewPanel — 右侧文件预览面板
 *
 * 支持预览：
 *   1. Markdown 文件（.md, .markdown, .mdx）
 *   2. HTML 文件（.html, .htm）
 *   3. 图片文件（.png, .jpg, .gif, .webp, .svg 等）
 *   4. 文本文件（.txt, .text）
 */

import { lazy, Suspense, useEffect, useState, useCallback } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import './FilePreviewPanel.less'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import { MarkdownText } from '../views/ChatView'
import { MarkdownImage } from './MarkdownImage'
import type { FileViewerProps } from '@file-viewer/react'
import type { PreviewFileType } from './ClickableFilePath'
import { FileTypeIcon } from './FileDisplay'
import {
  isRemotePreviewUrl,
  resolveViewerLoadSource,
  type ViewerLoadSource,
} from './filePreviewSource'

const FlyfishFileViewer = lazy(() => import('./OfficeFileViewer'))

type FileType = PreviewFileType

type Props = {
  /** 文件路径 */
  filePath: string
  /** 文件类型 */
  fileType: FileType
  /** 当前会话工作区根目录；用于解析相对路径 */
  workspaceRootPath?: string
  /** 关闭面板回调 */
  onClose: () => void
}

type ViewerLoadState = {
  filePath: string
  source?: ViewerLoadSource
  error?: string
}

/**
 * 从 Flyfish Viewer 的 onStateChange 错误对象里提取可读文本。
 *
 * @file-viewer/core 的 pptx/xlsx/docx 等 renderer 在解析失败时会把真实原因（worker 创建失败、
 * 解析异常等）放进 state.error。直接透出给用户，便于定位「预览失败」的真因。
 */
function formatViewerError(error: unknown): string | null {
  if (error == null) return null
  if (error instanceof Error) return error.message || null
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * 判断是否为本地绝对路径
 */
function isLocalPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function isRemoteUrl(path: string): boolean {
  return /^https?:\/\//i.test(path) || path.startsWith('safe-file://')
}

function resolvePreviewPath(filePath: string, workspaceRootPath?: string): string {
  if (isRemoteUrl(filePath) || isLocalPath(filePath) || workspaceRootPath == null) return filePath
  const normalized = filePath.replace(/^\.\//, '').replace(/^[\\/]+/, '')
  const separator = workspaceRootPath.includes('\\') ? '\\' : '/'
  return `${workspaceRootPath.replace(/[\\/]+$/, '')}${separator}${normalized}`
}

const FILE_PREVIEW_WIDTH_KEY = 'spark.filePreviewPanel.width'
const FILE_PREVIEW_DEFAULT_WIDTH = 760
const FILE_PREVIEW_MIN_WIDTH = 420
const FILE_PREVIEW_MAX_WIDTH = 1200
const FILE_PREVIEW_KEYBOARD_STEP = 32
const FILE_PREVIEW_COMPACT_BREAKPOINT = 900
const FILE_PREVIEW_CHAT_RESERVE = 566
const FILE_PREVIEW_VIEWPORT_GUTTER = 24

const HTML_PREVIEW_CONTAINMENT_STYLE = `
html {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

*, *::before, *::after {
  box-sizing: inherit;
}

body {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

img, video, canvas, svg, iframe, table {
  max-width: 100%;
}
`

function clampPanelWidth(width: number): number {
  if (typeof window === 'undefined') {
    return Math.min(Math.max(width, FILE_PREVIEW_MIN_WIDTH), FILE_PREVIEW_MAX_WIDTH)
  }

  const viewportReserve =
    window.innerWidth <= FILE_PREVIEW_COMPACT_BREAKPOINT
      ? FILE_PREVIEW_VIEWPORT_GUTTER
      : FILE_PREVIEW_CHAT_RESERVE
  const viewportMax = Math.max(0, window.innerWidth - viewportReserve)
  const responsiveMin = Math.min(FILE_PREVIEW_MIN_WIDTH, viewportMax)
  return Math.min(Math.max(width, responsiveMin), FILE_PREVIEW_MAX_WIDTH, viewportMax)
}

function readPreviewPanelWidth(): number {
  if (typeof window === 'undefined') return FILE_PREVIEW_DEFAULT_WIDTH
  const stored = window.localStorage.getItem(FILE_PREVIEW_WIDTH_KEY)
  const parsed = stored == null ? Number.NaN : Number(stored)
  return Number.isFinite(parsed)
    ? clampPanelWidth(parsed)
    : clampPanelWidth(FILE_PREVIEW_DEFAULT_WIDTH)
}

function buildHtmlPreviewDocument(content: string): string {
  const containmentStyle = `<style data-spark-preview-containment>${HTML_PREVIEW_CONTAINMENT_STYLE}</style>`

  if (/<head[\s>]/i.test(content)) {
    return content.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${containmentStyle}`)
  }

  if (/<html[\s>]/i.test(content)) {
    return content.replace(
      /<html(\s[^>]*)?>/i,
      (match) => `${match}<head>${containmentStyle}</head>`,
    )
  }

  return `<!doctype html><html><head>${containmentStyle}</head><body>${content}</body></html>`
}

export function FilePreviewPanel({
  filePath,
  fileType,
  workspaceRootPath,
  onClose,
}: Props): ReactNode {
  const [content, setContent] = useState<string | null>(null)
  const [viewerLoadState, setViewerLoadState] = useState<ViewerLoadState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingExternal, setOpeningExternal] = useState(false)
  const [panelWidth, setPanelWidth] = useState(readPreviewPanelWidth)
  const { invoke: readFile } = useIpcInvoke('file:read')
  const { invoke: readBinaryFile } = useIpcInvoke('file:read-binary')
  const { toast } = useToast()
  const resolvedFilePath = resolvePreviewPath(filePath, workspaceRootPath)
  const htmlPreviewDocument =
    fileType === 'html' && content !== null ? buildHtmlPreviewDocument(content) : null
  const activeViewerLoadState =
    viewerLoadState?.filePath === resolvedFilePath ? viewerLoadState : null
  const viewerSource =
    fileType === 'universal' && isRemotePreviewUrl(resolvedFilePath)
      ? ({ kind: 'remote', url: resolvedFilePath } satisfies ViewerLoadSource)
      : (activeViewerLoadState?.source ?? null)
  const previewError = fileType === 'universal' ? (activeViewerLoadState?.error ?? null) : error
  const previewLoading =
    fileType === 'universal' ? viewerSource === null && previewError === null : loading

  // 读取文件内容
  useEffect(() => {
    if (fileType === 'image' || fileType === 'universal') {
      // 图片与 Flyfish Viewer 通用预览不需要读取文本内容，直接用 URL/路径渲染。
      return
    }

    let cancelled = false
    const loadFile = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await readFile({ filePath: resolvedFilePath })
        if (!cancelled) {
          if (result.error) {
            setError(result.error)
          } else {
            setContent(result.content ?? '')
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '读取文件失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadFile()
    return () => {
      cancelled = true
    }
  }, [fileType, readFile, resolvedFilePath])

  useEffect(() => {
    if (fileType !== 'universal' || isRemotePreviewUrl(resolvedFilePath)) return

    let cancelled = false

    const loadViewerSource = async () => {
      try {
        const source = await resolveViewerLoadSource(resolvedFilePath, readBinaryFile)
        if (!cancelled) setViewerLoadState({ filePath: resolvedFilePath, source })
      } catch (err) {
        if (!cancelled) {
          setViewerLoadState({
            filePath: resolvedFilePath,
            error: err instanceof Error ? err.message : '读取预览文件失败',
          })
        }
      }
    }

    void loadViewerSource()
    return () => {
      cancelled = true
    }
  }, [fileType, readBinaryFile, resolvedFilePath])

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const { invoke: openFile } = useIpcInvoke('file:open')

  useEffect(() => {
    try {
      window.localStorage.setItem(FILE_PREVIEW_WIDTH_KEY, String(panelWidth))
    } catch {
      // Keep the resized width for this render even when storage is unavailable.
    }
  }, [panelWidth])

  useEffect(
    () => () => {
      document.body.classList.remove('file-preview-resizing')
    },
    [],
  )

  const updatePanelWidth = useCallback((width: number) => {
    setPanelWidth(Math.round(clampPanelWidth(width)))
  }, [])

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = panelWidth
      const body = document.body
      body.classList.add('file-preview-resizing')

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updatePanelWidth(startWidth + startX - moveEvent.clientX)
      }

      const handlePointerUp = () => {
        body.classList.remove('file-preview-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [panelWidth, updatePanelWidth],
  )

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        updatePanelWidth(panelWidth + FILE_PREVIEW_KEYBOARD_STEP)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        updatePanelWidth(panelWidth - FILE_PREVIEW_KEYBOARD_STEP)
      } else if (event.key === 'Home') {
        event.preventDefault()
        updatePanelWidth(FILE_PREVIEW_MIN_WIDTH)
      } else if (event.key === 'End') {
        event.preventDefault()
        updatePanelWidth(FILE_PREVIEW_MAX_WIDTH)
      }
    },
    [panelWidth, updatePanelWidth],
  )

  const handleOpenExternal = useCallback(async () => {
    if (openingExternal) return
    setOpeningExternal(true)
    try {
      const res = await openFile({ filePath: resolvedFilePath })
      if (!res.opened) {
        toast.error(res.error ?? '无法打开文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    } finally {
      setOpeningExternal(false)
    }
  }, [openFile, openingExternal, resolvedFilePath, toast])

  // Flyfish/FileViewer 的 viewerOptions useMemo 依赖了 onStateChange 引用：只要引用变化，
  // 内部就会触发 controller.update() → loadSource() 重新解析整个文档。
  // 父级 ChatView 在会话流式输出/定时器/IPC 期间会高频重渲染，若这里用内联回调，每次都会
  // 产生新引用，导致 PPT 每隔几秒闪屏重新解析；PDF 还会因 ArrayBuffer 首次解析被 pdfjs
  // transfer 给 worker 后 detach，第二次 loadSource 拿到空 buffer 报「PDF 缺少可读取的数据源」。
  // 因此必须把 onStateChange 稳定下来：依赖里只放值稳定的 resolvedFilePath，
  // 并用 functional setState 读取最新 source，避免把 viewerSource 闭包进依赖。
  const handleViewerStateChange = useCallback<NonNullable<FileViewerProps['onStateChange']>>(
    (state) => {
      if (state.error == null) return
      setViewerLoadState((prev) => {
        if (prev == null || prev.filePath !== resolvedFilePath) return prev
        return {
          ...prev,
          error:
            formatViewerError(state.error) ??
            'Flyfish Viewer 无法预览该文件，可尝试用外部应用打开',
        }
      })
    },
    [resolvedFilePath],
  )

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath

  return (
    <div
      className="file-preview-panel"
      style={{ '--file-preview-width': `${panelWidth}px` } as CSSProperties}
    >
      <div
        aria-label="调整预览面板宽度"
        aria-orientation="vertical"
        aria-valuemax={FILE_PREVIEW_MAX_WIDTH}
        aria-valuemin={FILE_PREVIEW_MIN_WIDTH}
        aria-valuenow={panelWidth}
        className="file-preview-resize-handle"
        onDoubleClick={() => updatePanelWidth(FILE_PREVIEW_DEFAULT_WIDTH)}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizeStart}
        role="separator"
        tabIndex={0}
        title="拖拽调整预览宽度"
      />
      <div
        className="file-preview-header"
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest('.file-preview-actions')) {
            return
          }
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        <div className="file-preview-title">
          <span className="file-preview-icon">
            <FileTypeIcon filePath={filePath} size={18} />
          </span>
          <span className="file-preview-name" title={filePath}>
            {fileName}
          </span>
        </div>
        <div className="file-preview-actions">
          <button
            aria-label="使用默认应用打开"
            className="file-preview-action"
            disabled={openingExternal}
            title="使用默认应用打开"
            onClick={handleOpenExternal}
          >
            {openingExternal ? <Icons.Spinner size={14} /> : <Icons.ExternalLink size={14} />}
          </button>
          <button className="file-preview-action" title="关闭" onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
      </div>
      <div className="file-preview-content">
        {previewLoading && (
          <div className="file-preview-loading">
            <Icons.Spinner size={20} />
            <span>加载中...</span>
          </div>
        )}
        {previewError && (
          <div className="file-preview-error">
            <Icons.AlertTriangle size={20} />
            <span>{previewError}</span>
          </div>
        )}
        {!previewLoading && !previewError && fileType === 'image' && (
          <div className="file-preview-image">
            <MarkdownImage src={resolvedFilePath} alt={fileName} />
          </div>
        )}
        {!previewLoading && !previewError && fileType === 'universal' && viewerSource !== null && (
          <div className="file-preview-flyfish">
            <Suspense
              fallback={
                <div className="file-preview-loading">
                  <Icons.Spinner size={20} />
                  <span>加载 Flyfish Viewer...</span>
                </div>
              }
            >
              <FlyfishFileViewer
                key={filePath}
                {...(viewerSource.kind === 'remote'
                  ? { url: viewerSource.url }
                  : { buffer: viewerSource.buffer })}
                filename={fileName}
                onStateChange={handleViewerStateChange}
              />
            </Suspense>
          </div>
        )}
        {!previewLoading && !previewError && fileType === 'html' && content !== null && (
          <iframe
            className="file-preview-html"
            srcDoc={htmlPreviewDocument ?? ''}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            title={`${fileName} 预览`}
          />
        )}
        {!previewLoading && !previewError && fileType === 'markdown' && content !== null && (
          <div className="file-preview-markdown">
            <MarkdownText content={content} />
          </div>
        )}
        {!previewLoading && !previewError && fileType === 'text' && content !== null && (
          <pre className="file-preview-text">{content}</pre>
        )}
      </div>
    </div>
  )
}
