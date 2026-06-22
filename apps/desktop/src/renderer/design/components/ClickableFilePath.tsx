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
import './ClickableFilePath.less'

export type PreviewFileType = 'markdown' | 'html' | 'image' | 'text' | 'universal'

/** Flyfish Viewer 覆盖的业务附件格式（Office/PDF/OFD/CAD/压缩包/邮件/EPUB/媒体/3D/结构化数据等）。 */
const FLYFISH_VIEWER_EXTENSIONS = new Set([
  '.docx',
  '.docm',
  '.dotx',
  '.dotm',
  '.doc',
  '.dot',
  '.pptx',
  '.pptm',
  '.potx',
  '.potm',
  '.ppsx',
  '.ppsm',
  '.rtf',
  '.odt',
  '.odp',
  '.xlsx',
  '.xltx',
  '.xlsm',
  '.xlsb',
  '.xls',
  '.xlt',
  '.xltm',
  '.csv',
  '.ods',
  '.fods',
  '.numbers',
  '.pdf',
  '.ofd',
  '.typ',
  '.typst',
  '.zip',
  '.zipx',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.gzip',
  '.tgz',
  '.bz2',
  '.bzip2',
  '.tbz',
  '.tbz2',
  '.xz',
  '.txz',
  '.lzma',
  '.zst',
  '.tzst',
  '.cab',
  '.ar',
  '.cpio',
  '.iso',
  '.xar',
  '.lha',
  '.lzh',
  '.jar',
  '.war',
  '.ear',
  '.apk',
  '.cbz',
  '.cbr',
  '.eml',
  '.msg',
  '.mbox',
  '.dxf',
  '.dwg',
  '.dwf',
  '.dwfx',
  '.xps',
  '.glb',
  '.gltf',
  '.obj',
  '.stl',
  '.ply',
  '.fbx',
  '.dae',
  '.3ds',
  '.3mf',
  '.amf',
  '.usd',
  '.usda',
  '.usdc',
  '.usdz',
  '.kmz',
  '.step',
  '.stp',
  '.iges',
  '.igs',
  '.ifc',
  '.3dm',
  '.pcd',
  '.wrl',
  '.vrml',
  '.xyz',
  '.vtk',
  '.vtp',
  '.geojson',
  '.kml',
  '.gpx',
  '.shp',
  '.excalidraw',
  '.drawio',
  '.dio',
  '.epub',
  '.umd',
  '.avif',
  '.heic',
  '.heif',
  '.jxl',
  '.mp4',
  '.webm',
  '.m3u8',
  '.mp3',
  '.mpeg',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.flac',
  '.weba',
  '.midi',
  '.mid',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.psd',
  '.ai',
  '.eps',
  '.sqlite',
  '.wasm',
  '.parquet',
  '.avro',
  '.webarchive',
])

/** 常见文件扩展名（用于路径识别） */
const COMMON_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.markdown',
  '.mdx',
  '.html',
  '.htm',
  '.css',
  '.less',
  '.scss',
  '.sass',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.avif',
  '.heic',
  '.heif',
  '.tiff',
  '.tif',
  '.txt',
  '.text',
  '.log',
  '.xml',
  '.svg',
  '.vue',
  '.svelte',
  ...FLYFISH_VIEWER_EXTENSIONS,
])

type Props = {
  /** 文件路径文本 */
  path: string
  /** 点击预览时的回调（用于内置侧拉框预览） */
  onPreview?: (filePath: string, fileType: PreviewFileType) => void
}

/**
 * 判断文件是否可预览
 */
function getPreviewFileType(filePath: string): PreviewFileType | null {
  const ext = getFileExtension(filePath).toLowerCase()
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext))
    return 'image'
  if (ext === '.txt' || ext === '.text') return 'text'
  if (FLYFISH_VIEWER_EXTENSIONS.has(ext)) return 'universal'
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
  const { invoke: revealFile } = useIpcInvoke('file:reveal')
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

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success('已复制路径')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    }
  }, [path, toast])

  const handleOpenWithDefault = useCallback(async () => {
    try {
      const res = await openFile({ filePath: path })
      if (!res.opened) {
        toast.error(res.error ?? '无法打开文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    }
  }, [path, openFile, toast])

  const handleReveal = useCallback(async () => {
    try {
      const res = await revealFile({ filePath: path })
      if (!res.revealed) {
        toast.error(res.error ?? '无法定位文件')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '定位文件失败')
    }
  }, [path, revealFile, toast])

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
        title={isPreviewable ? `预览 ${path}` : `打开 ${path}（右键查看更多）`}
      >
        {path}
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
export function ClickableUrl({ url }: { url: string }): ReactNode {
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
      {url}
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
    /(?:^|\s)((?:\/[\w.-]+)+(?:\.\w+)?|(?:[A-Za-z]:[\\\/][\w.-]+)+(?:\.\w+)?|(?:\.\.?\/[\w.-]+)+(?:\.\w+)?|(?:src|lib|dist|build|public|app|pages|components|utils|hooks|services|api|types|models|views|layouts|assets|styles|config|test|tests|__tests__|spec|e2e)[\/\\][\w./-]+(?:\.\w+)?)/g

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
