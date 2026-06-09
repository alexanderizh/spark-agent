/**
 * ClickableFilePath — 识别文件路径并渲染为可点击链接
 *
 * 支持：
 *   1. 绝对路径：/Users/xxx/file.ts、C:\Users\xxx\file.ts
 *   2. 相对路径：src/foo/bar.ts、./file.ts、../file.ts
 *   3. 点击打开文件（调用 file:open IPC）
 *   4. 对于 md/html/图片文件，触发预览回调
 */

import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import './ClickableFilePath.less'

/** 可预览的文件扩展名 */
const PREVIEWABLE_EXTENSIONS = new Set([
  // Markdown
  '.md', '.markdown', '.mdx',
  // HTML
  '.html', '.htm',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  // Text
  '.txt', '.text',
])

/** 常见文件扩展名（用于路径识别） */
const COMMON_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.markdown', '.mdx',
  '.html', '.htm', '.css', '.less', '.scss', '.sass',
  '.json', '.yaml', '.yml', '.toml',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.txt', '.text', '.log',
  '.xml', '.svg', '.vue', '.svelte',
])

type Props = {
  /** 文件路径文本 */
  path: string
  /** 点击预览时的回调（用于 md/html/图片文件） */
  onPreview?: (filePath: string, fileType: 'markdown' | 'html' | 'image' | 'text') => void
}

/**
 * 判断文件是否可预览
 */
function getPreviewFileType(filePath: string): 'markdown' | 'html' | 'image' | 'text' | null {
  const ext = getFileExtension(filePath).toLowerCase()
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) return 'image'
  if (ext === '.txt' || ext === '.text') return 'text'
  return null
}

/**
 * 获取文件扩展名（包含点号）
 */
function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot < 0) return ''
  return filePath.slice(lastDot)
}

export function ClickableFilePath({ path, onPreview }: Props): ReactNode {
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { toast } = useToast()

  const isPreviewable = useMemo(() => getPreviewFileType(path) !== null, [path])
  const fileType = useMemo(() => getPreviewFileType(path), [path])

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // 如果是可预览文件且有预览回调，触发预览
      if (isPreviewable && onPreview && fileType) {
        onPreview(path, fileType)
        return
      }

      // 否则打开文件
      try {
        const res = await openFile({ filePath: path })
        if (!res.opened) {
          toast.error(res.error ?? '无法打开文件')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '打开文件失败')
      }
    },
    [path, isPreviewable, fileType, onPreview, openFile, toast],
  )

  return (
    <span
      className="clickable-file-path"
      onClick={handleClick}
      title={isPreviewable ? `预览 ${path}` : `打开 ${path}`}
    >
      {path}
    </span>
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
  const pathPattern = /(?:^|\s)((?:\/[\w.-]+)+(?:\.\w+)?|(?:[A-Za-z]:[\\\/][\w.-]+)+(?:\.\w+)?|(?:\.\.?\/[\w.-]+)+(?:\.\w+)?|(?:src|lib|dist|build|public|app|pages|components|utils|hooks|services|api|types|models|views|layouts|assets|styles|config|test|tests|__tests__|spec|e2e)[\/\\][\w./-]+(?:\.\w+)?)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pathPattern.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = match.index + match[0].length
    const matchedPath = match[1]
    if (matchedPath == null) continue

    // 添加匹配前的文本
    if (matchStart > lastIndex) {
      result.push({ text: text.slice(lastIndex, matchStart), isPath: false })
    }

    // 检查是否有常见文件扩展名
    const ext = getFileExtension(matchedPath)
    if (COMMON_EXTENSIONS.has(ext)) {
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
