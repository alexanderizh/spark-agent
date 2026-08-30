/**
 * AvatarCropperModal — 头像裁剪模态（支持旋转 + 缩放）
 *
 * 基于 react-easy-crop：
 *  - 左右旋转按钮（每次 90°）→ 调整头像方向
 *  - 鼠标滚轮缩放（在裁剪舞台上滚动）+ 缩放滑条 + +/- 按钮
 *  - 拖拽定位
 * 裁剪输出：考虑 rotation 的 canvas 抠图，输出 ≤512×512 的 JPEG（q0.9）。
 *
 * 通过外层 key（基于文件指纹）重挂载内部组件来重置状态，
 * 避免在 effect 体内同步 setState。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button, Modal, Slider } from 'antd'
import Cropper, { type Point, type Area } from 'react-easy-crop'
import { Icons } from '../Icons'
import './AvatarCropperModal.less'

export interface AvatarCropperModalProps {
  open: boolean
  /** 待裁剪的图片（由调用方通过 <input type=file> 选择）*/
  file: File | null
  /** 裁剪确认：返回 JPEG Blob */
  onConfirm: (blob: Blob) => void | Promise<void>
  onCancel: () => void
}

const OUTPUT_SIZE = 512

export function AvatarCropperModal({
  open,
  file,
  onConfirm,
  onCancel,
}: AvatarCropperModalProps): React.ReactElement | null {
  // 未打开或无文件：不渲染（调用方通过 open 控制可见性）。
  // 通过 key 控制内部状态重置：切换文件时重新挂载内部组件，状态回到初始值。
  if (!open || !file) return null
  const resetKey = `${file.name}-${file.size}-${file.lastModified}`
  return <CropperInner key={resetKey} file={file} onConfirm={onConfirm} onCancel={onCancel} />
}

interface CropperInnerProps {
  file: File
  onConfirm: (blob: Blob) => void | Promise<void>
  onCancel: () => void
}

function CropperInner({ file, onConfirm, onCancel }: CropperInnerProps): React.ReactElement {
  const [imgSrc, setImgSrc] = useState('')
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void readFileAsDataUrl(file).then((dataUrl) => {
      if (!cancelled) setImgSrc(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [file])

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels)
  }, [])

  // ─── 滚轮缩放（在裁剪舞台上滚动即可放大/缩小）──────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // 阻止页面滚动，让滚轮只控制缩放
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.05 : 0.05
      setZoom((z) => clampZoom(z + delta * z))
    },
    [],
  )

  // ─── 旋转 ──────────────────────────────────────────────────────────────────
  const rotate = useCallback((deg: number) => {
    setRotation((r) => r + deg)
    // 旋转后重置定位，避免裁剪框跑出可视区
    setCrop({ x: 0, y: 0 })
  }, [])

  const handleConfirm = async (): Promise<void> => {
    if (!croppedAreaPixelsReady(croppedArea) || !imgSrc) return
    try {
      setSubmitting(true)
      const blob = await getCroppedImg(imgSrc, croppedArea as Area, rotation, OUTPUT_SIZE)
      if (blob) await onConfirm(blob)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="裁剪头像"
      open
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      width={460}
      className="avatar-cropper-modal"
    >
      <p className="avatar-cropper-hint">
        拖动定位，滚轮或滑条缩放，按钮旋转方向；头像将以圆形显示。
      </p>

      {/* 裁剪舞台：滚轮缩放事件挂在这里 */}
      <div
        ref={stageRef}
        className="avatar-cropper-stage"
        onWheel={handleWheel}
      >
        {imgSrc && (
          <Cropper
            image={imgSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            cropShape="round"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            restrictPosition={false}
          />
        )}
      </div>

      {/* 控制条：旋转 + 缩放 */}
      <div className="avatar-cropper-controls">
        <div className="avatar-cropper-rotate">
          <button
            type="button"
            className="avatar-cropper-icon-btn"
            onClick={() => rotate(-90)}
            title="向左旋转 90°"
          >
            <Icons.RotateCcw size={16} />
          </button>
          <button
            type="button"
            className="avatar-cropper-icon-btn"
            onClick={() => rotate(90)}
            title="向右旋转 90°"
          >
            <Icons.RotateCw size={16} />
          </button>
        </div>
        <div className="avatar-cropper-zoom">
          <button
            type="button"
            className="avatar-cropper-icon-btn"
            onClick={() => setZoom((z) => clampZoom(z - 0.1))}
            title="缩小"
          >
            <span className="avatar-cropper-minus-glyph" aria-hidden>−</span>
          </button>
          <Slider
            className="avatar-cropper-slider"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(v) => setZoom(clampZoom(v))}
            tooltip={{ formatter: (v) => `${Math.round((v ?? 1) * 100)}%` }}
          />
          <button
            type="button"
            className="avatar-cropper-icon-btn"
            onClick={() => setZoom((z) => clampZoom(z + 0.1))}
            title="放大"
          >
            <Icons.Plus size={14} />
          </button>
        </div>
      </div>

      <div className="avatar-cropper-actions">
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" loading={submitting} onClick={() => void handleConfirm()}>
          确认裁剪
        </Button>
      </div>
    </Modal>
  )
}

