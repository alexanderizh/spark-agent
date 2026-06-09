/**
 * FilePreviewPanel — 右侧文件预览面板
 *
 * 支持预览：
 *   1. Markdown 文件（.md, .markdown, .mdx）
 *   2. HTML 文件（.html, .htm）
 *   3. 图片文件（.png, .jpg, .gif, .webp, .svg 等）
 *   4. 文本文件（.txt, .text）
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import './FilePreviewPanel.less'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import { MarkdownText } from '../views/ChatView'
import { MarkdownImage } from './MarkdownImage'

type FileType = 'markdown' | 'html' | 'image' | 'text'

type Props = {
  /** 文件路径 */
  filePath: string
  /** 文件类型 */
  fileType: FileType
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

export function FilePreviewPanel({ filePath, fileType, onClose }: Props): ReactNode {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { invoke: readFile } = useIpcInvoke('file:read')
  const { toast } = useToast()
  const panelRef = useRef<HTMLDivElement>(null)

  // 读取文件内容
  useEffect(() => {
    if (fileType === 'image') {
      // 图片不需要读取内容，直接用路径
      return
    }

    let cancelled = false
    const loadFile = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await readFile({ filePath })
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
    return () => { cancelled = true }
  }, [filePath, fileType, readFile])

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
      const res = await openFile({ filePath })
      if (!res.opened) {
        toast.error(res.error ?? '无法打开文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    }
  }, [filePath, openFile, toast])

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
          </span>
          <span className="file-preview-name" title={filePath}>{fileName}</span>
        </div>
        <div className="file-preview-actions">
          <button
            className="file-preview-action"
            title="在外部打开"
            onClick={handleOpenExternal}
          >
            <Icons.ExternalLink size={14} />
          </button>
          <button
            className="file-preview-action"
            title="关闭"
            onClick={onClose}
          >
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
            <MarkdownImage src={filePath} alt={fileName} />
          </div>
        )}
        {!loading && !error && fileType === 'html' && content !== null && (
          <div
            className="file-preview-html"
            dangerouslySetInnerHTML={{ __html: content }}
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
