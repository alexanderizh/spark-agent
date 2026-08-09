/**
 * ClickableFilePath — 识别文件路径并渲染为可点击链接
 *
 * 支持：
 *   1. 绝对路径：/Users/xxx/file.ts、C:\Users\xxx\file.ts
 *   2. 相对路径：src/foo/bar.ts、./file.ts、../file.ts
 *   3. 点击打开文件（调用 file:open IPC）
 *   4. 对于 md/html/图片文件，触发预览回调
 *   5. 右键菜单：复制路径 / 在文件夹中显示（file:reveal IPC）
 *
 * 同文件还导出 ClickableUrl（用于裸 URL/mailto）和文本切分工具
 * extractFilePaths / extractUrlsAndEmails，供 ChatView 使用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BrowserLinkMetadata } from '@spark/protocol'
import { Dropdown } from '@lobehub/ui'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import { Icons } from '../Icons'
import {
  COMMON_FILE_EXTENSIONS,
  getFileExtension,
  getPreviewFileType,
  normalizeFileReference,
  stripTrailingFilePunctuation,
  type PreviewFileType,
} from './FileDisplay'
import './ClickableFilePath.less'

type Props = {
  /** 文件路径文本 */
  path: string
  /** 展示文本；不传时展示规范化后的路径 */
  label?: ReactNode
  /** 点击预览时的回调（用于内置侧拉框预览） */
  onPreview?: (filePath: string, fileType: PreviewFileType) => void
}

export type { PreviewFileType } from './FileDisplay'

export function ClickableFilePath({ path, label, onPreview }: Props): ReactNode {
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { invoke: revealFile } = useIpcInvoke('file:reveal')
  const { toast } = useToast()

  const normalizedPath = useMemo(() => normalizeFileReference(path), [path])
  const isPreviewable = useMemo(() => getPreviewFileType(normalizedPath) !== null, [normalizedPath])
  const fileType = useMemo(() => getPreviewFileType(normalizedPath), [normalizedPath])

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // 如果是可预览文件且有预览回调，触发预览
      if (isPreviewable && onPreview && fileType) {
        onPreview(normalizedPath, fileType)
        return
      }

      // 否则打开文件
      try {
        const res = await openFile({ filePath: normalizedPath })
        if (!res.opened) {
          toast.error(res.error ?? '无法打开文件')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '打开文件失败')
      }
    },
    [normalizedPath, isPreviewable, fileType, onPreview, openFile, toast],
  )

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(normalizedPath)
      toast.success('已复制路径')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    }
  }, [normalizedPath, toast])

  const handleOpenWithDefault = useCallback(async () => {
    try {
      const res = await openFile({ filePath: normalizedPath })
      if (!res.opened) {
        toast.error(res.error ?? '无法打开文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    }
  }, [normalizedPath, openFile, toast])

  const handleReveal = useCallback(async () => {
    try {
      const res = await revealFile({ filePath: normalizedPath })
      if (!res.revealed) {
        toast.error(res.error ?? '无法定位文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '定位文件失败')
    }
  }, [normalizedPath, revealFile, toast])

  const menu = {
    items: [
      {
        key: 'copy',
        label: (
          <span className="clickable-file-menu-item">
            <Icons.Copy size={14} /> 复制路径
          </span>
        ),
        onClick: () => void handleCopyPath(),
      },
      {
        key: 'open',
        label: (
          <span className="clickable-file-menu-item">
            <Icons.ExternalLink size={14} /> 用默认应用打开
          </span>
        ),
        onClick: () => void handleOpenWithDefault(),
      },
      {
        key: 'reveal',
        label: (
          <span className="clickable-file-menu-item">
            <Icons.Folder size={14} /> 在文件夹中显示
          </span>
        ),
        onClick: () => void handleReveal(),
      },
    ],
  }

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft">
      <span
        className="clickable-file-path"
        onClick={handleClick}
        title={isPreviewable ? `预览 ${normalizedPath}` : `打开 ${normalizedPath}（右键查看更多）`}
      >
        {label ?? normalizedPath}
      </span>
    </Dropdown>
  )
}

type UrlContextMenuPosition = {
  x: number
  y: number
}

function LinkContextMenu({
  url,
  text,
  x,
  y,
  onClose,
}: {
  url: string
  text: string
  x: number
  y: number
  onClose: () => void
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const { invoke: openExternal } = useIpcInvoke('browser:open-external')
  const { toast } = useToast()

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const copy = useCallback(
    async (value: string, message: string) => {
      try {
        await navigator.clipboard.writeText(value)
        toast.success(message)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '复制失败')
      } finally {
        onClose()
      }
    },
    [onClose, toast],
  )

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu clickable-url-context-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="action-menu-item"
        onClick={() => {
          onClose()
          void openExternal({ url }).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : '打开链接失败')
          })
        }}
      >
        <Icons.ExternalLink size={14} />
        <span>在浏览器中打开</span>
      </button>
      <button type="button" className="action-menu-item" onClick={() => void copy(url, '已复制链接')}>
        <Icons.Copy size={14} />
        <span>复制链接</span>
      </button>
      <button
        type="button"
        className="action-menu-item"
        onClick={() => void copy(text, '已复制链接文本')}
      >
        <Icons.Link size={14} />
        <span>复制链接文本</span>
      </button>
    </div>
  )
}

function getUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function LinkPreviewIcon({
  metadata,
  failed,
  onError,
}: {
  metadata: BrowserLinkMetadata
  failed: boolean
  onError: () => void
}): ReactNode {
  if (metadata.faviconUrl != null && !failed) {
    return (
      <img
        className="clickable-url-card-icon"
        src={metadata.faviconUrl}
        alt=""
        loading="lazy"
        onError={onError}
      />
    )
  }
  return (
    <span className="clickable-url-card-icon clickable-url-card-icon-fallback" aria-hidden="true">
      <Icons.Globe size={16} />
    </span>
  )
}

/**
 * ClickableUrl — 渲染裸 URL / mailto 链接。
 *
 * http(s) 链接会在后台尝试加载页面标题和 favicon；元数据不可用时保留原始链接。
 * 右键菜单沿用内容区的 action-menu 样式，提供打开、复制链接和复制链接文本。
 */
export function ClickableUrl({ url, label }: { url: string; label?: string }): ReactNode {
  // 规范化：www.foo.com → https://www.foo.com
  const href = useMemo(() => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      return url
    }
    if (url.startsWith('www.')) return `https://${url}`
    return url
  }, [url])

  const { invoke: getLinkMetadata } = useIpcInvoke('browser:get-link-metadata')
  const [metadataState, setMetadataState] = useState<{
    url: string
    metadata: BrowserLinkMetadata | null
  } | null>(null)
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<UrlContextMenuPosition | null>(null)
  const isHttpUrl = href.startsWith('http://') || href.startsWith('https://')
  const metadata = !isHttpUrl
    ? null
    : metadataState?.url === href
      ? metadataState.metadata
      : undefined
  const faviconFailed = metadata?.faviconUrl != null && failedFaviconUrl === metadata.faviconUrl

  useEffect(() => {
    if (!isHttpUrl) return

    let cancelled = false
    void getLinkMetadata({ url: href })
      .then((response) => {
        if (!cancelled) setMetadataState({ url: href, metadata: response.metadata })
      })
      .catch(() => {
        if (!cancelled) setMetadataState({ url: href, metadata: null })
      })

    return () => {
      cancelled = true
    }
  }, [getLinkMetadata, href, isHttpUrl])

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const displayText = label ?? url
  const hasPreview = metadata != null

  return (
    <>
      <a
        className={`clickable-url${hasPreview ? ' clickable-url-card' : ''}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        title={hasPreview ? metadata.title : href}
        aria-label={hasPreview ? `${metadata.title} — ${href}` : href}
        onContextMenu={handleContextMenu}
      >
        {hasPreview ? (
          <>
            <LinkPreviewIcon
              metadata={metadata}
              failed={faviconFailed}
              onError={() => setFailedFaviconUrl(metadata.faviconUrl ?? null)}
            />
            <span className="clickable-url-card-body">
              <span className="clickable-url-card-title">{metadata.title}</span>
              <span className="clickable-url-card-domain">{getUrlDomain(href)}</span>
              <span className="clickable-url-card-url">{displayText}</span>
            </span>
          </>
        ) : (
          displayText
        )}
      </a>
      {contextMenu != null && (
        <LinkContextMenu
          url={href}
          text={displayText}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

/**
 * 识别文本中的文件路径
 * 返回 { text, isPath } 数组
 */
export function extractFilePaths(text: string): Array<{ text: string; isPath: boolean }> {
  const result: Array<{ text: string; isPath: boolean }> = []

  // 匹配绝对路径（Unix/Windows）和相对路径
  // 注意：这个正则表达式要足够严格，避免误匹配
  const pathPattern =
    /(?:^|\s)((?:file:[/]{3}[^\s<>"'`，。；：！？）」』】]+)|(?:[/][^\s<>"'`，。；：！？）」』】]+)|(?:[A-Za-z]:[/\\][^\s<>"'`，。；：！？）」』】]+)|(?:[.]{1,2}[/][^\s<>"'`，。；：！？）」』】]+)|(?:(?:src|lib|dist|build|public|app|pages|components|utils|hooks|services|api|types|models|views|layouts|assets|styles|config|test|tests|__tests__|spec|e2e)[/\\][^\s<>"'`，。；：！？）」』】]+))/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pathPattern.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = match.index + match[0].length
    const matchedPath = stripTrailingFilePunctuation(match[1] ?? '')
    if (matchedPath == null) continue

    // 添加匹配前的文本
    if (matchStart > lastIndex) {
      result.push({ text: text.slice(lastIndex, matchStart), isPath: false })
    }

    // 检查是否有常见文件扩展名
    const ext = getFileExtension(normalizeFileReference(matchedPath)).toLowerCase()
    if (COMMON_FILE_EXTENSIONS.has(ext)) {
      result.push({ text: matchedPath, isPath: true })
    } else {
      result.push({ text: matchedPath, isPath: false })
    }

    lastIndex = matchEnd
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex), isPath: false })
  }

  return result
}

