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
import { Button, Dropdown, Segmented, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { encodeToSafeFileUrl } from '../canvas-safe-file'
import type { FfmpegInstallProgress, VideoProcessRequest } from '@spark/protocol'
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
import { VideoTimeline } from './VideoTimeline'
import {
  normalizeTimelineRange,
  splitTimelineRange,
  type TimelineRange,
} from './videoTimelineModel'
import './videoWorkbench.less'

/** macOS 无边框窗口红绿灯安全区 */
const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

/** 生成短 uuid（requestId 用） */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * 把 node.data.url（可能是 safe-file:// 编码 URL 或原始路径）解码为磁盘绝对路径。
 * ffmpeg 需要磁盘路径，不能接受 safe-file:// URL。
 * 解码逻辑与 CanvasWorkspaceView.decodeSafeFileUrl 一致。
 */
function resolveDiskPath(url: string): string {
  if (!url) return ''
  if (!url.startsWith('safe-file://')) return url
  try {
    const rest = url.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return url
    const encoded = rest.slice(slashIndex + 1)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    return decodeURIComponent(escape(atob(base64 + padding)))
  } catch {
    return url
  }
}

/** 画布上可选作源视频的节点（从画布选择用） */
interface CanvasVideoOption {
  id: string
  title: string
  url: string
  thumbnailUrl?: string
}

interface Props {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (data: VideoWorkbenchData) => Promise<void>
  /** 把关键帧导出为画布图片节点 */
  onExportKeyframes?: (frames: WorkbenchKeyframe[], sourceNodeId: string) => Promise<void>
  /** 添加/切换源视频（文件选择器 → 落盘 → 写回 node.data.url） */
  onAddVideo?: () => Promise<void>
  /** 从画布选择视频作为源（传入画布视频节点的 url） */
  onSelectVideo?: (url: string) => Promise<void>
  /** 画布上可用的视频节点列表（从画布选择用） */
  videoNodes?: CanvasVideoOption[]
}

export function CanvasVideoWorkbenchModal({
  node,
  open,
  onClose,
  onSave,
  onExportKeyframes,
  onAddVideo,
  onSelectVideo,
  videoNodes,
}: Props): ReactElement | null {
  const initial = node?.data?.videoWorkbench
    ? readVideoWorkbenchData(node.data.videoWorkbench as Record<string, unknown>)
    : createDefaultVideoWorkbenchData()
  const [draft, setDraft] = useState<VideoWorkbenchData>(initial)
  const [activeTab, setActiveTab] = useState<'frames' | 'edit' | 'output'>(initial.activeTab)
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null)
  const [ffmpegInstalling, setFfmpegInstalling] = useState(false)
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState<FfmpegInstallProgress | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  /** 进度 0~100，null 表示无活动 */
  const [progress, setProgress] = useState<number | null>(null)
  const [progressStage, setProgressStage] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  /** probe in-flight 哨兵，防止自动 probe 重复触发 */
  const probingRef = useRef(false)
  /** probe 失败标记（无 ffmpeg / 路径问题），用于区分「探测中」和「探测失败」 */
  const [probeFailed, setProbeFailed] = useState(false)
  /** 是否正在播放 */
  const [isPlaying, setIsPlaying] = useState(false)
  /** video 元素的 duration（probe 失败时兜底用） */
  const [videoMetaDuration, setVideoMetaDuration] = useState(0)
  /** 当前播放位置（秒），用于手动标记 */
  const [currentTime, setCurrentTime] = useState(0)
  /** 时间轴选区与源地址绑定，切换源视频后自然回到全长选区。 */
  const [timelineSelection, setTimelineSelection] = useState<{
    sourceUrl: string
    range: TimelineRange
  }>({ sourceUrl: '', range: { startSec: 0, endSec: 0 } })
  /** true=关键帧无损快切，false=重新编码精确切 */
  const [trimCopy, setTrimCopy] = useState(true)

  const sourceVideoUrl = useMemo(() => {
    const raw = node?.data?.url as string | undefined
    return raw ? normalizeEduAssetUrl(raw) : ''
  }, [node?.data?.url])

  const probe = draft.probeInfo
  const duration = probe?.durationSec ?? videoMetaDuration ?? 0
  const timelineRange = useMemo(
    () =>
      normalizeTimelineRange(
        timelineSelection.sourceUrl === sourceVideoUrl
          ? timelineSelection.range
          : { startSec: 0, endSec: 0 },
        duration,
      ),
    [duration, sourceVideoUrl, timelineSelection],
  )
  const handleTimelineRangeChange = useCallback(
    (range: TimelineRange) => setTimelineSelection({ sourceUrl: sourceVideoUrl, range }),
    [sourceVideoUrl],
  )

  // ── 检测 ffmpeg 可用性 ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    void window.spark
      .invoke('ffmpeg:status', {})
      .then((s: { ffmpegReady: boolean }) => setFfmpegReady(s.ffmpegReady))
      .catch(() => setFfmpegReady(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const unsubProgress = window.spark?.on(
      'stream:ffmpeg:install-progress',
      (next: FfmpegInstallProgress) => {
        setFfmpegInstallProgress(next)
        setFfmpegInstalling(next.state !== 'done' && next.state !== 'error')
        if (next.state === 'done') setFfmpegReady(true)
      },
    )
    const unsubStatus = window.spark?.on('stream:ffmpeg:status', (next: { ffmpegReady: boolean }) =>
      setFfmpegReady(next.ffmpegReady),
    )
    return () => {
      unsubProgress?.()
      unsubStatus?.()
    }
  }, [open])

  const installFfmpeg = useCallback(async () => {
    setFfmpegInstalling(true)
    setFfmpegInstallProgress(null)
    try {
      const result = await window.spark.invoke('ffmpeg:install', {})
      setFfmpegReady(result.success)
      if (result.success) message.success(result.message ?? 'FFmpeg 安装成功，视频能力已就绪')
      else message.error(result.message ?? 'FFmpeg 安装失败')
    } catch (error) {
      message.error(`FFmpeg 安装失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setFfmpegInstalling(false)
    }
  }, [])

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

  const probeAndUpdate = useCallback(
    async (n: CanvasNode) => {
      if (probingRef.current) return
      const sourcePath = resolveDiskPath((n.data as { url?: string }).url ?? '')
      if (!sourcePath) return // 未关联视频文件，跳过探测（预览区已展示"未关联视频"）
      probingRef.current = true
      setBusy(true)
      setProgress(null)
      setProbeFailed(false)
      try {
        const reqId = shortId()
        const res = await window.spark.invoke('video:probe', {
          operation: 'probe',
          input: sourcePath,
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
        } else {
          // probe 返回失败（路径校验/ffmpeg 执行错误）—— 不阻塞，用 video 元素信息降级
          console.warn('[video-workbench] probe failed:', res.error)
          setProbeFailed(true)
        }
      } catch (err) {
        console.warn('[video-workbench] probe error:', err)
        setProbeFailed(true)
      } finally {
        setBusy(false)
        probingRef.current = false
      }
    },
    [onSave],
  )

  // ── 首次打开自动 probe（若 probeInfo 缺失且 ffmpeg 可用）─────────
  useEffect(() => {
    const sourceUrl = (node?.data as { url?: string } | undefined)?.url ?? ''
    if (
      !open ||
      !node ||
      !sourceUrl ||
      draft.probeInfo ||
      ffmpegReady !== true ||
      probingRef.current
    )
      return
    void probeAndUpdate(node)
  }, [draft.probeInfo, ffmpegReady, node, open, probeAndUpdate])

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
          input: resolveDiskPath((node.data as { url?: string }).url ?? ''),
          params: {
            strategy,
            threshold: draft.extractConfig.threshold,
            intervalSec: draft.extractConfig.intervalSec,
            maxFrames: draft.extractConfig.maxFrames,
          },
          requestId: reqId,
        })
        if (res.success && res.result) {
          const result = res.result as {
            frames: Array<{ path: string; timestampSec: number; index: number }>
          }
          const frames: WorkbenchKeyframe[] = result.frames.map((f) => ({
            path: f.path,
            previewUrl: encodeToSafeFileUrl(f.path),
            timestampSec: f.timestampSec,
            index: f.index,
          }))
          setDraft((d) => {
            const next = { ...d, keyframes: frames }
            void onSave(next)
            return next
          })
          message.success(`提取了 ${frames.length} 个关键帧`)
        } else {
          console.error('[video-workbench] extractKeyframes failed:', res.error)
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
        input: resolveDiskPath((node.data as { url?: string }).url ?? ''),
        params: { timesSec: draft.manualMarks },
        requestId: reqId,
      })
      if (res.success && res.result) {
        const result = res.result as Array<{ path: string; timestampSec: number; index: number }>
        setDraft((d) => {
          // 重新分配全局唯一 index，避免与已有 keyframes 的 index 冲突
          const baseIdx = d.keyframes.length
          const frames: WorkbenchKeyframe[] = result.map((f, i) => ({
            path: f.path,
            previewUrl: encodeToSafeFileUrl(f.path),
            timestampSec: f.timestampSec,
            index: baseIdx + i,
          }))
          const next = { ...d, keyframes: [...d.keyframes, ...frames] }
          void onSave(next)
          return next
        })
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
      const sourcePath = resolveDiskPath((node.data as { url?: string }).url ?? '')
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

  /** 批量记录产物，保证一次操作只触发一次持久化，避免并发保存覆盖。 */
  const recordOutputs = useCallback(
    (entries: Array<{ summary: string; outputPath: string; type: WorkbenchOutput['type'] }>) => {
      if (entries.length === 0) return
      setActiveTab('output')
      setDraft((d) => {
        const outputs = [
          ...entries.map((entry) => ({
            id: shortId(),
            type: entry.type,
            outputPath: entry.outputPath,
            outputUrl: encodeToSafeFileUrl(entry.outputPath),
            createdAt: Date.now(),
            summary: entry.summary,
          })),
          ...d.outputs,
        ].slice(0, 20) // 保留最近 20 条
        const next = { ...d, outputs, activeTab: 'output' as const }
        void onSave(next)
        return next
      })
    },
    [onSave],
  )

  const recordOutput = useCallback(
    (summary: string, outputPath: string, type: WorkbenchOutput['type']) => {
      recordOutputs([{ summary, outputPath, type }])
    },
    [recordOutputs],
  )

  const handleApplyTimelineTrim = useCallback(async () => {
    const range = normalizeTimelineRange(timelineRange, duration)
    const res = await handleProcess('trim', {
      startSec: range.startSec,
      endSec: range.endSec,
      copy: trimCopy,
    })
    if (!res.success || !res.result) {
      message.error(res.error ?? '选区导出失败')
      return
    }

    const path = (res.result as { path?: string }).path ?? ''
    if (!path) {
      message.error('选区导出失败：未返回产物路径')
      return
    }
    recordOutput(
      `轨道裁剪 ${formatTimestamp(range.startSec)}-${formatTimestamp(range.endSec)}`,
      path,
      'trim',
    )
    message.success(`已导出 ${formatTimestamp(range.endSec - range.startSec)} 片段`)
  }, [duration, handleProcess, recordOutput, timelineRange, trimCopy])

  const handleSplitTimeline = useCallback(async () => {
    const ranges = splitTimelineRange(timelineRange, currentTime, duration)
    if (!ranges) {
      message.warning('请把播放头放在选区内部后再分割')
      return
    }

    const jobs = [
      { range: ranges[0], label: '前段' },
      { range: ranges[1], label: '后段' },
    ] as const
    const outputs: Array<{ path: string; range: TimelineRange; label: string }> = []
    const persistSuccessfulOutputs = () => {
      recordOutputs(
        outputs.map((output) => ({
          summary: `轨道分割·${output.label} ${formatTimestamp(output.range.startSec)}-${formatTimestamp(output.range.endSec)}`,
          outputPath: output.path,
          type: 'trim' as const,
        })),
      )
    }
    for (const job of jobs) {
      const { range, label } = job
      const res = await handleProcess('trim', {
        startSec: range.startSec,
        endSec: range.endSec,
        copy: trimCopy,
      })
      if (!res.success || !res.result) {
        persistSuccessfulOutputs()
        const reason = res.error ?? `${label}分割失败`
        message.error(outputs.length > 0 ? `${reason}，已保留成功片段` : reason)
        return
      }
      const path = (res.result as { path?: string }).path ?? ''
      if (!path) {
        persistSuccessfulOutputs()
        const reason = `${label}分割失败：未返回产物路径`
        message.error(outputs.length > 0 ? `${reason}，已保留成功片段` : reason)
        return
      }
      outputs.push({ path, range, label })
    }

    persistSuccessfulOutputs()
    message.success(`已在 ${formatTimestamp(currentTime)} 分割并导出 2 个片段`)
  }, [currentTime, duration, handleProcess, recordOutputs, timelineRange, trimCopy])

  // ── Esc 关闭（全局监听，不依赖 overlay 获得焦点）──
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="vwb-modal-overlay">
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
            {(onAddVideo || (onSelectVideo && videoNodes && videoNodes.length > 0)) && (
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{
                  items: [
                    ...(onAddVideo
                      ? [
                          {
                            key: 'from-file',
                            label: '从文件添加…',
                            onClick: () => void onAddVideo(),
                          },
                        ]
                      : []),
                    ...(onSelectVideo && videoNodes && videoNodes.length > 0
                      ? [
                          { type: 'divider' as const },
                          ...videoNodes.map((v) => ({
                            key: `pick-${v.id}`,
                            label: v.title,
                            onClick: () => void onSelectVideo(v.url),
                          })),
                        ]
                      : []),
                  ],
                }}
              >
                <Button
                  size="small"
                  type={sourceVideoUrl ? 'default' : 'primary'}
                  icon={<Icons.Video size={14} />}
                >
                  {sourceVideoUrl ? '更换视频' : '添加视频'}
                </Button>
              </Dropdown>
            )}
            <Button size="small" type="text" onClick={onClose} icon={<Icons.X size={16} />}>
              关闭
            </Button>
          </div>
        </div>

        {/* ── ffmpeg 未就绪提示 ── */}
        {ffmpegReady === false && (
          <div className="vwb-ffmpeg-warning">
            <Icons.AlertTriangle size={16} />
            <span>
              {ffmpegInstallProgress?.message ?? 'FFmpeg 未安装，关键帧提取和本地剪辑暂不可用。'}
              {ffmpegInstallProgress?.percent != null
                ? ` ${Math.round(ffmpegInstallProgress.percent)}%`
                : ''}
            </span>
            <Button
              size="small"
              type="primary"
              loading={ffmpegInstalling}
              onClick={() => void installFfmpeg()}
              icon={<Icons.Download size={14} />}
            >
              {ffmpegInstalling ? '正在安装' : '下载并安装'}
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
                  preload="metadata"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration
                    if (Number.isFinite(d) && d > 0) setVideoMetaDuration(d)
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="vwb-video"
                />
              ) : (
                <div className="vwb-video-empty">
                  <Icons.Film size={48} />
                  <span>未关联视频</span>
                </div>
              )}
            </div>

            {/* 自定义播放控制条 */}
            {sourceVideoUrl && (
              <div className="vwb-player-controls">
                <button
                  className="vwb-player-btn"
                  onClick={() => {
                    const v = videoRef.current
                    if (!v) return
                    // 逐帧后退（1/fps，默认 1/30）
                    const fps = probe?.fps ?? 30
                    v.pause()
                    v.currentTime = Math.max(0, v.currentTime - 1 / fps)
                  }}
                  title="上一帧"
                >
                  <Icons.ChevronLeft size={16} />
                </button>
                <button
                  className="vwb-player-btn vwb-player-play"
                  onClick={() => {
                    const v = videoRef.current
                    if (!v) return
                    if (v.paused) void v.play()
                    else v.pause()
                  }}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? <Icons.Pause size={18} /> : <Icons.Play size={18} />}
                </button>
                <button
                  className="vwb-player-btn"
                  onClick={() => {
                    const v = videoRef.current
                    if (!v) return
                    const fps = probe?.fps ?? 30
                    v.pause()
                    v.currentTime = Math.min(v.duration || 0, v.currentTime + 1 / fps)
                  }}
                  title="下一帧"
                >
                  <Icons.ChevronRight size={16} />
                </button>
                <span className="vwb-player-time">{formatTimestamp(currentTime)}</span>
                <span className="vwb-player-divider">/</span>
                <span className="vwb-player-duration">{formatTimestamp(duration)}</span>
                <div className="vwb-player-spacer" />
                <button
                  className="vwb-player-btn"
                  onClick={() => {
                    const v = videoRef.current
                    if (!v) return
                    v.currentTime = 0
                  }}
                  title="回到开头"
                >
                  <Icons.RotateCcw size={14} />
                </button>
              </div>
            )}

            {/* 专业视频轨道 */}
            <VideoTimeline
              duration={duration}
              currentTime={currentTime}
              keyframes={draft.keyframes}
              manualMarks={draft.manualMarks}
              range={timelineRange}
              trimCopy={trimCopy}
              processingReady={ffmpegReady === true}
              onSeek={seekTo}
              onRangeChange={handleTimelineRangeChange}
              onTrimCopyChange={setTrimCopy}
              onApplyTrim={() => void handleApplyTimelineTrim()}
              onSplit={() => void handleSplitTimeline()}
              onMark={addManualMark}
              onRemoveMark={removeManualMark}
              onExtractMarks={extractManualMarks}
              busy={busy}
            />
          </div>

          {/* 右侧：Tab 面板 */}
          <div className="vwb-side-pane">
            <div className="vwb-workflow-strip" aria-label="视频工作流">
              <span className={activeTab === 'frames' ? 'is-active' : ''}>01 素材分析</span>
              <Icons.ChevronRight size={13} />
              <span className={activeTab === 'edit' ? 'is-active' : ''}>02 剪辑处理</span>
              <Icons.ChevronRight size={13} />
              <span className={activeTab === 'output' ? 'is-active' : ''}>03 产物检查</span>
            </div>
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
                  setDraft((d) => {
                    const next = { ...d, extractConfig: cfg }
                    void onSave(next)
                    return next
                  })
                }}
                onSeek={seekTo}
                onExport={handleExportKeyframes}
                onRemoveKeyframe={(idx) => {
                  setDraft((d) => {
                    const next = { ...d, keyframes: d.keyframes.filter((k) => k.index !== idx) }
                    void onSave(next)
                    return next
                  })
                }}
              />
            )}

            {activeTab === 'edit' && (
              <VideoWorkbenchEditPanel
                probe={probe}
                busy={busy}
                progress={progress}
                ffmpegReady={ffmpegReady}
                probeFailed={probeFailed}
                fallbackDuration={videoMetaDuration}
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
