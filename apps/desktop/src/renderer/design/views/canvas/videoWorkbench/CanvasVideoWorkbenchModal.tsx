/**
 * CanvasVideoWorkbenchModal — 画布视频处理工作台（全屏 Modal）。
 *
 * 布局：左侧视频预览 + 时间线，右侧关键帧面板 + 提取控制。
 *
 * 数据流：
 *   - 从 node.data.videoWorkbench 读取持久化状态（probeInfo / keyframes / config）
 *   - 用户操作时本地 draft 更新，关键变更通过 onSave 回写画布节点
 *   - ffmpeg 操作走 IPC（video:probe / video:process），进度订阅 stream:video:process-progress
 *
 * 挂载范式参考 stage3d/CanvasDirectorStage3DModal（自定义 overlay + open 控制）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Segmented, Slider, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { encodeToSafeFileUrl } from '../canvas-safe-file'
import type { VideoProcessRequest } from '@spark/protocol'
import { Icons } from '../../../Icons'
import type { CanvasNode } from '../canvas.types'
import {
  createDefaultVideoWorkbenchData,
  formatTimestamp,
  readVideoWorkbenchData,
  type KeyframeStrategy,
  type VideoProbeInfo,
  type VideoWorkbenchData,
  type WorkbenchKeyframe,
  type WorkbenchOutput,
} from './videoWorkbench.types'
import { VideoWorkbenchFramePanel } from './VideoWorkbenchFramePanel'
import { VideoWorkbenchEditPanel } from './VideoWorkbenchEditPanel'
import './videoWorkbench.less'

/** macOS 无边框窗口红绿灯安全区 */
const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

/** 生成短 uuid（requestId 用） */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface Props {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (data: VideoWorkbenchData) => Promise<void>
  /** 把关键帧导出为画布图片节点 */
  onExportKeyframes?: (frames: WorkbenchKeyframe[], sourceNodeId: string) => Promise<void>
}

