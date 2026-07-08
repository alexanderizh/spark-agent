/**
 * ImagePreviewModal — 全屏图片预览（lightbox）
 *
 * 行为：
 *   - 黑色半透明背景，居中显示原图，按比例缩放
 *   - 点击背景或按 Esc / 右上角关闭按钮 → 关闭
 *   - 顶栏显示文件名 + 复制 / 下载 + 关闭按钮
 *
 * 设计要点：
 *   - 不复用现有 .modal-backdrop，因为那个只用于权限弹窗，且 z-index 较窄；
 *     本组件用 image-lightbox-backdrop 单独一套，z-index 更高，避免被其它覆盖层挡住
 *   - 移动端 / 缩小窗口：图片保持长宽比自适应
 */

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../Icons'
import { useToast } from './Toast'

type Props = {
  src: string
  alt: string
  fileName: string
  onClose: () => void
}

const SAFE_FILE_SCHEME = 'safe-file'
const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

export function ImagePreviewModal({ src, alt, fileName, onClose }: Props) {
  const { toast } = useToast()
  const [imgError, setImgError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /** 复制图片到剪贴板。优先用 fetch 取 blob，再走 Clipboard API */
  const handleCopy = useCallback(async () => {
    if (imgError) {
      toast.warning('图片加载失败，无法复制')
      return
    }
    try {
      let blob: Blob | null = null
      // safe-file 协议已声明 supportFetchAPI，渲染进程可以用 fetch 取
      if (src.startsWith(`${SAFE_FILE_SCHEME}:`) || src.startsWith('http')) {
        const resp = await fetch(src)
        if (resp.ok) blob = await resp.blob()
      }
      if (!blob) {
        toast.error('复制失败：无法读取图片数据')
        return
      }
      // Electron / Chromium 都支持 ClipboardItem + image/png
      const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem })
        .ClipboardItem
      if (typeof ClipboardItemCtor === 'function') {
        await navigator.clipboard.write([
          new ClipboardItemCtor({ [blob.type || 'image/png']: blob }),
        ])
        setCopied(true)
        toast.success('已复制到剪贴板')
        setTimeout(() => setCopied(false), 1500)
      } else {
        toast.error('当前环境不支持复制图片，请用下载')
      }
    } catch (err) {
      toast.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [src, imgError, toast])

  const handleDownload = useCallback(async () => {
    if (imgError) {
      toast.warning('图片加载失败，无法下载')
      return
    }
    setDownloading(true)
    try {
      if (src.startsWith(`${SAFE_FILE_SCHEME}:`)) {
        const sourcePath = decodeSafeFilePath(src)
        if (!sourcePath) {
          toast.error('下载失败：无法解析图片路径')
          return
        }
        if (!window.spark?.invoke) {
          toast.error('下载失败：桌面能力尚未就绪')
          return
        }
        const res = await window.spark.invoke('file:save-image', {
          sourcePath,
          suggestedFileName: fileName,
        })
        if (res.saved) {
          toast.success(`已保存到 ${res.savedPath}`)
        }
      } else {
        const a = document.createElement('a')
        a.href = src
        a.download = fileName
        a.target = '_blank'
        a.rel = 'noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      toast.error(`下载失败：${e.message}`)
    } finally {
      setDownloading(false)
    }
  }, [src, imgError, fileName, toast])

  return createPortal(
    (
    <div
      className="image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`预览图片 ${fileName}`}
      onClick={onClose}
    >
      {/* 顶部工具栏 */}
      <div
        className={`image-lightbox-topbar ${isPlatformDarwin ? 'platform-darwin-safe-area' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="image-lightbox-title" title={fileName}>
          {fileName}
        </span>
        <button
          type="button"
          className="image-lightbox-btn"
          onClick={handleCopy}
          disabled={imgError}
          title="复制图片"
        >
          {copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
        <button
          type="button"
          className="image-lightbox-btn"
          onClick={handleDownload}
          disabled={downloading || imgError}
          title="下载到本地"
        >
          <Icons.Download size={16} />
          <span>下载</span>
        </button>
        <button
          type="button"
          className="image-lightbox-btn image-lightbox-close"
          onClick={onClose}
          title="关闭 (Esc)"
        >
          <Icons.X size={18} />
        </button>
      </div>

      {/* 图片 */}
      <div className="image-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {imgError ? (
          <div className="image-lightbox-error">
            <Icons.Image size={48} />
            <div>图片加载失败</div>
            <div className="image-lightbox-error-path">{fileName}</div>
          </div>
        ) : (
          <img
            src={src}
            alt={alt}
            className="image-lightbox-img"
            onError={() => setImgError(true)}
            draggable={false}
          />
        )}
      </div>
    </div>
    ),
    document.body,
  )
}

function decodeSafeFilePath(safeFileUrl: string): string | null {
  try {
    const prefix = `${SAFE_FILE_SCHEME}://`
    if (!safeFileUrl.startsWith(prefix)) return null
    const rest = safeFileUrl.slice(prefix.length)
    const slashIdx = rest.indexOf('/')
    if (slashIdx < 0) return null
    const encoded = rest.slice(slashIdx + 1)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    return decodeURIComponent(escape(atob(base64 + padding)))
  } catch {
    return null
  }
}
