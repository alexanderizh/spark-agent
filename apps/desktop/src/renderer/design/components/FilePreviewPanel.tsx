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
import type { PreviewFileType } from './ClickableFilePath'
import { FileTypeIcon } from './FileDisplay'

const FlyfishFileViewer = lazy(() => import('@file-viewer/react'))

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

/** safe-file 协议前缀 */
const SAFE_FILE_SCHEME = 'safe-file'

/**
 * 把本地文件路径转成 safe-file:// URL（与 MarkdownImage 保持一致）
 */
function encodeToSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${SAFE_FILE_SCHEME}://x/${encoded}`
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

const FLYFISH_VIEWER_ASSET_BASE = '/file-viewer'
const FILE_PREVIEW_WIDTH_KEY = 'spark.filePreviewPanel.width'
const FILE_PREVIEW_DEFAULT_WIDTH = 760
const FILE_PREVIEW_MIN_WIDTH = 420
const FILE_PREVIEW_MAX_WIDTH = 1200
const FILE_PREVIEW_KEYBOARD_STEP = 32

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
  const viewportMax =
    typeof window === 'undefined'
      ? FILE_PREVIEW_MAX_WIDTH
      : Math.max(FILE_PREVIEW_MIN_WIDTH, window.innerWidth - 280)
  return Math.min(Math.max(width, FILE_PREVIEW_MIN_WIDTH), FILE_PREVIEW_MAX_WIDTH, viewportMax)
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
    return content.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${containmentStyle}</head>`)
  }

  return `<!doctype html><html><head>${containmentStyle}</head><body>${content}</body></html>`
}

const flyfishViewerOptions = {
  theme: 'system' as const,
  toolbar: { position: 'bottom-right' as const },
  archive: {
    workerUrl: `${FLYFISH_VIEWER_ASSET_BASE}/vendor/libarchive/worker-bundle.js`,
    wasmUrl: `${FLYFISH_VIEWER_ASSET_BASE}/vendor/libarchive/libarchive.wasm`,
  },
  cad: {
    wasmPath: `${FLYFISH_VIEWER_ASSET_BASE}/wasm/cad/`,
    workerUrl: `${FLYFISH_VIEWER_ASSET_BASE}/wasm/cad/dwg-worker.js`,
    dwfWasmUrl: `${FLYFISH_VIEWER_ASSET_BASE}/wasm/cad/dwfv-render.wasm`,
  },
  data: { sqlWasmUrl: `${FLYFISH_VIEWER_ASSET_BASE}/wasm/data/sql-wasm.wasm` },
  // @file-viewer/core 默认把 PDF worker 指向外部 CDN（npm.onmicrosoft.cn），
  // 叠加 index.html 的 CSP（script-src/connect-src 仅 'self'）会拦截该 CDN，导致 PDF 完全打不开。
  // 这里指向由 copy-file-viewer-assets.mjs 复制到本地的同源 worker，dev server 与打包后 file:// 都能加载。
  pdf: { workerUrl: `${FLYFISH_VIEWER_ASSET_BASE}/vendor/pdf/pdf.worker.mjs` },
  docx: { workerUrl: `${FLYFISH_VIEWER_ASSET_BASE}/vendor/docx/docx.worker.js` },
  spreadsheet: { workerUrl: `${FLYFISH_VIEWER_ASSET_BASE}/vendor/xlsx/sheet.worker.js` },
  typst: {
    compilerWasmUrl: `${FLYFISH_VIEWER_ASSET_BASE}/wasm/typst/typst_ts_web_compiler_bg.wasm`,
    rendererWasmUrl: `${FLYFISH_VIEWER_ASSET_BASE}/wasm/typst/typst_ts_renderer_bg.wasm`,
  },
}

export function FilePreviewPanel({
  filePath,
  fileType,
  workspaceRootPath,
  onClose,
}: Props): ReactNode {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingExternal, setOpeningExternal] = useState(false)
  const [panelWidth, setPanelWidth] = useState(readPreviewPanelWidth)
  const { invoke: readFile } = useIpcInvoke('file:read')
  const { toast } = useToast()
  const resolvedFilePath = resolvePreviewPath(filePath, workspaceRootPath)
  const htmlPreviewDocument =
    fileType === 'html' && content !== null ? buildHtmlPreviewDocument(content) : null

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
      <div className="file-preview-header">
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
        {loading && (
          <div className="file-preview-loading">
            <Icons.Spinner size={20} />
            <span>加载中...</span>
          </div>
        )}
        {error && (
          <div className="file-preview-error">
            <Icons.AlertTriangle size={20} />
            <span>{error}</span>
          </div>
        )}
        {!loading && !error && fileType === 'image' && (
          <div className="file-preview-image">
            <MarkdownImage src={resolvedFilePath} alt={fileName} />
          </div>
        )}
        {!loading && !error && fileType === 'universal' && (
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
                url={
                  isLocalPath(resolvedFilePath)
                    ? encodeToSafeFileUrl(resolvedFilePath)
                    : resolvedFilePath
                }
                filename={fileName}
                options={flyfishViewerOptions}
                onStateChange={(state) => {
                  if (state.error != null) {
                    setError(
                      formatViewerError(state.error) ??
                        'Flyfish Viewer 无法预览该文件，可尝试用外部应用打开',
                    )
                  }
                }}
              />
            </Suspense>
          </div>
        )}
        {!loading && !error && fileType === 'html' && content !== null && (
          <iframe
            className="file-preview-html"
            srcDoc={htmlPreviewDocument ?? ''}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            title={`${fileName} 预览`}
          />
        )}
        {!loading && !error && fileType === 'markdown' && content !== null && (
          <div className="file-preview-markdown">
            <MarkdownText content={content} />
          </div>
        )}
        {!loading && !error && fileType === 'text' && content !== null && (
          <pre className="file-preview-text">{content}</pre>
        )}
      </div>
    </div>
  )
}
