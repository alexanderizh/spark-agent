import { useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'
import './CanvasOperationMediaInput.less'

export function CanvasOperationMediaInput({
  node,
  mediaKind = 'image',
  disabled = false,
  onPick,
  onUpload,
  onClear,
}: {
  node?: CanvasNode | null
  mediaKind?: 'image' | 'video'
  disabled?: boolean
  onPick?: () => void
  onUpload?: (file: File) => Promise<void> | void
  onClear?: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const previewUrl = node?.data.thumbnailUrl ?? node?.data.url ?? null
  const isVideo = mediaKind === 'video'

  return (
    <section
      className="canvas-operation-media-input"
      aria-label={isVideo ? '视频输入' : '图片输入'}
    >
      <div className={`canvas-operation-media-input-preview${node ? ' has-media' : ''}`}>
        {node ? (
          <>
            {previewUrl ? (
              isVideo ? (
                <video src={previewUrl} aria-label="输入视频预览" muted />
              ) : (
                <img src={previewUrl} alt="输入图片预览" />
              )
            ) : isVideo ? (
              <Icons.Video size={28} />
            ) : (
              <Icons.Image size={28} />
            )}
            <div className="canvas-operation-media-input-meta">
              <strong>{node.title || (isVideo ? '输入视频' : '输入图片')}</strong>
              <span>{isVideo ? '将转换这段视频的黑白深度信息' : '将从这张图片反推生成提示词'}</span>
            </div>
            {onClear ? (
              <Button
                size="small"
                type="text"
                aria-label={isVideo ? '移除输入视频' : '移除输入图片'}
                icon={<Icons.X size={13} />}
                disabled={disabled || uploading}
                onClick={onClear}
              />
            ) : null}
          </>
        ) : (
          <>
            <span className="canvas-operation-media-input-empty-icon">
              {isVideo ? <Icons.Video size={28} /> : <Icons.Image size={28} />}
            </span>
            <div className="canvas-operation-media-input-meta">
              <strong>{isVideo ? '连接或上传一段视频' : '连接或上传一张图片'}</strong>
              <span>
                {isVideo
                  ? '本地生成黑白深度视频转换结果，无需填写提示词'
                  : '反推指令已内置，无需填写提示词'}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="canvas-operation-media-input-actions">
        {onPick ? (
          <Button
            size="middle"
            type="default"
            icon={<Icons.MousePointer size={14} />}
            disabled={disabled || uploading}
            onClick={onPick}
          >
            从画布选择
          </Button>
        ) : null}
        {onUpload ? (
          <>
            <Button
              size="middle"
              type="default"
              icon={uploading ? <Icons.Spinner size={14} /> : <Icons.Upload size={14} />}
              disabled={disabled || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading
                ? '上传中'
                : node
                  ? isVideo
                    ? '替换视频'
                    : '替换图片'
                  : isVideo
                    ? '上传视频'
                    : '上传图片'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={isVideo ? 'video/*' : 'image/*'}
              aria-label={isVideo ? '上传一段输入视频' : '上传一张输入图片'}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setUploading(true)
                void Promise.resolve(onUpload(file)).finally(() => setUploading(false))
              }}
            />
          </>
        ) : null}
      </div>
    </section>
  )
}
