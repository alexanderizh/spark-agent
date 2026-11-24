import { useCallback, useState, type ReactNode } from 'react'
import { FilePathContextMenu } from '../../components/FilePathContextMenu'
import type { FileOpenHandler, FileOpenMode } from '../../components/fileOpenRouting'
import {
  FileTypeIcon,
  getFileTypeBadge,
  getPreviewFileType,
  normalizeFileReference,
} from '../../components/FileDisplay'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'

const DOCUMENT_OUTPUT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'docm',
  'dot',
  'dotx',
  'dotm',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'xlt',
  'xltx',
  'xltm',
  'csv',
  'ods',
  'numbers',
  'ppt',
  'pptx',
  'pptm',
  'pot',
  'potx',
  'potm',
  'pps',
  'ppsx',
  'ppsm',
  'odp',
  'key',
  'pdf',
  'html',
  'htm',
  'txt',
  'text',
  'md',
  'markdown',
  'mdx',
])

function getFileNameFromReference(filePath: string): string {
  const normalized = normalizeFileReference(filePath)
  return normalized.split(/[\\/]/).pop() || normalized
}

function getReferenceExtension(filePath: string): string {
  const fileName = getFileNameFromReference(filePath).toLowerCase()
  const lastDot = fileName.lastIndexOf('.')
  return lastDot >= 0 ? fileName.slice(lastDot + 1) : ''
}

export function isDocumentOutputReference(filePath: string): boolean {
  const ext = getReferenceExtension(filePath)
  return DOCUMENT_OUTPUT_EXTENSIONS.has(ext)
}

export function filterDocumentOutputFiles<T extends { path: string }>(files: T[]): T[] {
  return files.filter((file) => isDocumentOutputReference(file.path))
}

export function getDocumentOutputKey(filePath: string): string {
  return normalizeFileReference(filePath).replace(/\\/g, '/').toLowerCase()
}

export function collectDocumentOutputKeys(text: string): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  const refs = lines.map(parseDocumentOutputLine)
  if (refs.some((item) => item == null)) return []
  return refs.flatMap((item) => (item == null ? [] : [getDocumentOutputKey(item.filePath)]))
}

/**
 * 判断一段文本是否具备「真实文件路径」的形状。
 *
 * `parseDocumentOutputLine` 的裸路径兜底分支依赖它做守卫：散文行
 * （例如「本轮诊断记录已更新到 [xxx.md](/G:/...)。」）即使剥掉句尾标点后
 * 末段扩展名命中文档白名单，也不应把整行折叠成文档卡片。
 *
 * 判定规则：
 * - 不允许空白字符与 markdown/括号语法；
 * - 必须具备明确路径形状：盘符（含 /G:/ 风格链接）、UNC、Unix 绝对路径、
 *   ~ 开头、./ 或 ../ 开头，或至少含一个路径分隔符的纯路径段相对路径。
 */
export function isPathShapedFileReference(value: string): boolean {
  const raw = value.trim()
  if (raw.length === 0) return false
  if (/^file:\/\//i.test(raw)) return true

  const filePath = normalizeFileReference(raw)
  if (filePath.length === 0) return false
  if (/\s/.test(filePath)) return false
  if (/[[\]()<>"]/.test(filePath)) return false
  if (/^[A-Za-z]:[\\/]/.test(filePath)) return true
  if (/^\/[A-Za-z]:[\\/]/.test(filePath)) return true
  if (/^\\\\/.test(filePath)) return true
  if (filePath.startsWith('/')) return true
  if (/^~[\\/]/.test(filePath)) return true
  if (/^[.]{1,2}[\\/]/.test(filePath)) return true
  if (!/[\\/]/.test(filePath)) return false
  return filePath
    .split(/[\\/]/)
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function parseDocumentOutputLine(line: string): { filePath: string; label?: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const link = trimmed.match(/^\[([^\]]+)]\(([^)]+)\)$/)
  if (link) {
    const filePath = link[2] ?? ''
    if (!isDocumentOutputReference(filePath)) return null
    const label = link[1]
    return label != null ? { filePath, label } : { filePath }
  }

  const code = trimmed.match(/^`([^`]+)`$/)
  const filePath = code?.[1] ?? trimmed
  if (!isDocumentOutputReference(filePath)) return null
  if (code == null && !isPathShapedFileReference(filePath)) return null
  return { filePath }
}

export function DocumentOutputCard({
  filePath,
  label,
  workspaceRootPath,
  onFilePreview,
}: {
  filePath: string
  label?: string
  /** 相对路径解析基准目录（会话工作区根），供右键「在文件夹中显示」定位本机文件 */
  workspaceRootPath?: string | null
  onFilePreview?: FileOpenHandler
}) {
  const normalizedPath = normalizeFileReference(filePath)
  const previewType = getPreviewFileType(normalizedPath)
  const badge = getFileTypeBadge(normalizedPath)
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { toast } = useToast()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleOpen = useCallback(async () => {
    if (previewType != null && onFilePreview != null) {
      onFilePreview(normalizedPath, previewType)
      return
    }
    try {
      const res = await openFile({ filePath: normalizedPath })
      if (!res.opened) toast.error(res.error ?? '无法打开文件')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    }
  }, [normalizedPath, onFilePreview, openFile, previewType, toast])

  return (
    <>
      <button
        type="button"
        className={`document-output-card type-${badge.tone}`}
        title={normalizedPath}
        onClick={() => void handleOpen()}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setContextMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <span className="document-output-card-preview" aria-hidden="true">
          <FileTypeIcon filePath={normalizedPath} size={26} />
          <span className="document-output-card-lines">
            <span />
            <span />
            <span />
          </span>
        </span>
        <span className="document-output-card-main">
          <span className="document-output-card-title">
            {label || getFileNameFromReference(filePath)}
          </span>
          <span className="document-output-card-meta">
            <span className="document-output-card-type">{badge.label}</span>
            <span className="document-output-card-path">{normalizedPath}</span>
          </span>
        </span>
        {/* <span className="document-output-card-action">
          {previewType != null && onFilePreview != null ? '预览' : '打开'}
        </span> */}
      </button>
      {contextMenu != null && (
        <FilePathContextMenu
          filePath={normalizedPath}
          workspaceRootPath={workspaceRootPath}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          {...(onFilePreview != null
            ? {
                onOpenWithMode: (mode: FileOpenMode) =>
                  onFilePreview(
                    normalizedPath,
                    mode === 'preview' ? (previewType ?? 'text') : 'text',
                    { mode },
                  ),
              }
            : {})}
        />
      )}
    </>
  )
}

export function renderDocumentOutputParagraph(
  text: string,
  seenDocumentKeys: Set<string>,
  onFilePreview: FileOpenHandler | undefined,
  keyPrefix: string,
  workspaceRootPath?: string | null,
): ReactNode | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  const refs = lines.map(parseDocumentOutputLine)
  if (refs.some((item) => item == null)) return null

  const cards = refs.flatMap((item, index) => {
    if (item == null) return []
    const key = getDocumentOutputKey(item.filePath)
    if (seenDocumentKeys.has(key)) return []
    seenDocumentKeys.add(key)
    return [
      <DocumentOutputCard
        key={`${keyPrefix}-${index}-${key}`}
        filePath={item.filePath}
        {...(item.label != null ? { label: item.label } : {})}
        {...(workspaceRootPath != null ? { workspaceRootPath } : {})}
        {...(onFilePreview != null ? { onFilePreview } : {})}
      />,
    ]
  })

  if (cards.length === 0) return null
  return (
    <div key={keyPrefix} className="document-output-card-list">
      {cards}
    </div>
  )
}
