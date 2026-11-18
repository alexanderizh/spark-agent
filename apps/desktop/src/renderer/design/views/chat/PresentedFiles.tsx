import type { FileOpenHandler } from '../../components/fileOpenRouting'
import { DocumentOutputCard } from './ChatDocumentOutput'
import { classifyPresentedFile, PresentedMediaList, type PresentedFile } from './PresentedMedia'
import { filterPresentedFiles } from './presented-files'

/** 显式交付的媒体保留原预览，其余文件复用已有文件卡片和打开路由。 */
export function PresentedFilesList({
  files,
  workspaceRootPath,
  onFilePreview,
}: {
  files: readonly PresentedFile[]
  /** 相对路径解析基准目录（会话工作区根），供右键「在文件夹中显示」定位本机文件 */
  workspaceRootPath?: string | null
  onFilePreview?: FileOpenHandler
}) {
  const visibleFiles = filterPresentedFiles(files)
  if (visibleFiles.length === 0) return null
  const attachments = visibleFiles.filter((file) => classifyPresentedFile(file.path) == null)
  const media = visibleFiles.filter((file) => classifyPresentedFile(file.path) != null)

  return (
    <div style={{ marginTop: 8, marginBottom: 8 }}>
      {attachments.length > 0 && (
        <div className="document-output-card-list">
          {attachments.map((file) => (
            <DocumentOutputCard
              key={file.path}
              filePath={file.path}
              {...(file.title != null ? { label: file.title } : {})}
              {...(workspaceRootPath != null ? { workspaceRootPath } : {})}
              {...(onFilePreview != null ? { onFilePreview } : {})}
            />
          ))}
        </div>
      )}
      {media.length > 0 && <PresentedMediaList files={media} />}
    </div>
  )
}
