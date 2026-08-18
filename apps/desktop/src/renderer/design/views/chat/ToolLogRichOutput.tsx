// 行为日志富输出渲染：图片缩略图预览 + 联网搜索来源链接列表。
// 数据提取在 rich-output-parsing.ts（纯函数）；本文件只负责展示，
// 由 ChatView 的 ToolLogEntry 接线调用。

import { useCallback, useState, type ReactNode } from 'react'
import { resolveImageSrc } from '../../components/MarkdownImage'
import { ClickableUrl } from '../../components/ClickableFilePath'
import type { FileOpenHandler } from '../../components/fileOpenRouting'
import type { RichImageDisplay, RichSourceLink } from './rich-output-parsing'

/** 来源链接最多展示条数 */
const MAX_SOURCE_LINKS = 8

/**
 * 图片缩略图：本地文件经 safe-file:// 转换后展示，点击复用统一文件预览
 * （onFilePreview 缺失或截图 dataUrl 无落盘路径时仅静态展示）。
 */
export function ToolLogImageThumb({
  image,
  onFilePreview,
}: {
  image: RichImageDisplay
  onFilePreview?: FileOpenHandler
}): ReactNode {
  const [error, setError] = useState(false)
  const resolvedSrc = resolveImageSrc(image.src)
  const filePath = image.filePath
  const alt = filePath ?? '截图'

  const handleClick = useCallback(() => {
    if (filePath != null) onFilePreview?.(filePath, 'image', { mode: 'preview' })
  }, [filePath, onFilePreview])

  if (error) {
    return (
      <div className="tool-log-image-thumb is-error">
        <span className="tool-log-image-error">图片加载失败：{alt}</span>
      </div>
    )
  }

  return (
    <div className="tool-log-image-thumb">
      <img
        src={resolvedSrc}
        alt={alt}
        loading="lazy"
        onError={() => setError(true)}
        {...(filePath != null && onFilePreview != null
          ? { onClick: handleClick, className: 'is-clickable' }
          : {})}
      />
    </div>
  )
}

/** 联网搜索来源列表：复用 ClickableUrl（favicon + 标题预览 + 外部打开） */
export function ToolLogSourceList({ links }: { links: RichSourceLink[] }): ReactNode {
  return (
    <div className="tool-log-section tool-log-sources">
      <div className="tool-log-section-label">来源</div>
      <div className="tool-log-sources-list">
        {links.slice(0, MAX_SOURCE_LINKS).map((link) => (
          <ClickableUrl key={link.url} url={link.url} label={link.title} />
        ))}
      </div>
    </div>
  )
}
