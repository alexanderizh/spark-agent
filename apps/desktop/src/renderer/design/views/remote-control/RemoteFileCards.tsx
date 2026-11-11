/**
 * 远程产物卡片（对应 presented_files 事件）。
 *
 * 目标端只给路径，所以「打开」先把文件取回到本机缓存，再交给系统默认应用；
 * 「预览」对 html / 图片 / 文本就地在对话里渲染，不另开窗口。
 */
import { useState } from 'react'
import type { RemoteAgentFileEntry } from './remoteEventMerge'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { RemoteHtmlPreview } from './RemoteHtmlPreview'
import {
  classifyRemoteFile,
  describeFileCount,
  fileNameOf,
  type RemoteFileKind,
} from './remoteRichContent'
import { fetchRemoteAttachment, remoteFileUrl, useRemoteFile } from './remoteFileCache'

function FileKindIcon({ kind }: { kind: RemoteFileKind }) {
  if (kind === 'image') return <Icons.Image size={14} />
  if (kind === 'html') return <Icons.Globe size={14} />
  if (kind === 'markdown' || kind === 'text') return <Icons.FileText size={14} />
  if (kind === 'code') return <Icons.Code size={14} />
  return <Icons.File size={14} />
}

const PREVIEWABLE: RemoteFileKind[] = ['html', 'image', 'markdown', 'text', 'code']

function RemoteFileRow({ deviceId, file }: { deviceId: string; file: RemoteAgentFileEntry }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const remoteFile = useRemoteFile(deviceId, file.path, previewOpen)
  const kind = classifyRemoteFile(file.path)
  const name = file.title ?? fileNameOf(file.path)
  const canPreview = PREVIEWABLE.includes(kind)
  const { invoke: openLocalFile } = useIpcInvoke('file:open')

  const handleOpen = async () => {
    setOpening(true)
    setOpenError(null)
    try {
      // 本机未必有这份文件，先取回缓存再用系统默认应用打开
      const cached = await fetchRemoteAttachment(deviceId, file.path)
      const result = await openLocalFile({ filePath: cached.localPath })
      if (!result.opened) setOpenError(result.error ?? '无法用系统应用打开')
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="rc-file">
      <div className="rc-file-row">
        <span className="rc-file-icon">
          <FileKindIcon kind={kind} />
        </span>
        <span className="rc-file-name" title={file.path}>
          {name}
        </span>
        <div className="rc-file-actions">
          {canPreview && (
            <button
              type="button"
              className={`rc-file-btn${previewOpen ? ' active' : ''}`}
              onClick={() => setPreviewOpen((value) => !value)}
              aria-expanded={previewOpen}
            >
              <Icons.Eye size={12} />
              {previewOpen ? '收起' : '预览'}
            </button>
          )}
          <button
            type="button"
            className="rc-file-btn"
            onClick={() => void handleOpen()}
            disabled={opening}
          >
            <Icons.ExternalLink size={12} />
            {opening ? '打开中…' : '打开'}
          </button>
        </div>
      </div>

      {openError != null && <div className="rc-file-error">{openError}</div>}

      {previewOpen && (
        <div className="rc-file-preview">
          {remoteFile.loading && <div className="rc-file-hint">正在从目标电脑取回…</div>}
          {remoteFile.error != null && <div className="rc-file-error">{remoteFile.error}</div>}
          {!remoteFile.loading && remoteFile.error == null && remoteFile.localPath != null && (
            <>
              {kind === 'image' && (
                <img
                  className="rc-file-image"
                  src={remoteFileUrl(remoteFile.localPath)}
                  alt={name}
                />
              )}
              {kind === 'html' && remoteFile.text != null && (
                <RemoteHtmlPreview html={remoteFile.text} title={name} />
              )}
              {(kind === 'markdown' || kind === 'text' || kind === 'code') && (
                <pre className="rc-file-text">{remoteFile.text ?? '（该文件不支持内联预览）'}</pre>
              )}
              {kind === 'html' && remoteFile.text == null && (
                <div className="rc-file-hint">HTML 内容没有取回原文，请用「打开」查看。</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function RemoteFileCards({
  deviceId,
  files,
}: {
  deviceId: string
  files: RemoteAgentFileEntry[]
}) {
  if (files.length === 0) return null
  return (
    <div className="rc-files">
      <div className="rc-files-head">
        <Icons.Package size={12} />
        <span>产物</span>
        <span className="rc-files-count">{describeFileCount(files.length)}</span>
      </div>
      {files.map((file) => (
        <RemoteFileRow key={file.path} deviceId={deviceId} file={file} />
      ))}
    </div>
  )
}
