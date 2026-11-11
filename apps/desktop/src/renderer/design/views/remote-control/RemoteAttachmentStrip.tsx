/**
 * 远程附件展示。
 *
 * 图片在目标电脑上，本机读不到：取回流程见 remoteFileCache（落 userData
 * 缓存后走 safe-file://）。取回失败给占位图标，不阻断对话。
 */
import { useState } from 'react'
import { Icons } from '../../Icons'
import { remoteFileUrl, useRemoteFile } from './remoteFileCache'

export interface RemoteAttachmentRef {
  type: 'image' | 'file'
  path: string
  name?: string
}

function RemoteImage({
  deviceId,
  attachment,
}: {
  deviceId: string
  attachment: RemoteAttachmentRef
}) {
  const file = useRemoteFile(deviceId, attachment.path, true)
  const [broken, setBroken] = useState(false)

  if (file.localPath == null || broken) {
    return (
      <span
        className={`rc-attach-image-placeholder${file.error != null || broken ? ' is-error' : ''}`}
      >
        <Icons.Image size={14} />
      </span>
    )
  }
  return (
    <img
      className="rc-attach-image"
      src={remoteFileUrl(file.localPath)}
      alt={attachment.name ?? '远程图片'}
      // 缓存文件被清理或 safe-file 拒绝时退回占位，避免出现破图 + alt 文字溢出
      onError={() => setBroken(true)}
    />
  )
}

export function RemoteAttachmentStrip({
  deviceId,
  attachments,
  onRemove,
}: {
  deviceId: string
  attachments: RemoteAttachmentRef[]
  /** 传入则显示删除按钮（发送前的待发列表） */
  onRemove?: (path: string) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="rc-attach-strip">
      {attachments.map((attachment) => {
        const fileName = attachment.name ?? attachment.path.split(/[\\/]/).pop() ?? '附件'
        return (
          <div
            className={`rc-attach-item${attachment.type === 'image' ? ' is-image' : ''}${
              onRemove != null ? ' is-removable' : ''
            }`}
            key={attachment.path}
            title={attachment.path}
          >
            {attachment.type === 'image' ? (
              <RemoteImage deviceId={deviceId} attachment={attachment} />
            ) : (
              <>
                <Icons.File size={14} />
                <span className="rc-attach-name">{fileName}</span>
              </>
            )}
            {onRemove != null && (
              <button
                type="button"
                className="rc-attach-remove"
                onClick={() => onRemove(attachment.path)}
                aria-label={`移除 ${fileName}`}
              >
                <Icons.X size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
