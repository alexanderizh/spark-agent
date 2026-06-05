import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Slider } from '@arco-design/web-react'
import { Icons } from '../Icons'
import { createDefaultAvatar, resolveAvatarSrc, type SparkAvatarConfig } from '../avatar'
import { AvatarImage } from './AvatarImage'

export interface AvatarPickerProps {
  value: SparkAvatarConfig
  defaultSeed: string
  title: string
  description?: string
  onChange: (value: SparkAvatarConfig) => void
}

type CropState = {
  src: string
  zoom: number
  x: number
  y: number
}

const OUTPUT_SIZE = 256

export function AvatarPicker({ value, defaultSeed, title, description, onChange }: AvatarPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<CropState | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const src = useMemo(() => resolveAvatarSrc(value), [value])

  useEffect(() => {
    setImageReady(false)
  }, [crop?.src])

  const handleFile = (file: File | undefined) => {
    if (file == null || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCrop({ src: reader.result, zoom: 1, x: 0, y: 0 })
      }
    }
    reader.readAsDataURL(file)
  }

  const applyCrop = () => {
    if (crop == null || imageRef.current == null) return
    const img = imageRef.current
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (ctx == null) return

    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    const scale = Math.max(OUTPUT_SIZE / img.naturalWidth, OUTPUT_SIZE / img.naturalHeight) * crop.zoom
    const width = img.naturalWidth * scale
    const height = img.naturalHeight * scale
    const overflowX = Math.max(0, width - OUTPUT_SIZE)
    const overflowY = Math.max(0, height - OUTPUT_SIZE)
    const dx = (OUTPUT_SIZE - width) / 2 - (crop.x / 100) * (overflowX / 2)
    const dy = (OUTPUT_SIZE - height) / 2 - (crop.y / 100) * (overflowY / 2)
    ctx.drawImage(img, dx, dy, width, height)
    onChange({ kind: 'upload', dataUrl: canvas.toDataURL('image/png') })
    setCrop(null)
  }

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-preview">
        <AvatarImage src={src} seed={defaultSeed} name={title} alt={title} />
      </div>
      <div className="avatar-picker-main">
        <div className="avatar-picker-title">{title}</div>
        {description != null && <div className="avatar-picker-desc">{description}</div>}
        <div className="avatar-picker-actions">
          <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()}>
            <Icons.Upload size={12} /> 上传
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => onChange(createDefaultAvatar(defaultSeed))}
          >
            <Icons.Refresh size={12} /> 默认头像
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="avatar-picker-file"
        onChange={(event) => {
          handleFile(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />

      <Modal
        visible={crop != null}
        title="裁剪头像"
        okText="使用头像"
        cancelText="取消"
        onOk={applyCrop}
        onCancel={() => setCrop(null)}
        okButtonProps={{ disabled: !imageReady }}
        className="avatar-crop-modal"
        maskClosable={false}
      >
        {crop != null && (
          <div className="avatar-cropper">
            <div className="avatar-crop-stage">
              <img
                ref={imageRef}
                src={crop.src}
                alt="待裁剪头像"
                draggable={false}
                onLoad={() => setImageReady(true)}
                style={{
                  transform: `translate(calc(-50% - ${crop.x}px), calc(-50% - ${crop.y}px)) scale(${crop.zoom})`,
                }}
              />
              <div className="avatar-crop-mask" />
            </div>
            <div className="avatar-crop-controls">
              <label>
                <span>缩放</span>
                <Slider min={1} max={3} step={0.05} value={crop.zoom} onChange={(v) => setCrop({ ...crop, zoom: Number(v) })} />
              </label>
              <label>
                <span>水平</span>
                <Slider min={-100} max={100} step={1} value={crop.x} onChange={(v) => setCrop({ ...crop, x: Number(v) })} />
              </label>
              <label>
                <span>垂直</span>
                <Slider min={-100} max={100} step={1} value={crop.y} onChange={(v) => setCrop({ ...crop, y: Number(v) })} />
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
