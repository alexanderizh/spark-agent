import { useCallback, type ReactNode } from 'react'
import type { PreviewFileType } from '../../components/ClickableFilePath'
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
  return { filePath }
}

export function DocumentOutputCard({
  filePath,
  label,
  onFilePreview,
}: {
  filePath: string
  label?: string
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
}) {
  const normalizedPath = normalizeFileReference(filePath)
  const previewType = getPreviewFileType(normalizedPath)
  const badge = getFileTypeBadge(normalizedPath)
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { toast } = useToast()

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
    <button
      type="button"
      className={`document-output-card type-${badge.tone}`}
      title={normalizedPath}
      onClick={() => void handleOpen()}
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
  )
}

export function renderDocumentOutputParagraph(
  text: string,
  seenDocumentKeys: Set<string>,
  onFilePreview: ((filePath: string, fileType: PreviewFileType) => void) | undefined,
  keyPrefix: string,
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
