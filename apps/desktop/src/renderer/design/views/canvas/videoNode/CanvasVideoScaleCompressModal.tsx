/**
 * 画布视频节点 · 尺寸与压缩弹窗。
 *
 * 链路：右键菜单/顶部工具栏「尺寸与压缩」→ 本弹窗收集两个百分比 →
 * 父级经 canvasApi.materializeVideoScaleCompress 调 IPC（ffmpeg 缩放+转码）→
 * 物化为新 video 子节点并用 derived_from 连线，原节点保留。
 *
 * 弹窗职责：
 *   - ffmpeg 就绪检查（未装时就地给安装按钮，装完继续）
 *   - 打开时 probe 源视频，展示原始分辨率/大小与预估输出
 *   - 尺寸（10%~200%，100% 不改尺寸）与压缩（10%~90%）双滑杆
 *   - 处理中显示进度条；失败 toast 后回到可编辑态
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, InputNumber, Modal, Progress, Slider, message } from 'antd'
import { Icons } from '../../../Icons'
import {
  readCanvasScaleCompressPreferences,
  writeCanvasScaleCompressPreferences,
} from '../canvasScaleCompressPreferences'
import './CanvasVideoScaleCompressModal.less'

export type CanvasVideoScaleCompressSource = {
  /** 承载源视频的节点 id（已把操作节点解析为产物资源节点） */
  nodeId: string
  /**
   * 真实落库的锚点节点 id。nodeId 可能是 `operation-output:` 虚拟视图 id
   * （任务节点未展开产物时），物化副本节点/连线必须挂在真实节点上。
   */
  anchorNodeId?: string
  /** 源视频磁盘绝对路径（safe-file 已解码）；远端 URL 场景不会进入本弹窗 */
  filePath: string
  /** 源文件名（用于生成产物节点标题） */
  fileName: string
  mimeType?: string | null
}

export type VideoScaleCompressProgress = { percent: number; stage: string }

export type VideoScaleCompressConfirmInput = {
  scalePercent: number
  compressPercent: number
  onProgress: (progress: VideoScaleCompressProgress) => void
}

type ProbeInfoLite = {
  width: number
  height: number
  durationSec: number
  bitrate: number
  hasAudio: boolean
  fileSize: number
}

const SCALE_MIN_PERCENT = 10
const SCALE_MAX_PERCENT = 200
const COMPRESS_MIN_PERCENT = 10
const COMPRESS_MAX_PERCENT = 90

