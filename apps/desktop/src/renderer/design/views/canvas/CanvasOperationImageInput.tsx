import { useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'
import './CanvasOperationImageInput.less'

export function CanvasOperationImageInput({
  node,
  disabled = false,
  onPick,
  onUpload,
  onClear,
}: {
  node?: CanvasNode | null
  disabled?: boolean
  onPick?: () => void
  onUpload?: (file: File) => Promise<void> | void
  onClear?: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const previewUrl = node?.data.thumbnailUrl ?? node?.data.url ?? null

  return (
    <section className="canvas-operation-image-input" aria-label="图片输入">
      <div className={`canvas-operation-image-input-preview${node ? ' has-image' : ''}`}>
        {node ? (
          <>
            {previewUrl ? <img src={previewUrl} alt="输入图片预览" /> : <Icons.Image size={28} />}
            <div className="canvas-operation-image-input-meta">
              <strong>{node.title || '输入图片'}</strong>
              <span>将从这张图片反推生成提示词</span>
            </div>
            {onClear ? (
              <Button
                size="small"
                type="text"
                aria-label="移除输入图片"
                icon={<Icons.X size={13} />}
                disabled={disabled || uploading}
                onClick={onClear}
              />
            ) : null}
          </>
        ) : (
          <>
            <span className="canvas-operation-image-input-empty-icon">
              <Icons.Image size={28} />
            </span>
            <div className="canvas-operation-image-input-meta">
              <strong>连接或上传一张图片</strong>
              <span>反推指令已内置，无需填写提示词</span>
            </div>
          </>
        )}
      </div>
      <div className="canvas-operation-image-input-actions">
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
              {uploading ? '上传中' : node ? '替换图片' : '上传图片'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="上传一张输入图片"
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
