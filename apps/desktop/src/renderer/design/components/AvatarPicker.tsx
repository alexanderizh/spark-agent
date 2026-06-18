import { useCallback, useMemo, useRef, useState } from 'react'
import { Modal, Slider } from 'antd'
import { Icons } from '../Icons'
import {
  createBuiltinAvatar,
  createDefaultAvatar,
  resolveAvatarSrc,
  type SparkAvatarConfig,
} from '../avatar'
import {
  BUILTIN_AVATARS,
  BUILTIN_AVATAR_LABELS,
  type BuiltinAvatarCategory,
} from '../builtinAvatars'
import { AvatarImage } from './AvatarImage'
import { useToast } from './Toast'

export interface AvatarPickerProps {
  value: SparkAvatarConfig
  defaultSeed: string
  title: string
  description?: string
  defaultAvatarId?: string
  showDefaultAction?: boolean
  onChange: (value: SparkAvatarConfig) => void
  /** 点击预览就触发文件选择（用于紧凑型头像编辑器：把"上传"按钮也藏起来时） */
  uploadOnPreviewClick?: boolean
}

type CropState = {
  src: string
  zoom: number
  offsetX: number
  offsetY: number
  imgW: number
  imgH: number
}

const OUTPUT_SIZE = 256
const STAGE_SIZE = 280
const AVATAR_CATEGORIES: BuiltinAvatarCategory[] = ['default', 'animal', 'person', 'guofeng']

