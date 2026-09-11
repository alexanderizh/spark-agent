/**
 * ImagePreviewModal — 全屏图片预览（lightbox）
 *
 * 行为：
 *   - 黑色半透明背景，居中显示原图，按比例缩放
 *   - 点击背景或按 Esc / 右上角关闭按钮 → 关闭
 *   - 顶栏显示文件名 + 复制 / 下载 + 关闭按钮
 *   - 传入 navigation（多图列表 + 起始序号）时支持左右切换：
 *     两侧悬浮箭头按钮、键盘 ←/→（循环）、顶栏序号指示；单图调用方不受影响
 *
 * 设计要点：
 *   - 不复用现有 .modal-backdrop，因为那个只用于权限弹窗，且 z-index 较窄；
 *     本组件用 image-lightbox-backdrop 单独一套，z-index 更高，避免被其它覆盖层挡住
 *   - 移动端 / 缩小窗口：图片保持长宽比自适应
 */

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../Icons'
import { useToast } from './Toast'
import './ImagePreviewModal.less'

/** 多图导航时的单张图片描述；src 需已解析为浏览器可加载的 URL（如 safe-file://） */
export interface LightboxImage {
  src: string
  alt: string
  fileName: string
}

type Props = {
  src: string
  alt: string
  fileName: string
  onClose: () => void
  /** 多图导航：提供且列表多于 1 张时启用左右切换（循环），否则行为与单图完全一致 */
  navigation?: { images: LightboxImage[]; startIndex: number } | undefined
}

const SAFE_FILE_SCHEME = 'safe-file'
const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

export function ImagePreviewModal({ src, alt, fileName, onClose, navigation }: Props) {
  const { toast } = useToast()
  const [imgError, setImgError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState(false)

  // 多图导航：当前序号。组件按需挂载（调用方 previewOpen 条件渲染），挂载时以 startIndex 初始化即可
  const [navIndex, setNavIndex] = useState(navigation?.startIndex ?? 0)
  const canNavigate = !!navigation && navigation.images.length > 1

  /** 当前生效的图片：多图时取导航列表，单图回落到 props */
  const current = useMemo<LightboxImage>(() => {
    if (navigation && navigation.images.length > 0) {
      const clamped = Math.min(Math.max(navIndex, 0), navigation.images.length - 1)
      return navigation.images[clamped] ?? { src, alt, fileName }
    }
    return { src, alt, fileName }
  }, [navigation, navIndex, src, alt, fileName])

  const imageCount = navigation?.images.length ?? 0
  const displayIndex = canNavigate ? navIndex + 1 : 0

  // 切图同时重置加载失败状态（上一张的失败不代表下一张也失败）；navIndex 只经这两个入口变化
  const goPrev = useCallback(() => {
    setNavIndex((i) => (i - 1 + (imageCount || 1)) % (imageCount || 1))
    setImgError(false)
  }, [imageCount])
  const goNext = useCallback(() => {
    setNavIndex((i) => (i + 1) % (imageCount || 1))
    setImgError(false)
  }, [imageCount])

  // Esc 关闭；多图时 ←/→ 循环切换（capture 阶段，避免被滚动等默认行为吞掉）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (!canNavigate) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, canNavigate, goPrev, goNext])

  /** 复制图片到剪贴板。优先用 fetch 取 blob，再走 Clipboard API */
  const handleCopy = useCallback(async () => {
    if (imgError) {
      toast.warning('图片加载失败，无法复制')
      return
    }
    try {
      let blob: Blob | null = null
      // safe-file 协议已声明 supportFetchAPI，渲染进程可以用 fetch 取
      if (current.src.startsWith(`${SAFE_FILE_SCHEME}:`) || current.src.startsWith('http')) {
        const resp = await fetch(current.src)
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
  }, [current.src, imgError, toast])

  const handleDownload = useCallback(async () => {
    if (imgError) {
      toast.warning('图片加载失败，无法下载')
      return
    }
    setDownloading(true)
    try {
      if (current.src.startsWith(`${SAFE_FILE_SCHEME}:`)) {
        const sourcePath = decodeSafeFilePath(current.src)
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
          suggestedFileName: current.fileName,
        })
        if (res.saved) {
          toast.success(`已保存到 ${res.savedPath}`)
        }
      } else {
        const a = document.createElement('a')
        a.href = current.src
        a.download = current.fileName
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
  }, [current.src, current.fileName, imgError, toast])

  /** 点击图片周围的空白遮罩（stage 本体，非图片/错误块）→ 关闭预览。
   *  用 target === currentTarget 判定来源：点图片本体或错误提示不会触发，
   *  只有落到 stage 自身（图片缩放后四周的深色区域）才关闭。 */
  const handleStageClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  return createPortal(
    <div
      className="image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`预览图片 ${current.fileName}`}
      onClick={onClose}
    >
      {/* 顶部工具栏 */}
      <div
        className={`image-lightbox-topbar ${isPlatformDarwin ? 'platform-darwin-safe-area' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="image-lightbox-title" title={current.fileName}>
          {current.fileName}
        </span>
        {canNavigate && (
          <span className="image-lightbox-counter">
            {displayIndex} / {imageCount}
          </span>
        )}
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

      {/* 图片。点击 stage 内图片周围的空白区域（遮罩）会关闭预览，
          见 handleStageClick；点图片/错误块本体不关闭。 */}
      <div className="image-lightbox-stage" onClick={handleStageClick}>
        {imgError ? (
          <div className="image-lightbox-error">
            <Icons.Image size={48} />
            <div>图片加载失败</div>
            <div className="image-lightbox-error-path">{current.fileName}</div>
          </div>
        ) : (
          <img
            src={current.src}
            alt={current.alt}
            className="image-lightbox-img"
            onError={() => setImgError(true)}
            draggable={false}
          />
        )}
      </div>

      {/* 左右切换按钮：仅多图时渲染；点按钮不触发遮罩关闭 */}
      {canNavigate && (
        <>
          <button
            type="button"
            className="image-lightbox-nav is-prev"
            onClick={(e) => {
              e.stopPropagation()
              goPrev()
            }}
            title="上一张 (←)"
            aria-label="上一张"
          >
            <Icons.ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="image-lightbox-nav is-next"
            onClick={(e) => {
              e.stopPropagation()
              goNext()
            }}
            title="下一张 (→)"
            aria-label="下一张"
          >
            <Icons.ChevronRight size={20} />
          </button>
        </>
      )}
    </div>,
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