function formatBytes(bytes: number | null | undefined): string {
  const size = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (size === 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 预估展示用：模拟主进程的偶数取整规则 */
function previewEven(value: number): number {
  const rounded = Math.max(2, Math.round(Number.isFinite(value) ? value : 0))
  return rounded % 2 === 0 ? rounded : rounded + 1
}

export function CanvasVideoScaleCompressModal({
  open,
  source,
  onClose,
  onConfirm,
}: {
  open: boolean
  source: CanvasVideoScaleCompressSource | null
  onClose: () => void
  /** 由父级调用 materialize API；抛错由弹窗捕获并回到可编辑态 */
  onConfirm: (input: VideoScaleCompressConfirmInput) => Promise<void>
}) {
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null)
  const [ffmpegInstalling, setFfmpegInstalling] = useState(false)
  const [ffmpegInstallPercent, setFfmpegInstallPercent] = useState<number | null>(null)

  const [probing, setProbing] = useState(false)
  const [probeFailed, setProbeFailed] = useState(false)
  const [probeInfo, setProbeInfo] = useState<ProbeInfoLite | null>(null)

  // 弹窗每次打开都会重新挂载（destroyOnHidden），初始值取上次记忆的参数（无记录时回退 100% / 50%）
  const [scalePercent, setScalePercent] = useState(
    () => readCanvasScaleCompressPreferences('video').scalePercent,
  )
  const [compressPercent, setCompressPercent] = useState(
    () => readCanvasScaleCompressPreferences('video').compressPercent,
  )
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<VideoScaleCompressProgress | null>(null)

  const probingRef = useRef(false)

  // ── ffmpeg 就绪检查 + 安装进度订阅 ────────────────────────────────
  useEffect(() => {
    if (!open) return
    void window.spark
      .invoke('ffmpeg:status', {})
      .then((s: { ffmpegReady: boolean }) => setFfmpegReady(s.ffmpegReady))
      .catch(() => setFfmpegReady(false))
    const unsubInstall = window.spark.on(
      'stream:ffmpeg:install-progress',
      (next: { state: string; percent: number | null }) => {
        setFfmpegInstallPercent(next.percent ?? null)
        setFfmpegInstalling(next.state !== 'done' && next.state !== 'error')
        if (next.state === 'done') {
          setFfmpegReady(true)
          setFfmpegInstallPercent(null)
        }
      },
    )
    const unsubStatus = window.spark.on('stream:ffmpeg:status', (next: { ffmpegReady: boolean }) =>
      setFfmpegReady(next.ffmpegReady),
    )
    return () => {
      unsubInstall?.()
      unsubStatus?.()
    }
  }, [open])

  const installFfmpeg = useCallback(async () => {
    setFfmpegInstalling(true)
    try {
      const result = await window.spark.invoke('ffmpeg:install', {})
      if (!result.success) message.error(result.message ?? 'FFmpeg 安装失败')
    } catch (error) {
      message.error(`FFmpeg 安装失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setFfmpegInstalling(false)
    }
  }, [])

  // ── 打开时重置并 probe ────────────────────────────────────────────
  useEffect(() => {
    if (!open || !source) return
    setBusy(false)
    setProgress(null)
    setProbeFailed(false)
    setProbeInfo(null)
    if (probingRef.current) return
    probingRef.current = true
    setProbing(true)
    void window.spark
      .invoke('video:probe', {
        operation: 'probe',
        input: source.filePath,
        params: {},
        requestId: `video_scale_compress_probe_${source.nodeId}_${Date.now()}`,
      })
      .then((res) => {
        const info = res?.success ? (res.result as ProbeInfoLite | undefined) : undefined
        if (
          info &&
          Number.isFinite(info.width) &&
          info.width > 0 &&
          Number.isFinite(info.height) &&
          info.height > 0
        ) {
          setProbeInfo(info)
        } else {
          console.warn('[video-scale-compress] probe failed:', res?.error)
          setProbeFailed(true)
        }
      })
      .catch((err) => {
        console.warn('[video-scale-compress] probe error:', err)
        setProbeFailed(true)
      })
      .finally(() => {
        setProbing(false)
        probingRef.current = false
      })
  }, [open, source])

  const outputSize = useMemo(() => {
    if (!probeInfo) return null
    return {
      width: previewEven((probeInfo.width * scalePercent) / 100),
      height: previewEven((probeInfo.height * scalePercent) / 100),
    }
  }, [probeInfo, scalePercent])

  // 压缩百分比即目标体积比例，仅作估算（CRF 回退或下限钳制时可能偏离）
  const estimatedSizeText = useMemo(() => {
    if (!probeInfo?.fileSize) return null
    return `≈ ${formatBytes((probeInfo.fileSize * compressPercent) / 100)}`
  }, [probeInfo, compressPercent])

  const canRun =
    Boolean(source) &&
    !busy &&
    !probing &&
    !probeFailed &&
    ffmpegReady === true &&
    scalePercent >= SCALE_MIN_PERCENT &&
    scalePercent <= SCALE_MAX_PERCENT &&
    compressPercent >= COMPRESS_MIN_PERCENT &&
    compressPercent <= COMPRESS_MAX_PERCENT

  // 调整参数即写回偏好，下次打开直接沿用上次的选择
  const updateScalePercent = useCallback(
    (value: number | null) => {
      const next = typeof value === 'number' && Number.isFinite(value) ? value : 100
      setScalePercent(next)
      writeCanvasScaleCompressPreferences('video', { scalePercent: next, compressPercent })
    },
    [compressPercent],
  )

  const updateCompressPercent = useCallback(
    (value: number | null) => {
      const next = typeof value === 'number' && Number.isFinite(value) ? value : 50
      setCompressPercent(next)
      writeCanvasScaleCompressPreferences('video', { scalePercent, compressPercent: next })
    },
    [scalePercent],
  )

  const handleRun = useCallback(async () => {
    if (busy || !source) return
    setBusy(true)
    setProgress({ percent: 0, stage: '准备处理' })
    try {
      await onConfirm({
        scalePercent,
        compressPercent,
        onProgress: (p) => setProgress(p),
      })
      onClose()
    } catch (error) {
      message.error(`视频尺寸压缩失败: ${error instanceof Error ? error.message : String(error)}`)
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [busy, compressPercent, onClose, onConfirm, scalePercent, source])

  // 处理中锁住关闭行为（X、ESC、遮罩一律无效）
  const requestClose = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])

  return (
    <Modal
      title={
        <span className="canvas-video-sc-modal-title">
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
      wrapClassName="canvas-video-sc-modal"
    >
      {/* ffmpeg 未就绪：就地安装引导，装完自动恢复表单 */}
      {ffmpegReady === false ? (
        <div className="video-sc-install">
          <p className="video-sc-install-tip">视频处理依赖 FFmpeg，当前设备尚未安装。</p>
          {ffmpegInstalling ? (
            <div className="video-sc-install-progress">
              <Progress percent={ffmpegInstallPercent ?? 0} size="small" status="active" />
            </div>
          ) : (
            <Button type="primary" onClick={() => void installFfmpeg()}>
              安装 FFmpeg
            </Button>
          )}
        </div>
      ) : (
        <div className="video-sc-body">
          <div className="video-sc-source">
            <span className="video-sc-source-name" title={source?.fileName ?? ''}>
              {source?.fileName ?? '—'}
            </span>
            {probeInfo ? (
              <span className="video-sc-source-meta">
                {formatBytes(probeInfo.fileSize)}
                {' · '}
                {probeInfo.width}×{probeInfo.height}
                {!probeInfo.hasAudio ? ' · 无音轨' : ''}
              </span>
            ) : (
              <span className="video-sc-source-meta">
                {probing ? '读取视频信息…' : probeFailed ? '读取视频信息失败' : ''}
              </span>
            )}
          </div>

          <div className="video-sc-field">
            <div className="video-sc-field-head">
              <label>视频尺寸</label>
              <span className="video-sc-field-value">{scalePercent}%</span>
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
            <div className="video-sc-field-inputs">
              <InputNumber
                min={SCALE_MIN_PERCENT}
                max={SCALE_MAX_PERCENT}
                step={5}
                value={scalePercent}
                onChange={updateScalePercent}
                disabled={busy || probing}
                addonAfter="%"
              />
              <span className="video-sc-hint">
                {outputSize && probeInfo ? (
                  <>
                    输出 {outputSize.width}×{outputSize.height}
                  </>
                ) : (
                  '等比缩放，宽高取偶数'
                )}
              </span>
            </div>
          </div>

          <div className="video-sc-field">
            <div className="video-sc-field-head">
              <label>压缩到原大小</label>
              <span className="video-sc-field-value">{compressPercent}%</span>
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
            <div className="video-sc-field-inputs">
              <InputNumber
                min={COMPRESS_MIN_PERCENT}
                max={COMPRESS_MAX_PERCENT}
                step={5}
                value={compressPercent}
                onChange={updateCompressPercent}
                disabled={busy || probing}
                addonAfter="%"
              />
              <span className="video-sc-hint">
                {estimatedSizeText ? <>预计输出 {estimatedSizeText}</> : '按码率比例压缩'}
              </span>
            </div>
          </div>

          {busy && progress ? (
            <div className="video-sc-progress">
              <Progress percent={Math.round(progress.percent)} status="active" size="small" />
              <span className="video-sc-progress-stage">{progress.stage || '转码中'}</span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