// 复制 croppedArea 到独立变量，便于在条件判断中收窄类型
function croppedAreaPixelsReady(a: Area | null): a is Area {
  return a != null && a.width > 0 && a.height > 0
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(reader.result?.toString() || '')
    reader.readAsDataURL(file)
  })
}

function clampZoom(z: number): number {
  if (Number.isNaN(z)) return 1
  return Math.min(3, Math.max(1, z))
}

/**
 * 按裁剪区域抠图，并把旋转一并烘焙到输出中。
 * 参考自 react-easy-crop 官方文档的 rotation 版 getCroppedImg。
 * 输出固定为 size×size（默认 512）的 JPEG。
 */
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  size: number,
): Promise<Blob | null> {
  const image = await createImage(imageSrc)
  if (!image.width || !image.height) return null

  const safeSize = Math.max(size, 1)
  const rotRad = getRadianAngle(rotation)

  // 1. 旋转后的包围盒画布——与 react-easy-crop 的 croppedAreaPixels 坐标系一致。
  //    react-easy-crop 在 rotation 下给出的 pixelCrop 是相对「旋转后包围盒」的坐标，
  //    因此先把原图旋转绘制到包围盒尺寸的画布上，再按 pixelCrop 抠图。
  const bBox = getBoundingBoxAfterRotation(image.width, image.height, rotRad)
  const rotCanvas = document.createElement('canvas')
  const rotCtx = rotCanvas.getContext('2d')
  if (!rotCtx) return null
  rotCanvas.width = Math.max(1, Math.round(bBox.width))
  rotCanvas.height = Math.max(1, Math.round(bBox.height))

  rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2)
  rotCtx.rotate(rotRad)
  rotCtx.translate(-image.width / 2, -image.height / 2)
  rotCtx.drawImage(image, 0, 0)

  // 2. 输出画布：固定 safeSize×safeSize。
  //    必须用 drawImage（9 参数版）从 rotCanvas 的 pixelCrop 区域缩放到目标尺寸——
  //    原实现用 getImageData + putImageData，而 putImageData 是 1:1 像素拷贝、不缩放，
  //    会把 pixelCrop.width×pixelCrop.height 的像素原样塞进 safeSize×safeSize 画布左上角，
  //    只拷出左上角一块、剩余区域透明 → JPEG 烘成黑色，导致「预览是整图、上传是局部特写」。
  //    先填白底：restrictPosition={false} 下越界的透明区域在 JPEG 里会变黑，白底可避免。
  const out = document.createElement('canvas')
  const outCtx = out.getContext('2d')
  if (!outCtx) return null
  out.width = safeSize
  out.height = safeSize
  outCtx.imageSmoothingQuality = 'high'
  outCtx.fillStyle = '#ffffff'
  outCtx.fillRect(0, 0, safeSize, safeSize)

  outCtx.drawImage(
    rotCanvas,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, safeSize, safeSize,
  )

  return new Promise<Blob | null>((resolve) => {
    out.toBlob(
      (blob) => resolve(blob),
      'image/jpeg',
      0.9,
    )
  })
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('图片加载失败')))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })
}

function getRadianAngle(degree: number): number {
  return (degree * Math.PI) / 180
}

/** 旋转后的画布包围盒尺寸（保证图片内容不被裁掉）*/
function getBoundingBoxAfterRotation(width: number, height: number, rotation: number): {
  width: number
  height: number
} {
  return {
    width: Math.abs(width * Math.cos(rotation)) + Math.abs(height * Math.sin(rotation)),
    height: Math.abs(width * Math.sin(rotation)) + Math.abs(height * Math.cos(rotation)),
  }
}
