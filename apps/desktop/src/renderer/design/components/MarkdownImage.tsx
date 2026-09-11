/**
 * MarkdownImage — 在 markdown 中渲染图片的智能组件
 *
 * 为什么需要这个组件
 * ──────────────
 * 默认 markdown 渲染把 `![alt](url)` 转成 `<img src={url} alt={alt} />`，
 * 但当 url 是本地文件路径（agent 生成的图就在 userData 下）时：
 *   1. Electron 渲染进程在 webSecurity 下无法加载 `file://`，图片破图
 *   2. 用户无法预览、复制、下载这张图
 *
 * 本组件：
 *   1. 识别本地文件路径，自动转成 `safe-file://...` URL 给 `<img>` 用（主进程协议）
 *   2. 渲染失败时显示占位图（图标 + 文件名），不出现破图
 *   3. 鼠标 hover 出现工具条：放大预览、复制、下载
 *   4. 点击图片打开全屏预览 Modal
 *
 * 同时支持普通 http(s)/data URL（用于网络图片）。
 */

import { normalizeEduAssetUrl } from '@spark/shared'
import { useEffect, useMemo, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { useToast } from './Toast'
import { ImagePreviewModal, type LightboxImage } from './ImagePreviewModal'

/** gallery 里的单张图；src 与本体 src 同形（本地路径 / http(s) / data: 等），由本组件统一解析 */
export interface MarkdownImageGalleryItem {
  src: string
  alt?: string
}

type Props = {
  /** 原始 src，可能为本地路径、file:// URL、http(s) URL、data: URL */
  src: string
  /** alt 文本，失败占位时也用作文件名 fallback */
  alt: string
  /**
   * 相对路径 src 的解析基准目录（例如被预览 markdown 文件所在目录）。
   * 提供后 `./images/a.png`、`images/a.png`、`../assets/a.png` 会先解析成绝对路径
   * 再走 safe-file:// 转换；缺省时保持旧行为（相对路径原样透传，由失败占位兜底）。
   */
  basePath?: string | null
  /**
   * 多图导航：本图所在的同组图片列表（含自身）与自身序号。
   * 列表多于 1 张时，全屏预览支持左右切换；缺省或仅 1 张时行为与原来完全一致。
   */
  gallery?: { images: MarkdownImageGalleryItem[]; index: number } | undefined
}

const SAFE_FILE_SCHEME = 'safe-file'

/**
 * 把各种形式的图片 src 统一转换为浏览器可用的 URL。
 *   - 已经是 http(s) / data: / safe-file: 的，原样返回
 *   - file:// URL 提取出路径，转 safe-file://
 *   - 绝对路径：base64url 编码后转 safe-file://
 *   - 相对路径：提供 basePath 时解析为绝对路径再转 safe-file://，
 *     否则原样返回（加载会失败，由错误占位兜底）
 *
 * 导出供行为日志缩略图（ToolLogRichOutput）等渲染侧复用同一转换策略。
 */
export function resolveImageSrc(src: string, basePath?: string | null): string {
  if (!src) return src

  const trimmed = src.trim()
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith(`${SAFE_FILE_SCHEME}:`) ||
    lower.startsWith('blob:')
  ) {
    return lower.startsWith('http://') || lower.startsWith('https://')
      ? normalizeEduAssetUrl(trimmed)
      : trimmed
  }

  if (lower.startsWith('file://')) {
    // file:///Users/foo/image.png  → 提取 /Users/foo/image.png
    try {
      const decoded = decodeURI(trimmed.replace(/^file:\/\//, ''))
      return encodeToSafeFileUrl(decoded.startsWith('/') ? decoded : `/${decoded}`)
    } catch {
      return trimmed
    }
  }

  // 绝对路径（macOS/Linux 以 / 开头；Windows 形如 C:\...）
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return encodeToSafeFileUrl(trimmed)
  }

  // 相对路径（./images/a.png、images/a.png、../assets/a.png）：以 basePath 为基准
  // 解析成绝对路径，再走统一的 safe-file:// 转换。
  if (basePath) {
    const resolved = joinRelativePath(basePath, trimmed)
    if (resolved) return encodeToSafeFileUrl(resolved)
  }

  // 无基准目录 / 其它，原样交给浏览器，加载失败时由 Error 占位兜底
  return trimmed
}

/** 相对 URL 里的 %XX 转义还原为文件名字面量；非法转义（如 `100%.png`）原样返回。 */
function decodeRelativePath(path: string): string {
  if (!path.includes('%')) return path
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * 渲染进程侧没有 node:path，这里按平台分隔符做一次受控的 join + 规范化：
 * 处理 `./`、`../` 与混用分隔符；`..` 会逐级弹出基准目录段（Windows 盘符段为下限），
 * 越过根目录或结果为空时返回 null，交回调用方走原样透传分支。
 */
function joinRelativePath(baseDir: string, relativePath: string): string | null {
  const base = baseDir.replace(/[\\/]+$/, '')
  if (!base) return null
  const separator = base.includes('\\') ? '\\' : '/'
  const segments = base.split(/[\\/]+/).filter(Boolean)
  // 根目录下限：Windows 盘符段（如 C:）不可被 .. 弹出
  const floor = /^[A-Za-z]:$/.test(segments[0] ?? '') ? 1 : 0
  for (const segment of decodeRelativePath(relativePath).split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length > floor) segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) return null
  const joined = segments.join(separator)
  // POSIX 绝对基准补回根斜杠；Windows 盘符与防御性相对基准直接拼接
  return base.startsWith('/') ? `/${joined}` : joined
}

function encodeToSafeFileUrl(absolutePath: string): string {
  // 与主进程 SafeFileProtocol.toSafeFileUrl 保持一致的编码方式
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${SAFE_FILE_SCHEME}://x/${encoded}`
}

/** 从 src / alt 中解析可读的文件名（用于占位与保存对话框） */
function deriveFileName(src: string, alt: string): string {
  if (alt && alt.trim()) return alt.trim()
  // 去掉 query / hash
  const queryStripped = src.split('?')[0] ?? src
  const hashStripped = queryStripped.split('#')[0] ?? queryStripped
  // 取最后一段
  const last = hashStripped.split(/[\\/]/).filter(Boolean).pop() ?? 'image'
  return last
}

export function MarkdownImage({ src, alt, basePath, gallery }: Props): ReactNode {
  const { toast } = useToast()
  const [error, setError] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const resolvedSrc = useMemo(() => resolveImageSrc(src, basePath), [src, basePath])
  const fileName = useMemo(() => deriveFileName(src, alt), [src, alt])
  const isLocal = useMemo(() => resolvedSrc.startsWith(`${SAFE_FILE_SCHEME}:`), [resolvedSrc])

  // 多图导航：把同组图片统一解析为 lightbox 可加载的 URL；仅 1 张（或未传）时不启用
  const galleryNavigation = useMemo<LightboxImage[] | null>(() => {
    if (!gallery || gallery.images.length <= 1) return null
    return gallery.images.map((item) => ({
      src: resolveImageSrc(item.src, basePath),
      alt: item.alt ?? '',
      fileName: deriveFileName(item.src, item.alt ?? ''),
    }))
  }, [gallery, basePath])

  // src 变化时清空 error 状态
  useEffect(() => {
    setError(false)
  }, [src])

  const handlePreview = useCallback(() => {
    if (error) return
    setPreviewOpen(true)
  }, [error])

  /** 复制图片到剪贴板。优先用 fetch 取 blob，再走 Clipboard API */
  const handleCopy = useCallback(async () => {
    if (error) {
      toast.warning('图片加载失败，无法复制')
      return
    }
    try {
      let blob: Blob | null = null
      // safe-file 协议已声明 supportFetchAPI，渲染进程可以用 fetch 取
      if (resolvedSrc.startsWith(`${SAFE_FILE_SCHEME}:`) || resolvedSrc.startsWith('http')) {
        const resp = await fetch(resolvedSrc)
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
  }, [resolvedSrc, error, toast])

  /** 通过主进程弹保存对话框 */
  const handleDownload = useCallback(async () => {
    if (error) {
      toast.warning('图片加载失败，无法下载')
      return
    }
    setDownloading(true)
    try {
      // 安全起见：只有本地文件走主进程保存对话框（防止从网络图片上下载别人的版权内容时被滥用）
      // 网络图片走浏览器 a[download] 直接保存
      if (isLocal) {
        const sourcePath = decodeSrcToPath(resolvedSrc)
        if (!sourcePath) {
          toast.error('下载失败：无法解析图片路径')
          return
        }
        const res = await window.spark.invoke('file:save-image', {
          sourcePath,
          suggestedFileName: fileName,
        })
        if (res.saved) {
          toast.success(`已保存到 ${res.savedPath}`)
        }
        // 用户取消时不提示
      } else {
        // 网络图片：a[download] 触发浏览器下载
        const a = document.createElement('a')
        a.href = resolvedSrc
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
  }, [resolvedSrc, isLocal, error, fileName, toast])

  return (
    <>
      <span className={`md-image ${error ? 'md-image-error' : ''}`}>
        {error ? (
          // 失败占位（用户起码能看到这是个图片资源 + 文件名 + 工具条）
          <span className="md-image-placeholder" role="img" aria-label={alt}>
            <span className="md-image-placeholder-icon">
              <Icons.Image size={28} />
            </span>
            <span className="md-image-placeholder-text">
              <span className="md-image-placeholder-name">{fileName}</span>
              <span className="md-image-placeholder-hint">图片加载失败</span>
            </span>
          </span>
        ) : (
          <img
            src={resolvedSrc}
            alt={alt}
            className="md-image-img"
            loading="lazy"
            referrerPolicy="no-referrer"
            onClick={handlePreview}
            onError={() => setError(true)}
          />
        )}
        {!error && (
          <span className="md-image-toolbar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="md-image-tool"
              title="放大预览"
              onClick={handlePreview}
            >
              <Icons.Maximize size={11} />
            </button>
            <button type="button" className="md-image-tool" title="复制图片" onClick={handleCopy}>
              {copied ? <Icons.Check size={11} /> : <Icons.Copy size={11} />}
            </button>
            <button
              type="button"
              className="md-image-tool"
              title="下载到本地"
              onClick={handleDownload}
              disabled={downloading}
            >
              <Icons.Download size={11} />
            </button>
          </span>
        )}
      </span>
      {previewOpen && !error && (
        <ImagePreviewModal
          src={resolvedSrc}
          alt={alt}
          fileName={fileName}
          onClose={() => setPreviewOpen(false)}
          navigation={
            galleryNavigation
              ? {
                  images: galleryNavigation,
                  startIndex: Math.min(
                    Math.max(gallery?.index ?? 0, 0),
                    galleryNavigation.length - 1,
                  ),
                }
              : undefined
          }
        />
      )}
    </>
  )
}

/** 把 safe-file://x/<base64> 解码回绝对路径（仅 renderer 端用于 IPC 调用） */
function decodeSrcToPath(safeFileUrl: string): string | null {
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
