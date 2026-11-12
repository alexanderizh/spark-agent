/**
 * 远程附件展示。
 *
 * 图片在目标电脑上，本机读不到：取回流程见 remoteFileCache（落 userData
 * 缓存后走 safe-file://）。取回失败给占位图标，不阻断对话。
 * 缩略图可点开大图（本机已有文件时直接用它，不再回拉目标端）。
 */
import { useState } from 'react'
import { Icons } from '../../Icons'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'
import { remoteFileUrl, useRemoteFile } from './remoteFileCache'

export interface RemoteAttachmentRef {
  type: 'image' | 'file'
  path: string
  name?: string
  /** 本机已有同一份文件时（粘贴图片）直接用它当缩略图，不必等目标端回图 */
  previewUrl?: string
}

function RemoteImage({
  deviceId,
  attachment,
  onOpen,
}: {
  deviceId: string
  attachment: RemoteAttachmentRef
  /** 拿到可加载的地址才能点开大图（取回失败 / 占位时不给点） */
  onOpen: (src: string, fileName: string) => void
}) {
  // 有本机预览就不再问目标端要图（粘贴图片走这条）
  const file = useRemoteFile(deviceId, attachment.path, attachment.previewUrl == null)
  const [broken, setBroken] = useState(false)
  const src =
    attachment.previewUrl ?? (file.localPath != null ? remoteFileUrl(file.localPath) : null)

  if (src == null || broken) {
    return (
      <span
        className={`rc-attach-image-placeholder${file.error != null || broken ? ' is-error' : ''}`}
      >
        <Icons.Image size={14} />
      </span>
    )
  }
  const fileName = attachment.name ?? attachment.path.split(/[\\/]/).pop() ?? '远程图片'
  return (
    <button
      type="button"
      className="rc-attach-thumb"
      title="查看大图"
      aria-label={`查看大图：${fileName}`}
      onClick={() => onOpen(src, fileName)}
    >
      <img
        className="rc-attach-image"
        src={src}
        alt={fileName}
        // 缓存文件被清理或 safe-file 拒绝时退回占位，避免出现破图 + alt 文字溢出
        onError={() => setBroken(true)}
      />
    </button>
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
  const [lightbox, setLightbox] = useState<{ src: string; fileName: string } | null>(null)

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
              <RemoteImage
                deviceId={deviceId}
                attachment={attachment}
                onOpen={(src, name) => setLightbox({ src, fileName: name })}
              />
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
      {lightbox != null && (
        <ImagePreviewModal
          src={lightbox.src}
          alt={lightbox.fileName}
          fileName={lightbox.fileName}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