/**
 * 识别文本中的裸 URL / www. / mailto，按出现顺序切分。
 *
 * 末尾常见的句末标点 ( , . ; : ! ? ) 「 」 ）等不视为链接的一部分，
 * 避免吃掉中文/英文的句末符号导致复制 URL 时多带尾巴。
 */
export function extractUrlsAndEmails(text: string): Array<{ text: string; kind: 'text' | 'url' }> {
  const result: Array<{ text: string; kind: 'text' | 'url' }> = []
  // 匹配 https?:// / www. / mailto:
  const pattern =
    /(https?:\/\/[^\s<>"'`，。；：！？）」』】]+|www\.[^\s<>"'`，。；：！？）」』】]+|mailto:[^\s<>"'`，。；：！？）」』】]+)/g
  // 末尾若残留这些标点，剥离掉
  const trailingPunct = /[)\]>}！？，。；：、,.;:!?]+$/

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    let url = match[0]
    let matchEnd = match.index + url.length
    const trim = url.match(trailingPunct)
    if (trim) {
      url = url.slice(0, url.length - trim[0].length)
      matchEnd = match.index + url.length
    }
    if (url.length === 0) continue
    // www. 需要至少 www.x.x 才算 URL，避免误吃 "www.txt" 之类
    if (url.startsWith('www.') && !/^www\.[^./\s]+\.[^./\s]+/.test(url)) continue

    if (match.index > lastIndex) {
      result.push({ text: text.slice(lastIndex, match.index), kind: 'text' })
    }
    result.push({ text: url, kind: 'url' })
    lastIndex = matchEnd
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex), kind: 'text' })
  }

  return result
}
