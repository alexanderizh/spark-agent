/**
 * 画布图片节点 · 尺寸与压缩弹窗。
 *
 * 打开时探测源图片，展示原始尺寸/体积和预计输出；确认后由父级物化为新的图片
 * 子节点，原节点保持不变。图片处理使用应用内已有 sharp，不依赖 FFmpeg。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, InputNumber, Modal, Progress, Slider, message } from 'antd'
import { Icons } from '../../../Icons'
import {
  readCanvasScaleCompressPreferences,
  writeCanvasScaleCompressPreferences,
} from '../canvasScaleCompressPreferences'
import './CanvasImageScaleCompressModal.less'

export type CanvasImageScaleCompressSource = {
  /** 承载源图片的节点 id；任务节点可能解析为 operation-output 虚拟节点。 */
  nodeId: string
  /** 真实落库的父节点 id，用于创建 generated 连线。 */
  anchorNodeId?: string
  filePath: string
  fileName: string
  mimeType?: string | null
}

export type ImageScaleCompressProgress = { percent: number; stage: string }

export type ImageScaleCompressConfirmInput = {
  scalePercent: number
  compressPercent: number
  onProgress: (progress: ImageScaleCompressProgress) => void
}

type ImageProbeInfoLite = {
  width: number
  height: number
  format: string
  fileSize: number
  hasAlpha: boolean
  pages: number
  animated: boolean
}

const SCALE_MIN_PERCENT = 10
const SCALE_MAX_PERCENT = 200
const COMPRESS_MIN_PERCENT = 10
const COMPRESS_MAX_PERCENT = 90
const MAX_IMAGE_DIMENSION = 16_384
const MAX_IMAGE_PIXELS = 100_000_000