export function AvatarPicker({
  value,
  defaultSeed,
  title,
  description,
  defaultAvatarId,
  showDefaultAction = true,
  onChange,
  uploadOnPreviewClick,
}: AvatarPickerProps) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [crop, setCrop] = useState<CropState | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const src = useMemo(() => resolveAvatarSrc(value), [value])
  const groupedAvatars = useMemo(
    () =>
      AVATAR_CATEGORIES.map((category) => ({
        category,
        avatars: BUILTIN_AVATARS.filter((avatar) => avatar.category === category),
      })).filter((group) => group.avatars.length > 0),
    [],
  )

  const resetToDefault = useCallback(() => {
    onChange(
      defaultAvatarId != null
        ? createBuiltinAvatar(defaultAvatarId)
        : createDefaultAvatar(defaultSeed),
    )
  }, [defaultAvatarId, defaultSeed, onChange])

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (file == null) return
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件')
        return
      }
      // 16MB 兜底，避免超大图片撑爆 IPC payload
      if (file.size > 16 * 1024 * 1024) {
        toast.error('图片过大，请选小于 16MB 的图')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string') return
        const tmp = new Image()
        tmp.onload = () => {
          const scale = Math.max(STAGE_SIZE / tmp.naturalWidth, STAGE_SIZE / tmp.naturalHeight)
          setCrop({
            src: reader.result as string,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            imgW: tmp.naturalWidth * scale,
            imgH: tmp.naturalHeight * scale,
          })
        }
        tmp.onerror = () => toast.error('图片解码失败，请换一张')
        tmp.src = reader.result as string
      }
      reader.onerror = () => toast.error('图片读取失败：' + (reader.error?.message ?? '未知错误'))
      reader.readAsDataURL(file)
    },
    [toast],
  )

  const openPicker = useCallback(() => {
    // 部分环境下 hidden input click() 不开选择框，先 reset value 再触发
    if (fileRef.current != null) {
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file != null) handleFile(file)
    },
    [handleFile],
  )

  const applyCrop = useCallback(() => {
    if (crop == null) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (ctx == null) return

    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      const baseScale = Math.max(OUTPUT_SIZE / img.naturalWidth, OUTPUT_SIZE / img.naturalHeight)
      const totalScale = baseScale * crop.zoom
      const w = img.naturalWidth * totalScale
      const h = img.naturalHeight * totalScale
      const cx = OUTPUT_SIZE / 2 + crop.offsetX * (OUTPUT_SIZE / STAGE_SIZE)
      const cy = OUTPUT_SIZE / 2 + crop.offsetY * (OUTPUT_SIZE / STAGE_SIZE)
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
      onChange({ kind: 'upload', dataUrl: canvas.toDataURL('image/png') })
      setCrop(null)
    }
    img.src = crop.src
  }, [crop, onChange])

  return (
    <div
      className="avatar-picker"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      title="可点击上传，也可直接拖入图片"
    >
      <div
        className="avatar-picker-preview"
        onClick={uploadOnPreviewClick ? openPicker : undefined}
        style={uploadOnPreviewClick ? { cursor: 'pointer' } : undefined}
      >
        <AvatarImage src={src} seed={defaultSeed} name={title} alt={title} />
      </div>
      <div className="avatar-picker-main">
        <div className="avatar-picker-title">{title}</div>
        {description != null && <div className="avatar-picker-desc">{description}</div>}
        <div className="avatar-picker-actions">
          <button type="button" className="btn ghost sm" onClick={() => setLibraryOpen(true)}>
            <Icons.Sparkles size={12} /> 内置头像
          </button>
          <button type="button" className="btn ghost sm" onClick={openPicker}>
            <Icons.Upload size={12} /> 上传
          </button>
          {showDefaultAction && (
            <button type="button" className="btn ghost sm" onClick={resetToDefault}>
              <Icons.Refresh size={12} /> 默认头像
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="avatar-picker-file"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          border: 0,
          opacity: 0,
        }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // 异步清空，避免某些环境下重挂载导致 file 引用丢失
          window.setTimeout(() => {
            if (fileRef.current != null) fileRef.current.value = ''
          }, 0)
          handleFile(file)
        }}
      />

      <Modal
        open={crop != null}
        title="裁剪头像"
        okText="使用头像"
        cancelText="取消"
        onOk={applyCrop}
        onCancel={() => setCrop(null)}
        className="avatar-crop-modal"
        maskClosable={false}
        destroyOnHidden
      >
        {crop != null && <DragCropper crop={crop} onChange={setCrop} />}
      </Modal>

      <Modal
        open={libraryOpen}
        title="选择内置头像"
        footer={null}
        onCancel={() => setLibraryOpen(false)}
        className="avatar-library-modal"
        width={720}
        destroyOnHidden
      >
        <div className="avatar-library">
          {groupedAvatars.map((group) => (
            <section key={group.category} className="avatar-library-section">
              <div className="avatar-library-title">{BUILTIN_AVATAR_LABELS[group.category]}</div>
              <div className="avatar-library-grid">
                {group.avatars.map((avatar) => (
                  <button
                    key={avatar.id}
                    type="button"
                    className="avatar-library-item"
                    title={avatar.label}
                    onClick={() => {
                      onChange(createBuiltinAvatar(avatar.id))
                      setLibraryOpen(false)
                    }}
                  >
                    <img src={avatar.src} alt={avatar.label} draggable={false} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Modal>
    </div>
  )
}

/* ── Drag-to-move cropper ── */

function DragCropper({ crop, onChange }: { crop: CropState; onChange: (c: CropState) => void }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const start = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      start.current = { x: e.clientX, y: e.clientY, ox: crop.offsetX, oy: crop.offsetY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [crop.offsetX, crop.offsetY],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      const zoomedW = crop.imgW * crop.zoom
      const zoomedH = crop.imgH * crop.zoom
      const maxOX = Math.max(0, (zoomedW - STAGE_SIZE) / 2)
      const maxOY = Math.max(0, (zoomedH - STAGE_SIZE) / 2)
      onChange({
        ...crop,
        offsetX: Math.max(-maxOX, Math.min(maxOX, start.current.ox + dx)),
        offsetY: Math.max(-maxOY, Math.min(maxOY, start.current.oy + dy)),
      })
    },
    [crop, onChange],
  )

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  // Clamp offset when zoom changes
  const handleZoom = useCallback(
    (val: number | number[]) => {
      const zoom = Number(Array.isArray(val) ? val[0] : val)
      const zoomedW = crop.imgW * zoom
      const zoomedH = crop.imgH * zoom
      const maxOX = Math.max(0, (zoomedW - STAGE_SIZE) / 2)
      const maxOY = Math.max(0, (zoomedH - STAGE_SIZE) / 2)
      onChange({
        ...crop,
        zoom,
        offsetX: Math.max(-maxOX, Math.min(maxOX, crop.offsetX)),
        offsetY: Math.max(-maxOY, Math.min(maxOY, crop.offsetY)),
      })
    },
    [crop, onChange],
  )

  const zoomedW = crop.imgW * crop.zoom
  const zoomedH = crop.imgH * crop.zoom

  return (
    <div className="avatar-cropper-v2">
      <div
        ref={stageRef}
        className="avatar-crop-stage-v2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={crop.src}
          alt="crop"
          draggable={false}
          style={{
            width: zoomedW,
            height: zoomedH,
            transform: `translate(${(STAGE_SIZE - zoomedW) / 2 + crop.offsetX}px, ${(STAGE_SIZE - zoomedH) / 2 + crop.offsetY}px)`,
          }}
        />
        {/* Circular mask overlay */}
        <div className="avatar-crop-circle-mask" />
        <div className="avatar-crop-hint">拖拽移动图片</div>
      </div>
      <div className="avatar-crop-controls-v2">
        <label>
          <span>缩放</span>
          <Slider min={1} max={3} step={0.05} value={crop.zoom} onChange={handleZoom} />
        </label>
      </div>
    </div>
  )
}
