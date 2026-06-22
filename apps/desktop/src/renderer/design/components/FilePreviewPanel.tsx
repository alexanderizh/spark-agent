/**
 * FilePreviewPanel — 右侧文件预览面板
 *
 * 支持预览：
 *   1. Markdown 文件（.md, .markdown, .mdx）
 *   2. HTML 文件（.html, .htm）
 *   3. 图片文件（.png, .jpg, .gif, .webp, .svg 等）
 *   4. 文本文件（.txt, .text）
 */

import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import './FilePreviewPanel.less'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import { MarkdownText } from '../views/ChatView'
import { MarkdownImage } from './MarkdownImage'
import type { PreviewFileType } from './ClickableFilePath'

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
  const { invoke: readFile } = useIpcInvoke('file:read')
  const { toast } = useToast()
  const panelRef = useRef<HTMLDivElement>(null)
  const resolvedFilePath = resolvePreviewPath(filePath, workspaceRootPath)

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

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // 延迟添加，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const { invoke: openFile } = useIpcInvoke('file:open')

  const handleOpenExternal = useCallback(async () => {
    try {
      const res = await openFile({ filePath: resolvedFilePath })
      if (!res.opened) {
        toast.error(res.error ?? '无法打开文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    }
  }, [openFile, resolvedFilePath, toast])

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath

  return (
    <div ref={panelRef} className="file-preview-panel">
      <div className="file-preview-header">
        <div className="file-preview-title">
          <span className="file-preview-icon">
            {fileType === 'markdown' && <Icons.File size={14} />}
            {fileType === 'html' && <Icons.Code size={14} />}
            {fileType === 'image' && <Icons.Image size={14} />}
            {fileType === 'text' && <Icons.File size={14} />}
            {fileType === 'universal' && <Icons.File size={14} />}
          </span>
          <span className="file-preview-name" title={filePath}>
            {fileName}
          </span>
        </div>
        <div className="file-preview-actions">
          <button className="file-preview-action" title="在外部打开" onClick={handleOpenExternal}>
            <Icons.ExternalLink size={14} />
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
                    setError('Flyfish Viewer 无法预览该文件，可尝试用外部应用打开')
                  }
                }}
              />
            </Suspense>
          </div>
        )}
        {!loading && !error && fileType === 'html' && content !== null && (
          <div className="file-preview-html" dangerouslySetInnerHTML={{ __html: content }} />
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