function formatBytes(bytes: number | null | undefined): string {
  const size = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (size === 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 与主进程 computeScaledImageSize 保持一致，仅用于弹窗预览。 */
function previewScaledSize(width: number, height: number, scalePercent: number) {
  let ratio = scalePercent / 100
  const longest = Math.max(width, height) * ratio
  if (longest > MAX_IMAGE_DIMENSION) ratio *= MAX_IMAGE_DIMENSION / longest
  const scaledPixels = width * height * ratio * ratio
  if (scaledPixels > MAX_IMAGE_PIXELS) ratio *= Math.sqrt(MAX_IMAGE_PIXELS / scaledPixels)
  let outputWidth = Math.max(1, Math.round(width * ratio))
  let outputHeight = Math.max(1, Math.round(height * ratio))
  if (outputWidth * outputHeight > MAX_IMAGE_PIXELS) {
    const correction = Math.sqrt(MAX_IMAGE_PIXELS / (outputWidth * outputHeight))
    outputWidth = Math.max(1, Math.floor(outputWidth * correction))
    outputHeight = Math.max(1, Math.floor(outputHeight * correction))
  }
  return { width: outputWidth, height: outputHeight }
}

export function CanvasImageScaleCompressModal({
  open,
  source,
  onClose,
  onConfirm,
}: {
  open: boolean
  source: CanvasImageScaleCompressSource | null
  onClose: () => void
  onConfirm: (input: ImageScaleCompressConfirmInput) => Promise<void>
}) {
  const [probing, setProbing] = useState(Boolean(open && source))
  const [probeFailed, setProbeFailed] = useState(false)
  const [probeInfo, setProbeInfo] = useState<ImageProbeInfoLite | null>(null)
  // 弹窗每次打开都会重新挂载（destroyOnHidden），初始值取上次记忆的参数（无记录时回退 100% / 50%）
  const [scalePercent, setScalePercent] = useState(
    () => readCanvasScaleCompressPreferences('image').scalePercent,
  )
  const [compressPercent, setCompressPercent] = useState(
    () => readCanvasScaleCompressPreferences('image').compressPercent,
  )
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImageScaleCompressProgress | null>(null)

  useEffect(() => {
    if (!open || !source) return undefined
    let active = true
    void window.spark
      .invoke('image:probe', {
        operation: 'probe',
        input: source.filePath,
        params: {},
        requestId: `image_probe_${crypto.randomUUID()}`,
      })
      .then((response) => {
        if (!active) return
        const info = response.success
          ? (response.result as ImageProbeInfoLite | undefined)
          : undefined
        if (
          info &&
          Number.isFinite(info.width) &&
          info.width > 0 &&
          Number.isFinite(info.height) &&
          info.height > 0
        ) {
          setProbeInfo(info)
        } else {
          console.warn('[image-scale-compress] probe failed:', response.error)
          setProbeFailed(true)
        }
      })
      .catch((error) => {
        if (!active) return
        console.warn('[image-scale-compress] probe error:', error)
        setProbeFailed(true)
      })
      .finally(() => {
        if (active) setProbing(false)
      })
    return () => {
      active = false
    }
  }, [open, source])

  // 调整参数即写回偏好，下次打开直接沿用上次的选择
  const updateScalePercent = useCallback(
    (value: number | null) => {
      const next = typeof value === 'number' && Number.isFinite(value) ? value : 100
      setScalePercent(next)
      writeCanvasScaleCompressPreferences('image', { scalePercent: next, compressPercent })
    },
    [compressPercent],
  )

  const updateCompressPercent = useCallback(
    (value: number | null) => {
      const next = typeof value === 'number' && Number.isFinite(value) ? value : 50
      setCompressPercent(next)
      writeCanvasScaleCompressPreferences('image', { scalePercent, compressPercent: next })
    },
    [scalePercent],
  )

  const outputSize = useMemo(
    () => (probeInfo ? previewScaledSize(probeInfo.width, probeInfo.height, scalePercent) : null),
    [probeInfo, scalePercent],
  )
  const estimatedSizeText = probeInfo?.fileSize
    ? `≈ ${formatBytes((probeInfo.fileSize * compressPercent) / 100)}`
    : null
  const canRun =
    Boolean(source) &&
    Boolean(probeInfo) &&
    !busy &&
    !probing &&
    !probeFailed &&
    (probeInfo?.pages ?? 1) <= 1 &&
    scalePercent >= SCALE_MIN_PERCENT &&
    scalePercent <= SCALE_MAX_PERCENT &&
    compressPercent >= COMPRESS_MIN_PERCENT &&
    compressPercent <= COMPRESS_MAX_PERCENT

  const handleRun = useCallback(async () => {
    if (busy || !source) return
    setBusy(true)
    setProgress({ percent: 0, stage: '准备处理' })
    try {
      await onConfirm({
        scalePercent,
        compressPercent,
        onProgress: setProgress,
      })
      onClose()
    } catch (error) {
      message.error(`图片尺寸压缩失败: ${error instanceof Error ? error.message : String(error)}`)
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [busy, compressPercent, onClose, onConfirm, scalePercent, source])

  const requestClose = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])

  return (
    <Modal
      title={
        <span className="canvas-image-sc-modal-title">
          <Icons.Minimize size={15} /> 尺寸与压缩
        </span>
      }
      open={open}
      onCancel={requestClose}
      width={460}
      footer={
        busy
          ? null
          : [
              <Button key="cancel" onClick={requestClose}>
                取消
              </Button>,
              <Button key="run" type="primary" disabled={!canRun} onClick={() => void handleRun()}>
                生成压缩副本
              </Button>,
            ]
      }
      maskClosable={false}
      destroyOnHidden
      wrapClassName="canvas-image-sc-modal"
    >
      <div className="image-sc-body">
        <div className="image-sc-source">
          <span className="image-sc-source-name" title={source?.fileName ?? ''}>
            {source?.fileName ?? '—'}
          </span>
          {probeInfo ? (
            <span className={`image-sc-source-meta${probeInfo.pages > 1 ? ' is-warning' : ''}`}>
              {formatBytes(probeInfo.fileSize)} · {probeInfo.width}×{probeInfo.height}
              {probeInfo.format ? ` · ${probeInfo.format.toUpperCase()}` : ''}
              {probeInfo.pages > 1
                ? probeInfo.animated
                  ? ' · 暂不支持动图'
                  : ' · 暂不支持多页图片'
                : ''}
            </span>
          ) : (
            <span className="image-sc-source-meta">
              {probing ? '读取图片信息…' : probeFailed ? '读取图片信息失败' : ''}
            </span>
          )}
        </div>

        <div className="image-sc-field">
          <div className="image-sc-field-head">
            <label>图片尺寸</label>
            <span className="image-sc-field-value">{scalePercent}%</span>
          </div>
          <Slider
            min={SCALE_MIN_PERCENT}
            max={SCALE_MAX_PERCENT}
            step={1}
            marks={{ 10: '10%', 100: '100%', 200: '200%' }}
            value={scalePercent}
            onChange={updateScalePercent}
            disabled={busy || probing}
          />
          <div className="image-sc-field-inputs">
            <InputNumber
              min={SCALE_MIN_PERCENT}
              max={SCALE_MAX_PERCENT}
              step={5}
              value={scalePercent}
              onChange={updateScalePercent}
              disabled={busy || probing}
              addonAfter="%"
            />
            <span className="image-sc-hint">
              {outputSize ? `输出 ${outputSize.width}×${outputSize.height}` : '等比缩放'}
            </span>
          </div>
        </div>

        <div className="image-sc-field">
          <div className="image-sc-field-head">
            <label>压缩到原大小</label>
            <span className="image-sc-field-value">{compressPercent}%</span>
          </div>
          <Slider
            min={COMPRESS_MIN_PERCENT}
            max={COMPRESS_MAX_PERCENT}
            step={1}
            marks={{ 10: '10%', 50: '50%', 90: '90%' }}
            value={compressPercent}
            onChange={updateCompressPercent}
            disabled={busy || probing}
          />
          <div className="image-sc-field-inputs">
            <InputNumber
              min={COMPRESS_MIN_PERCENT}
              max={COMPRESS_MAX_PERCENT}
              step={5}
              value={compressPercent}
              onChange={updateCompressPercent}
              disabled={busy || probing}
              addonAfter="%"
            />
            <span className="image-sc-hint">
              {estimatedSizeText ? `预计输出 ${estimatedSizeText}` : '按目标体积压缩'}
            </span>
          </div>
        </div>

        {busy && progress ? (
          <div className="image-sc-progress">
            <Progress percent={Math.round(progress.percent)} status="active" size="small" />
            <span className="image-sc-progress-stage">{progress.stage || '处理中'}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