export function CanvasVideoWorkbenchModal({
  node,
  open,
  onClose,
  onSave,
  onExportKeyframes,
}: Props): ReactElement | null {
  const initial = useMemo(
    () => (node?.data?.videoWorkbench
      ? readVideoWorkbenchData(node.data.videoWorkbench as Record<string, unknown>)
      : createDefaultVideoWorkbenchData()),
    [node?.id],
  )
  const [draft, setDraft] = useState<VideoWorkbenchData>(initial)
  const [activeTab, setActiveTab] = useState<'frames' | 'edit' | 'output'>(initial.activeTab)
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  /** 进度 0~100，null 表示无活动 */
  const [progress, setProgress] = useState<number | null>(null)
  const [progressStage, setProgressStage] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  /** probe in-flight 哨兵，防止自动 probe 重复触发 */
  const probingRef = useRef(false)
  /** 当前播放位置（秒），用于手动标记 */
  const [currentTime, setCurrentTime] = useState(0)

  const sourceVideoUrl = useMemo(() => {
    const raw = node?.data?.url as string | undefined
    return raw ? normalizeEduAssetUrl(raw) : ''
  }, [node?.data?.url])

  const probe = draft.probeInfo

  // ── 检测 ffmpeg 可用性 ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    void window.spark
      .invoke('ffmpeg:status', {})
      .then((s: { ffmpegReady: boolean }) => setFfmpegReady(s.ffmpegReady))
      .catch(() => setFfmpegReady(false))
  }, [open])

  // ── 订阅进度推送 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const unsub = window.spark?.on(
      'stream:video:process-progress',
      (p: { requestId: string; percent: number; stage: string }) => {
        setProgress(p.percent)
        setProgressStage(p.stage)
      },
    )
    return () => {
      unsub?.()
    }
  }, [open])

  // ── 首次打开自动 probe（若 probeInfo 缺失且 ffmpeg 可用）─────────
  useEffect(() => {
    if (!open || !node || draft.probeInfo || ffmpegReady !== true || probingRef.current) return
    void probeAndUpdate(node)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, node, ffmpegReady])

  const probeAndUpdate = useCallback(
    async (n: CanvasNode) => {
      if (probingRef.current) return
      probingRef.current = true
      setBusy(true)
      setProgress(null)
      try {
        const reqId = shortId()
        const res = await window.spark.invoke('video:probe', {
          operation: 'probe',
          input: (n.data as { url?: string }).url ?? '',
          params: {},
          requestId: reqId,
        })
        if (res.success && res.result) {
          const probeInfo = res.result as VideoProbeInfo
          setDraft((d) => {
            const next = { ...d, probeInfo }
            void onSave(next)
            return next
          })
        }
      } catch (err) {
        message.error(`视频探测失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(false)
        probingRef.current = false
      }
    },
    [onSave],
  )

  // ── 自动提取关键帧（首次打开 + keyframes 为空）──────────────────
  const extractKeyframes = useCallback(
    async (strategy: KeyframeStrategy) => {
      if (!node || !probe) return
      setBusy(true)
      setProgress(0)
      setProgressStage('准备提取关键帧')
      try {
        const reqId = shortId()
        const res = await window.spark.invoke('video:process', {
          operation: 'extractKeyframes',
          input: (node.data as { url?: string }).url ?? '',
          params: {
            strategy,
            threshold: draft.extractConfig.threshold,
            intervalSec: draft.extractConfig.intervalSec,
            maxFrames: draft.extractConfig.maxFrames,
          },
          requestId: reqId,
        })
        if (res.success && res.result) {
          const result = res.result as { frames: Array<{ path: string; timestampSec: number; index: number }> }
          const frames: WorkbenchKeyframe[] = result.frames.map((f) => ({
            path: f.path,
            previewUrl: encodeToSafeFileUrl(f.path),
            timestampSec: f.timestampSec,
            index: f.index,
          }))
          const next = { ...draft, keyframes: frames }
          setDraft(next)
          void onSave(next)
          message.success(`提取了 ${frames.length} 个关键帧`)
        } else {
          message.error(res.error ?? '关键帧提取失败')
        }
      } catch (err) {
        message.error(`关键帧提取失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [node, probe, draft, onSave],
  )

  // 手动标记时间点
  const addManualMark = useCallback(() => {
    const t = Math.round(currentTime * 10) / 10
    setDraft((d) => {
      if (d.manualMarks.includes(t)) return d
      const marks = [...d.manualMarks, t].sort((a, b) => a - b)
      const next = { ...d, manualMarks: marks }
      void onSave(next)
      return next
    })
  }, [currentTime, onSave])

  const removeManualMark = useCallback(
    (t: number) => {
      setDraft((d) => {
        const next = { ...d, manualMarks: d.manualMarks.filter((x) => x !== t) }
        void onSave(next)
        return next
      })
    },
    [onSave],
  )

  // 批量提取手动标记点
  const extractManualMarks = useCallback(async () => {
    if (!node || draft.manualMarks.length === 0) return
    setBusy(true)
    setProgress(0)
    try {
      const reqId = shortId()
      const res = await window.spark.invoke('video:process', {
        operation: 'extractFramesAtTimes',
        input: (node.data as { url?: string }).url ?? '',
        params: { timesSec: draft.manualMarks },
        requestId: reqId,
      })
      if (res.success && res.result) {
        const result = res.result as Array<{ path: string; timestampSec: number; index: number }>
        const frames: WorkbenchKeyframe[] = result.map((f) => ({
          path: f.path,
          previewUrl: encodeToSafeFileUrl(f.path),
          timestampSec: f.timestampSec,
          index: f.index,
        }))
        const next = { ...draft, keyframes: [...draft.keyframes, ...frames] }
        setDraft(next)
        void onSave(next)
        message.success(`提取了 ${frames.length} 个标记帧`)
      }
    } catch (err) {
      message.error(`提取失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [node, draft, onSave])

  // 跳转到指定时间点
  const seekTo = useCallback((sec: number) => {
    const v = videoRef.current
    if (v) {
      v.currentTime = sec
      setCurrentTime(sec)
    }
  }, [])

  const handleExportKeyframes = useCallback(async () => {
    if (!node || !onExportKeyframes || draft.keyframes.length === 0) return
    setBusy(true)
    try {
      await onExportKeyframes(draft.keyframes, node.id)
    } finally {
      setBusy(false)
    }
  }, [node, onExportKeyframes, draft.keyframes])

  // ── 通用视频处理（剪辑/转码/分割等），产物记录到 draft.outputs ──
  const handleProcess = useCallback(
    async (
      operation: string,
      params: Record<string, unknown>,
    ): Promise<{ success: boolean; result?: unknown; error?: string }> => {
      if (!node) return { success: false, error: '未关联视频节点' }
      const sourcePath = (node.data as { url?: string }).url ?? ''
      if (!sourcePath) return { success: false, error: '源视频路径缺失' }
      setBusy(true)
      setProgress(null)
      try {
        const reqId = shortId()
        const res = await window.spark.invoke('video:process', {
          operation: operation as VideoProcessRequest['operation'],
          input: sourcePath,
          params,
          requestId: reqId,
        })
        return res as { success: boolean; result?: unknown; error?: string }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        setBusy(false)
      }
    },
    [node],
  )

  /** 产物生成后记录到 draft.outputs 并持久化 */
  const recordOutput = useCallback(
    (summary: string, outputPath: string, type: WorkbenchOutput['type']) => {
      setDraft((d) => {
        const outputs = [
          {
            id: shortId(),
            type,
            outputPath,
            outputUrl: encodeToSafeFileUrl(outputPath),
            createdAt: Date.now(),
            summary,
          },
          ...d.outputs,
        ].slice(0, 20) // 保留最近 20 条
        const next = { ...d, outputs, activeTab: 'output' as const }
        void onSave(next)
        return next
      })
    },
    [onSave],
  )

  // ── Esc 关闭 ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [onClose],
  )

  if (!open) return null

  const duration = probe?.durationSec ?? 0

  return (
    <div className="vwb-modal-overlay" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="vwb-shell">
        {/* ── 顶栏 ── */}
        <div className={`vwb-topbar${isPlatformDarwin ? ' darwin' : ''}`}>
          <div className="vwb-titlebox">
            <div className="vwb-kicker">Video Workbench</div>
            <div className="vwb-title">{node?.title ?? '视频工作台'}</div>
          </div>
          <div className="vwb-topbar-info">
            {probe && (
              <>
                <span className="vwb-info-chip">
                  {probe.width}×{probe.height}
                </span>
                <span className="vwb-info-chip">{formatTimestamp(duration)}</span>
                <span className="vwb-info-chip">{probe.fps}fps</span>
                <span className="vwb-info-chip">{probe.videoCodec}</span>
              </>
            )}
          </div>
          <div className="vwb-topbar-actions">
            <Button size="small" type="text" onClick={onClose} icon={<Icons.X size={16} />}>
              关闭
            </Button>
          </div>
        </div>

        {/* ── ffmpeg 未就绪提示 ── */}
        {ffmpegReady === false && (
          <div className="vwb-ffmpeg-warning">
            <Icons.AlertTriangle size={16} />
            <span>FFmpeg 未安装，关键帧提取等能力不可用。请在「设置 → 完整性」中下载。</span>
            <Button
              size="small"
              type="link"
              onClick={() => {
                onClose()
                message.info('请打开「设置 → 完整性」下载 FFmpeg')
              }}
            >
              去下载
            </Button>
          </div>
        )}

        {/* ── 主体 ── */}
        <div className="vwb-body">
          {/* 左侧：视频预览 + 时间线 */}
          <div className="vwb-preview-pane">
            <div className="vwb-video-stage">
              {sourceVideoUrl ? (
                <video
                  ref={videoRef}
                  src={sourceVideoUrl}
                  controls
                  preload="metadata"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  className="vwb-video"
                />
              ) : (
                <div className="vwb-video-empty">
                  <Icons.Film size={48} />
                  <span>未关联视频</span>
                </div>
              )}
            </div>

            {/* 时间线 / 手动标记区 */}
            <div className="vwb-timeline">
              <div className="vwb-timeline-head">
                <span className="vwb-timeline-time">{formatTimestamp(currentTime)}</span>
                <span className="vwb-timeline-divider">/</span>
                <span className="vwb-timeline-duration">{formatTimestamp(duration)}</span>
                <Button
                  size="small"
                  type="default"
                  onClick={addManualMark}
                  icon={<Icons.Pin size={12} />}
                  disabled={!sourceVideoUrl}
                >
                  标记当前帧
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={extractManualMarks}
                  loading={busy}
                  disabled={draft.manualMarks.length === 0}
                  icon={<Icons.Download size={12} />}
                >
                  提取标记 ({draft.manualMarks.length})
                </Button>
              </div>
              {duration > 0 && (
                <div className="vwb-timeline-track">
                  {/* 已播放 */}
                  <div
                    className="vwb-timeline-played"
                    style={{ width: `${(currentTime / duration) * 100}%` }}
                  />
                  {/* 关键帧标记点 */}
                  {draft.keyframes.map((kf) => (
                    <div
                      key={kf.index}
                      className="vwb-timeline-kf"
                      style={{ left: `${(kf.timestampSec / duration) * 100}%` }}
                      title={`${formatTimestamp(kf.timestampSec)}`}
                      onClick={() => seekTo(kf.timestampSec)}
                    />
                  ))}
                  {/* 手动标记点 */}
                  {draft.manualMarks.map((t) => (
                    <div
                      key={t}
                      className="vwb-timeline-mark"
                      style={{ left: `${(t / duration) * 100}%` }}
                      title={formatTimestamp(t)}
                      onClick={() => seekTo(t)}
                    >
                      <span className="vwb-timeline-mark-remove" onClick={(e) => { e.stopPropagation(); removeManualMark(t) }}>×</span>
                    </div>
                  ))}
                </div>
              )}
              {draft.manualMarks.length > 0 && (
                <div className="vwb-manual-marks">
                  {draft.manualMarks.map((t) => (
                    <span key={t} className="vwb-mark-chip" onClick={() => seekTo(t)}>
                      {formatTimestamp(t)}
                      <i onClick={(e) => { e.stopPropagation(); removeManualMark(t) }}>×</i>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右侧：Tab 面板 */}
          <div className="vwb-side-pane">
            <Segmented
              value={activeTab}
              onChange={(v) => setActiveTab(v as 'frames' | 'edit' | 'output')}
              options={[
                { label: '关键帧', value: 'frames' },
                { label: '剪辑', value: 'edit' },
                { label: '产物', value: 'output' },
              ]}
              block
              size="small"
            />

            {activeTab === 'frames' && (
              <VideoWorkbenchFramePanel
                draft={draft}
                busy={busy}
                progress={progress}
                progressStage={progressStage}
                ffmpegReady={ffmpegReady}
                onExtract={extractKeyframes}
                onConfigChange={(cfg) => {
                  const next = { ...draft, extractConfig: cfg }
                  setDraft(next)
                  void onSave(next)
                }}
                onSeek={seekTo}
                onExport={handleExportKeyframes}
                onRemoveKeyframe={(idx) => {
                  const next = { ...draft, keyframes: draft.keyframes.filter((k) => k.index !== idx) }
                  setDraft(next)
                  void onSave(next)
                }}
              />
            )}

            {activeTab === 'edit' && (
              <VideoWorkbenchEditPanel
                sourceVideoPath={sourceVideoUrl}
                probe={probe}
                busy={busy}
                progress={progress}
                currentTime={currentTime}
                onProcess={handleProcess}
                onOutput={recordOutput}
              />
            )}

            {activeTab === 'output' && (
              <div className="vwb-output-panel">
                {draft.outputs.length === 0 ? (
                  <div className="vwb-placeholder">
                    <Icons.Package size={28} />
                    <span>暂无产物</span>
                    <span className="muted">剪辑/转码/分割的产物会在这里展示</span>
                  </div>
                ) : (
                  <div className="vwb-output-list">
                    {draft.outputs.map((out) => (
                      <div key={out.id} className="vwb-output-item">
                        <div className="vwb-output-icon">
                          <Icons.Video size={16} />
                        </div>
                        <div className="vwb-output-info">
                          <div className="vwb-output-summary">{out.summary}</div>
                          <div className="vwb-output-time">
                            {new Date(out.createdAt).toLocaleTimeString()}
                          </div>
                        </div>
                        {out.outputUrl && (
                          <a
                            className="vwb-output-play"
                            href={out.outputUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Icons.Play size={14} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
