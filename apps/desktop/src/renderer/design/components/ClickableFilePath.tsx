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

import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
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

/**
 * ClickableUrl — 渲染可点击的 URL / mailto 链接
 *
 * 普通 https?:// 与 www. 走 <a target="_blank">，由 Electron main 进程
 * 的 setWindowOpenHandler 接管 → shell.openExternal 调起系统默认浏览器。
 * mailto: 走默认邮件客户端。
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

  return (
    <a className="clickable-url" href={href} target="_blank" rel="noreferrer" title={href}>
      {label ?? url}
    </a>
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
