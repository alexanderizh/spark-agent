/**
 * 远程产物预览 tab（面板内动态 tab，2026-11-25 对齐本地 openUnifiedSidePanel 的
 * preview:<path> 动态页签）。取回链路与 RemoteDocPreview 同源（remoteFileCache
 * → userData 缓存 → FilePreviewPanel 渲染），差异只是落在面板滚动区而不是抽屉。
 */
import { useState } from 'react'
import { Icons } from '../../Icons'
import { FilePreviewPanel } from '../../components/FilePreviewPanel'
import { getPreviewFileType } from '../../components/FileDisplay'
import { useRemoteFile } from './remoteFileCache'
import { fileNameOf } from './remoteRichContent'

function PreviewBody({
  deviceId,
  remotePath,
  onClose,
}: {
  deviceId: string
  remotePath: string
  onClose: () => void
}) {
  const file = useRemoteFile(deviceId, remotePath, true)
  const fileType = getPreviewFileType(file.localPath ?? remotePath) ?? 'universal'
  if (file.loading) {
    return <div className="rc-doc-hint">正在从目标电脑取回文件…</div>
  }
  if (file.error != null) {
    return (
      <div className="rc-doc-hint is-error" role="alert">
        {file.error}
      </div>
    )
  }
  if (file.localPath == null) {
    return <div className="rc-doc-hint">内容还没有取回</div>
  }
  return (
    <FilePreviewPanel
      filePath={file.localPath}
      fileType={fileType}
      variant="embedded"
      onClose={onClose}
    />
  )
}

export interface RemotePreviewTabProps {
  deviceId: string
  remotePath: string
  onClose: () => void
}

export function RemotePreviewTab({ deviceId, remotePath, onClose }: RemotePreviewTabProps) {
  // 重试 = 换 key 重建取回；fetchRemoteAttachment 失败会移除缓存，重建即重拉
  const [retryToken, setRetryToken] = useState(0)

  return (
    <div className="rc-preview-tab">
      <div className="rc-preview-tab-head">
        <Icons.File size={13} />
        <span className="rc-preview-tab-name" title={remotePath}>
          {fileNameOf(remotePath)}
        </span>
        <button
          type="button"
          className="rc-icon-btn"
          onClick={() => setRetryToken((token) => token + 1)}
          title="重新取回"
          aria-label="重新取回"
        >
          <Icons.Refresh size={13} />
        </button>
        <button
          type="button"
          className="rc-icon-btn"
          onClick={onClose}
          title="关闭预览"
          aria-label="关闭预览"
        >
          <Icons.X size={13} />
        </button>
      </div>
      <div className="rc-preview-tab-body">
        <PreviewBody key={retryToken} deviceId={deviceId} remotePath={remotePath} onClose={onClose} />
      </div>
    </div>
  )
}
