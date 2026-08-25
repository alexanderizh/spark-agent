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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Dropdown, Segmented, message } from 'antd'
import type { MenuProps } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { encodeToSafeFileUrl } from '../canvas-safe-file'
import { resolveVideoWorkbenchDiskPath as resolveDiskPath } from './videoWorkbenchPath'
import type { FfmpegInstallProgress, VideoProcessRequest } from '@spark/protocol'
import { Icons } from '../../../Icons'
import type { CanvasNode } from '../canvas.types'
import {
  formatTimestamp,
  type KeyframeStrategy,
  type VideoProbeInfo,
  type VideoWorkbenchData,
  type WorkbenchCanvasMaterialization,
  type WorkbenchKeyframe,
  type WorkbenchOutput,
} from './videoWorkbench.types'
import { VideoWorkbenchFramePanel } from './VideoWorkbenchFramePanel'
import { VideoWorkbenchEditPanel } from './VideoWorkbenchEditPanel'
import { VideoWorkbenchResourcePanel } from './VideoWorkbenchResourcePanel'
import { VideoWorkbenchOutputPanel } from './VideoWorkbenchOutputPanel'
import type { ThumbnailMeta } from './VideoWorkbenchResourceThumb'
import { VideoWorkbenchResourcePicker } from './VideoWorkbenchResourcePicker'
import { useVideoWorkbenchPlayback } from './useVideoWorkbenchPlayback'
import { VideoCropOverlay } from './VideoCropOverlay'
import {
  DEFAULT_VIDEO_CROP_RECT,
  videoCropRectToPixels,
  type VideoCropRect,
} from './videoCropModel'
import {
  backfillResourceMetadata,
  indexResourcesById,
  mergeResources,
  trackNeedsMaterialization,
} from './resourcePanelUtils'
import type { TrackClip, WorkbenchResource } from './videoWorkbench.types'
import {
  createDefaultVideoWorkbenchProject,
  type VideoWorkbenchProjectV2,
  type VideoWorkbenchResourceV2,
} from './model/projectTypes'
import { useVideoWorkbenchProjectSession } from './model/useVideoWorkbenchProjectSession'
import {
  isLegacyVideoWorkbenchExportCompatible,
  videoWorkbenchClipToLegacyTrackClip,
} from './model/projectLegacyAdapter'
import {
  createVideoWorkbenchClipForResource,
  createVideoWorkbenchEntityId,
  createVideoWorkbenchTrack,
  findDefaultVideoWorkbenchTrackForResource,
  resolveVideoWorkbenchTrackAppendTime,
} from './model/timelineEditing'
import { findVideoWorkbenchClip } from './model/trackRules'
import { backfillVideoWorkbenchProjectResourceMetadata } from './model/resourceMetadata'
import { resolveVideoWorkbenchClipTiming } from './model/timelineMath'
import { syncVideoWorkbenchSourceResource } from './model/sourceResourceSync'
import { VideoWorkbenchMultiTrackTimeline } from './timeline/VideoWorkbenchMultiTrackTimeline'
import './videoWorkbench.less'

/** macOS 无边框窗口红绿灯安全区 */
const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

/** 生成短 uuid（requestId 用） */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** 播放速率档位（含慢放 0.25x / 0.5x），显示为 "0.25x" 样式 */
const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const

function formatPlaybackRate(rate: number): string {
  return `${rate}x`
}

function prependWorkbenchOutput(
  draft: VideoWorkbenchData,
  output: WorkbenchOutput,
): VideoWorkbenchData {
  return {
    ...draft,
    outputs: [output, ...draft.outputs].slice(0, 20),
    activeTab: 'output',
  }
}

/**
 * 把 node.data.url（可能是 safe-file:// 编码 URL 或原始路径）解码为磁盘绝对路径。
 * ffmpeg 需要磁盘路径，不能接受 safe-file:// URL。
 * 解码逻辑与 CanvasWorkspaceView.decodeSafeFileUrl 一致。
 */
/** 画布上可选作源视频的节点（从画布选择用） */
interface CanvasVideoOption {
  id: string
  title: string
  url: string
  thumbnailUrl?: string
}

/** 父级支持的"从画布选择资源"输入（含图片 + 视频） */
export interface CanvasResourceOption {
  id: string
  title: string
  url: string
  kind: 'video' | 'image' | 'audio'
  thumbnailUrl?: string
  durationSec?: number
  width?: number
  height?: number
  fileSize?: number
}

/** 资源面板可接收的本地文件（父级在文件选择器回调中解析后传入） */
export interface LocalResourceFile {
  path: string
  name: string
  kind: 'video' | 'image' | 'audio'
  url: string
  thumbnailUrl?: string
  durationSec?: number
  width?: number
  height?: number
  fileSize?: number
}

interface Props {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (data: VideoWorkbenchProjectV2) => Promise<void>
  /** 把关键帧导出为画布图片节点 */
  onExportKeyframes?: (
    frames: WorkbenchKeyframe[],
    sourceNodeId: string,
  ) => Promise<WorkbenchKeyframe[] | undefined>
  /** 添加/切换源视频（文件选择器 → 落盘 → 写回 node.data.url） */
  onAddVideo?: () => Promise<void>
  /** 从画布选择视频作为源（传入画布视频节点的 url） */
  onSelectVideo?: (url: string) => Promise<void>
  /** 画布上可用的视频节点列表（从画布选择用） */
  videoNodes?: CanvasVideoOption[]
  /** 资源面板：从本机添加（父级弹出文件选择器，把解析后的资源列表传回） */
  onAddLocalResources?: () => Promise<LocalResourceFile[]>
  /** 资源面板：从画布选择资源（父级弹出画布选择 UI，把选中资源传回） */
  onPickCanvasResources?: () => Promise<CanvasResourceOption[]>
  /** 资源面板：按上级连线自动收集上游节点首选产物（父级实现，传入一个已收集好的资源列表） */
  onCollectUpstream?: () => Promise<CanvasResourceOption[]>
  onMaterializeOutput?: (
    output: WorkbenchOutput,
    mode: 'add' | 'replace',
  ) => Promise<WorkbenchCanvasMaterialization | undefined>
}

function canvasResourceOptionToWorkbenchResource(
  r: CanvasResourceOption,
  source: 'upstream' | 'canvas',
): WorkbenchResource {
  const base: WorkbenchResource = {
    id: `${source}:${r.id}`,
    source,
    kind: r.kind,
    title: r.title,
    url: r.url,
    originPath: resolveDiskPath(r.url),
    importedAt: Date.now(),
  }
  return {
    ...base,
    ...(r.thumbnailUrl !== undefined ? { thumbnailUrl: r.thumbnailUrl } : {}),
    ...(r.durationSec !== undefined ? { durationSec: r.durationSec } : {}),
    ...(r.width !== undefined ? { width: r.width } : {}),
    ...(r.height !== undefined ? { height: r.height } : {}),
    ...(r.fileSize !== undefined ? { fileSize: r.fileSize } : {}),
  }
}

function localResourceFileToWorkbenchResource(f: LocalResourceFile): WorkbenchResource {
  const base: WorkbenchResource = {
    id: `local:${f.path}`,
    source: 'local',
    kind: f.kind,
    title: f.name,
    url: f.url,
    originPath: f.path,
    importedAt: Date.now(),
  }
  return {
    ...base,
    ...(f.thumbnailUrl !== undefined ? { thumbnailUrl: f.thumbnailUrl } : {}),
    ...(f.durationSec !== undefined ? { durationSec: f.durationSec } : {}),
    ...(f.width !== undefined ? { width: f.width } : {}),
    ...(f.height !== undefined ? { height: f.height } : {}),
    ...(f.fileSize !== undefined ? { fileSize: f.fileSize } : {}),
  }
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
  onAddLocalResources,
  onPickCanvasResources,
  onCollectUpstream,
  onMaterializeOutput,
}: Props): ReactElement | null {
  // V2 是唯一编辑与持久化状态源；旧面板只消费 session 暴露的兼容视图。
  // Modal 在父级用 key={node.id} 绑定节点，切换节点会完整 remount。
  const projectSession = useVideoWorkbenchProjectSession({
    raw: node?.data?.videoWorkbench,
    open,
    onSave,
    onSaveError: (error) => {
      message.error(error instanceof Error ? error.message : '自动保存视频工作台失败')
    },
  })
  const {
    project,
    legacyDraft: draft,
    issues: projectIssues,
    readOnly: projectReadOnly,
    canUndo,
    canRedo,
    applyCommand: applyProjectCommand,
    updateProject,
    updateLegacyDraft: updateDraft,
    undo: undoProject,
    redo: redoProject,
    saveNow: saveProjectNow,
  } = projectSession
  const [activeTab, setActiveTab] = useState<'resources' | 'frames' | 'edit' | 'output'>(
    draft.activeTab === 'frames' ||
      draft.activeTab === 'edit' ||
      draft.activeTab === 'output' ||
      draft.activeTab === 'resources'
      ? draft.activeTab
      : 'resources',
  )
  useEffect(() => {
    updateProject((current) =>
      current.ui.activeTab === activeTab
        ? current
        : { ...current, ui: { ...current.ui, activeTab } },
    )
  }, [activeTab, updateProject])
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null)
  const [ffmpegInstalling, setFfmpegInstalling] = useState(false)
  const [ffmpegInstallProgress, setFfmpegInstallProgress] = useState<FfmpegInstallProgress | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  /** 进度 0~100，null 表示无活动 */
  const [progress, setProgress] = useState<number | null>(null)
  const [progressStage, setProgressStage] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoStageRef = useRef<HTMLDivElement>(null)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<VideoCropRect>(DEFAULT_VIDEO_CROP_RECT)
  const [cropMediaBounds, setCropMediaBounds] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  /** probe in-flight 哨兵，防止自动 probe 重复触发 */
  const probingRef = useRef(false)
  /** probe 失败标记（无 ffmpeg / 路径问题），用于区分「探测中」和「探测失败」 */
  const [probeFailed, setProbeFailed] = useState(false)
  /** video 元素的 duration（probe 失败时兜底用） */
  const [videoMetaDuration, setVideoMetaDuration] = useState(0)
  /** video 元素的原始尺寸（probe 失败时供可视化裁剪换算使用） */
  const [videoMetaSize, setVideoMetaSize] = useState<{ width: number; height: number } | null>(null)
  /** 当前播放位置（秒），用于手动标记 */
  const [currentTime, setCurrentTime] = useState(0)
  /** 播放速率（含慢放 0.25x/0.5x），作用于主预览 video 元素 */
  const [playbackRate, setPlaybackRate] = useState(1)
  /** 资源面板当前选中的资源 id（用于在主预览区单独预览） */
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
  /** 轨道中当前选中的分段；末项是属性与播放控制栏使用的主选分段。 */
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const selectedClipId = selectedClipIds.at(-1) ?? null
  /** 多段轨道连播状态机（active 时主预览区按 clip 顺序连播，详见 useVideoWorkbenchPlayback） */
  const playback = useVideoWorkbenchPlayback({
    track: draft.track,
    resources: draft.resourcePanel,
    videoRef,
  })
  /** 「从画布选择资源」Picker 的打开状态与候选列表（UI 在 Modal 内部，避免改动父级） */
  const [canvasPickerOpen, setCanvasPickerOpen] = useState(false)
  const [canvasPickerCandidates, setCanvasPickerCandidates] = useState<CanvasResourceOption[]>([])
  const [canvasPickerPurpose, setCanvasPickerPurpose] = useState<'resources' | 'source'>(
    'resources',
  )
  const autoCollectTriggeredRef = useRef(false)
  /** 已同步到统一轨道的源视频；用于区分首次迁移与工作台内切换源视频。 */
  const seededSourceUrlRef = useRef('')

  const sourceVideoUrl = useMemo(() => {
    const raw = node?.data?.url as string | undefined
    return raw ? normalizeEduAssetUrl(raw) : ''
  }, [node?.data?.url])

  /**
   * 主预览区当前展示，优先级：单独预览（点资源 Eye）> 连播（playback.active）> 源视频。
   * isPlayback 标志用于决定 <video> 事件是否转发给连播状态机。
   */
  const preview = useMemo(() => {
    if (selectedResourceId) {
      const r = draft.resourcePanel.find((x) => x.id === selectedResourceId)
      if (r) {
        return {
          selectedResource: r as WorkbenchResource | null,
          previewUrl: r.url,
          previewKind: r.kind,
          isPlayback: false as const,
        }
      }
    }
    if (playback.active && playback.currentResource) {
      return {
        selectedResource: null as WorkbenchResource | null,
        previewUrl: playback.currentResource.url,
        previewKind: playback.currentResource.kind,
        isPlayback: true as const,
      }
    }
    return {
      selectedResource: null as WorkbenchResource | null,
      previewUrl: sourceVideoUrl,
      previewKind: sourceVideoUrl ? ('video' as const) : null,
      isPlayback: false as const,
    }
  }, [
    draft.resourcePanel,
    selectedResourceId,
    sourceVideoUrl,
    playback.active,
    playback.currentResource,
  ])
  const { selectedResource, previewUrl, previewKind, isPlayback } = preview
  const selectedProjectClip = useMemo(
    () => (selectedClipId ? findVideoWorkbenchClip(project, selectedClipId) : null),
    [project, selectedClipId],
  )
  const selectedClip = useMemo(() => {
    if (!selectedProjectClip) return null
    const resource = selectedProjectClip.clip.resourceId
      ? project.resources.find((item) => item.id === selectedProjectClip.clip.resourceId)
      : undefined
    return videoWorkbenchClipToLegacyTrackClip(selectedProjectClip.clip, resource)
  }, [project.resources, selectedProjectClip])
  const usedResourceIds = useMemo(
    () =>
      new Set(
        project.tracks.flatMap((track) =>
          track.clips.flatMap((clip) => (clip.resourceId ? [clip.resourceId] : [])),
        ),
      ),
    [project.tracks],
  )
  // 解构 playback 的稳定函数与状态，避免依赖整个对象导致下游 useCallback 频繁重建
  const {
    toggle: playbackToggle,
    seekToGlobal: playbackSeek,
    handleVideoEnded: playbackOnEnded,
    handleVideoTimeUpdate: playbackOnTimeUpdate,
    handleVideoPlay: playbackOnPlay,
    handleVideoPause: playbackOnPause,
    exit: playbackExit,
    playing: playbackPlaying,
    globalTimeSec: playbackGlobalTime,
    totalDurationSec: playbackTotal,
  } = playback

  const probe = draft.probeInfo
  const duration = probe?.durationSec ?? videoMetaDuration ?? 0

  const updateCropMediaBounds = useCallback(() => {
    const stage = videoStageRef.current
    const video = videoRef.current
    if (!stage || !video || video.getBoundingClientRect().width <= 0) {
      setCropMediaBounds(null)
      return
    }
    const stageBounds = stage.getBoundingClientRect()
    const videoBounds = video.getBoundingClientRect()
    setCropMediaBounds({
      left: videoBounds.left - stageBounds.left,
      top: videoBounds.top - stageBounds.top,
      width: videoBounds.width,
      height: videoBounds.height,
    })
  }, [])

  useLayoutEffect(() => {
    if (!cropMode) return
    const frameId = requestAnimationFrame(updateCropMediaBounds)
    const stage = videoStageRef.current
    const video = videoRef.current
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCropMediaBounds) : null
    if (stage) resizeObserver?.observe(stage)
    if (video) resizeObserver?.observe(video)
    window.addEventListener('resize', updateCropMediaBounds)
    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateCropMediaBounds)
    }
  }, [cropMode, previewUrl, updateCropMediaBounds, videoMetaDuration, videoMetaSize])
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
          updateDraft((d) => ({
            ...d,
            probeInfo,
            resourcePanel: backfillResourceMetadata(d.resourcePanel, `source:${n.id}`, probeInfo),
          }))
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
    [updateDraft],
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

  // 收窄依赖：只关心 extractConfig 三个参数，不让整个 draft 把回调拖着重算
  const extractConfig = draft.extractConfig
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
            threshold: extractConfig.threshold,
            intervalSec: extractConfig.intervalSec,
            maxFrames: extractConfig.maxFrames,
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
          updateDraft((d) => ({ ...d, keyframes: frames }))
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
    [node, probe, extractConfig, updateDraft],
  )

  /**
   * 手动截取当前帧：把主预览区正在显示的这一帧提取为图片并插入关键帧列表。
   * 输入源跟随当前预览：单独预览资源 > 连播当前片段资源 > 源视频；
   * video.currentTime 即该资源本地时间，与提取输入一一对应。
   */
  const handleCaptureCurrentFrame = useCallback(async () => {
    const v = videoRef.current
    if (!v || previewKind !== 'video') return
    const previewResourceUrl = selectedResource
      ? selectedResource.url
      : isPlayback && playback.currentResource
        ? playback.currentResource.url
        : ((node?.data as { url?: string } | undefined)?.url ?? '')
    const inputPath = previewResourceUrl ? resolveDiskPath(previewResourceUrl) : ''
    if (!inputPath) {
      message.error('无法解析当前预览源路径')
      return
    }
    setBusy(true)
    try {
      const res = await window.spark.invoke('video:process', {
        operation: 'extractFramesAtTimes',
        input: inputPath,
        params: { timesSec: [v.currentTime] },
        requestId: shortId(),
      })
      if (res.success && res.result) {
        const frames = res.result as Array<{
          path: string
          timestampSec: number
          index: number
        }>
        const frame = frames[0]
        if (!frame) {
          message.warning('未能提取当前帧，可稍偏移播放头后重试')
          return
        }
        updateDraft((d) => {
          const nextIndex = d.keyframes.reduce((max, kf) => Math.max(max, kf.index), -1) + 1
          const keyframe: WorkbenchKeyframe = {
            path: frame.path,
            previewUrl: encodeToSafeFileUrl(frame.path),
            timestampSec: frame.timestampSec,
            index: nextIndex,
          }
          return {
            ...d,
            keyframes: [...d.keyframes, keyframe].sort((a, b) => a.timestampSec - b.timestampSec),
          }
        })
        message.success('已截取当前帧到关键帧列表')
      } else {
        console.error('[video-workbench] captureFrame failed:', res.error)
        message.error(res.error ?? '截取当前帧失败')
      }
    } catch (err) {
      message.error(`截取当前帧失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [isPlayback, node, playback.currentResource, previewKind, selectedResource, updateDraft])

  // 播放速率：换 src / 连播切 clip 后 video 元素会重置为 1x，需重新应用；
  // readyState < 1（未加载元数据）时部分实现设置不生效，等 loadedmetadata 后再补一次。
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = playbackRate
    if (v.readyState >= 1) return
    const apply = () => {
      v.playbackRate = playbackRate
    }
    v.addEventListener('loadedmetadata', apply, { once: true })
    return () => v.removeEventListener('loadedmetadata', apply)
  }, [playbackRate, previewUrl])

  // 跳转到指定时间点
  const seekTo = useCallback((sec: number) => {
    const v = videoRef.current
    if (v) {
      v.currentTime = sec
      setCurrentTime(sec)
    }
  }, [])

  /**
   * 播放/暂停：
   *  - 已在连播 → 状态机 toggle
   *  - 有轨道且未单独预览 → 进入连播（用户编排了轨道，点播放=看整条）
   *  - 其余（无轨道 / 单独预览资源 / 源视频）→ 直接控制主预览 video 元素
   */
  const handlePlayToggle = useCallback(() => {
    if (isPlayback || (draft.track.length > 0 && !selectedResourceId)) {
      playbackToggle()
      return
    }
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }, [isPlayback, draft.track.length, selectedResourceId, playbackToggle])

  /** 逐帧（仅视频；连播 / 单独预览 / 源视频都基于同一个 video 元素） */
  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      const v = videoRef.current
      if (!v) return
      const fps = probe?.fps ?? 30
      v.pause()
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / fps))
    },
    [probe?.fps],
  )

  /** 回到开头：连播模式 seek 到全局 0；其余 video.currentTime = 0 */
  const handleToStart = useCallback(() => {
    if (isPlayback) {
      playbackSeek(0)
      return
    }
    const v = videoRef.current
    if (v) v.currentTime = 0
  }, [isPlayback, playbackSeek])

  /** 相对 seek：连播用全局时间，其余直接改 video.currentTime（供 Shift+←/→ 5s 跳转） */
  const seekRelative = useCallback(
    (deltaSec: number) => {
      if (isPlayback) {
        playbackSeek(Math.max(0, playbackGlobalTime + deltaSec))
        return
      }
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + deltaSec))
    },
    [isPlayback, playbackGlobalTime, playbackSeek],
  )

  /** 时间线 seek：若正在单独预览某资源，自动切回连播模式。 */
  const handlePlaybackSeek = useCallback(
    (sec: number) => {
      if (selectedResourceId) setSelectedResourceId(null)
      playbackSeek(sec)
    },
    [selectedResourceId, playbackSeek],
  )

  const handleExportKeyframes = useCallback(
    async (frames: WorkbenchKeyframe[]) => {
      if (!node || !onExportKeyframes || frames.length === 0) return
      setBusy(true)
      try {
        const imported = await onExportKeyframes(frames, node.id)
        if (imported && imported.length > 0) {
          const importedByIndex = new Map(imported.map((frame) => [frame.index, frame]))
          updateDraft((current) => ({
            ...current,
            keyframes: current.keyframes.map((frame) => importedByIndex.get(frame.index) ?? frame),
          }))
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '关键帧导入画布失败')
      } finally {
        setBusy(false)
      }
    },
    [node, onExportKeyframes, updateDraft],
  )

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
      const outputs = entries.map((entry) => ({
        id: shortId(),
        type: entry.type,
        outputPath: entry.outputPath,
        outputUrl: encodeToSafeFileUrl(entry.outputPath),
        createdAt: Date.now(),
        summary: entry.summary,
      }))
      updateDraft((d) => ({
        ...d,
        outputs: [...outputs, ...d.outputs].slice(0, 20),
        activeTab: 'output',
      }))
    },
    [updateDraft],
  )

  const appendOutput = useCallback(
    (output: WorkbenchOutput) => {
      setActiveTab('output')
      updateDraft((d) => prependWorkbenchOutput(d, output))
    },
    [updateDraft],
  )

  const recordOutput = useCallback(
    (summary: string, outputPath: string, type: WorkbenchOutput['type']) => {
      recordOutputs([{ summary, outputPath, type }])
    },
    [recordOutputs],
  )

  const handleStartCrop = useCallback(() => {
    if (!sourceVideoUrl || previewKind !== 'video') {
      message.info('请先准备一个可播放的视频源')
      return
    }
    playbackExit()
    setSelectedResourceId(null)
    setActiveTab('edit')
    setCropRect(DEFAULT_VIDEO_CROP_RECT)
    setCropMode(true)
  }, [playbackExit, previewKind, sourceVideoUrl])

  const handleCancelCrop = useCallback(() => {
    setCropMode(false)
    setCropMediaBounds(null)
  }, [])

  const handleConfirmCrop = useCallback(
    async (selection: VideoCropRect) => {
      const video = videoRef.current
      const sourceWidth = probe?.width ?? video?.videoWidth ?? 0
      const sourceHeight = probe?.height ?? video?.videoHeight ?? 0
      if (
        !Number.isFinite(sourceWidth) ||
        !Number.isFinite(sourceHeight) ||
        sourceWidth < 2 ||
        sourceHeight < 2
      ) {
        message.error('视频尺寸尚未读取完成，请稍后再试')
        return
      }
      const crop = videoCropRectToPixels(selection, sourceWidth, sourceHeight)
      setCropMode(false)
      setCropMediaBounds(null)
      const result = await handleProcess('crop', { ...crop })
      if (!result.success || !result.result) {
        message.error(result.error ?? '画面裁剪失败')
        return
      }
      const outputPath = (result.result as { path?: string }).path ?? ''
      if (!outputPath) {
        message.error('画面裁剪完成，但没有返回产物文件')
        return
      }
      recordOutput(`画面裁剪 ${crop.w}×${crop.h}`, outputPath, 'effect')
      message.success(`已裁剪画面为 ${crop.w}×${crop.h}`)
    },
    [handleProcess, probe?.height, probe?.width, recordOutput],
  )

  // ── 资源面板 / 多轨 handlers ───────────────────────────────────
  const exportTrackOutput = useCallback(
    async (track: TrackClip[]): Promise<WorkbenchOutput | null> => {
      const sortedTrack = track.slice().sort((a, b) => a.order - b.order)
      if (sortedTrack.length === 0) return null
      const resourcesById = indexResourcesById(draft.resourcePanel)
      const inputPaths: string[] = []
      for (const clip of sortedTrack) {
        const resource = resourcesById.get(clip.resourceId)
        if (!resource || resource.kind !== 'video') {
          throw new Error('当前轨道含有无法导出的图片或缺失资源')
        }
        const sourcePath = resolveDiskPath(resource.originPath || resource.url)
        if (!sourcePath) throw new Error(`无法读取分段“${resource.title}”的文件路径`)

        let clipPath = sourcePath
        if (clip.range) {
          const trimResult = await window.spark.invoke('video:process', {
            operation: 'trim',
            input: sourcePath,
            params: { startSec: clip.range.startSec, endSec: clip.range.endSec },
            requestId: shortId(),
          })
          if (!trimResult.success || !trimResult.result) {
            throw new Error(trimResult.error ?? `分段“${resource.title}”导出失败`)
          }
          clipPath = (trimResult.result as { path?: string }).path ?? ''
          if (!clipPath) throw new Error(`分段“${resource.title}”没有生成文件`)
        }
        inputPaths.push(clipPath)
      }

      const firstPath = inputPaths[0]
      if (!firstPath) return null
      let outputPath = firstPath
      if (inputPaths.length > 1) {
        const concatResult = await window.spark.invoke('video:process', {
          operation: 'concat',
          input: firstPath,
          params: { additionalInputs: inputPaths.slice(1) },
          requestId: shortId(),
        })
        if (!concatResult.success || !concatResult.result) {
          throw new Error(concatResult.error ?? '轨道合成失败')
        }
        outputPath = (concatResult.result as { path?: string }).path ?? ''
      }
      if (!outputPath) throw new Error('轨道没有生成可用产物')
      return {
        id: shortId(),
        type: inputPaths.length > 1 ? 'concat' : 'segment',
        outputPath,
        outputUrl: encodeToSafeFileUrl(outputPath),
        createdAt: Date.now(),
        summary: `轨道合成（${sortedTrack.length} 段）`,
      }
    },
    [draft.resourcePanel],
  )

  const handleExportTrack = useCallback(async () => {
    if (draft.track.length === 0) return
    setBusy(true)
    setProgress(null)
    try {
      const output = await exportTrackOutput(draft.track)
      if (!output) return
      appendOutput(output)
      message.success('当前轨道已导出到产物面板')
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [appendOutput, draft.track, exportTrackOutput])

  const handleMaterializeOutput = useCallback(
    async (output: WorkbenchOutput, mode: 'add' | 'replace') => {
      if (!onMaterializeOutput) return
      setBusy(true)
      try {
        const materialized = await onMaterializeOutput(output, mode)
        const nextOutput = materialized
          ? {
              ...output,
              canvasNodeId: materialized.nodeId,
              outputPath: materialized.outputPath,
              outputUrl: materialized.outputUrl,
            }
          : output
        updateDraft((current) => ({
          ...current,
          outputs: current.outputs.map((item) =>
            item.id === output.id ? { ...item, ...nextOutput } : item,
          ),
        }))
        message.success(mode === 'add' ? '产物已添加到画布' : '当前视频节点已替换')
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    },
    [onMaterializeOutput, updateDraft],
  )

  const handleMaterializeClip = useCallback(
    async (clip: TrackClip, mode: 'add' | 'replace') => {
      if (!onMaterializeOutput) return
      const resource = draft.resourcePanel.find((item) => item.id === clip.resourceId)
      if (!resource || resource.kind !== 'video') {
        message.error('当前分段不是可落地的视频资源')
        return
      }
      const sourcePath = resolveDiskPath(resource.originPath || resource.url)
      if (!sourcePath) {
        message.error(`无法读取分段“${resource.title}”的文件路径`)
        return
      }

      setBusy(true)
      try {
        let outputPath = sourcePath
        if (clip.range) {
          const trimResult = await window.spark.invoke('video:process', {
            operation: 'trim',
            input: sourcePath,
            params: { startSec: clip.range.startSec, endSec: clip.range.endSec },
            requestId: shortId(),
          })
          if (!trimResult.success || !trimResult.result) {
            throw new Error(trimResult.error ?? `分段“${resource.title}”导出失败`)
          }
          outputPath = (trimResult.result as { path?: string }).path ?? ''
          if (!outputPath) throw new Error(`分段“${resource.title}”没有生成文件`)
        }

        const startSec = clip.range?.startSec ?? 0
        const endSec = clip.range?.endSec ?? resource.durationSec
        const output: WorkbenchOutput = {
          id: shortId(),
          type: 'segment',
          outputPath,
          outputUrl: encodeToSafeFileUrl(outputPath),
          createdAt: Date.now(),
          summary:
            endSec !== undefined
              ? `分段：${resource.title}（${formatTimestamp(startSec)}-${formatTimestamp(endSec)}）`
              : `分段：${resource.title}`,
        }
        const materialized = await onMaterializeOutput(output, mode)
        const nextOutput = materialized
          ? {
              ...output,
              canvasNodeId: materialized.nodeId,
              outputPath: materialized.outputPath,
              outputUrl: materialized.outputUrl,
            }
          : output
        updateDraft((current) => prependWorkbenchOutput(current, nextOutput))
        message.success(mode === 'add' ? '分段已添加到画布' : '当前视频节点已替换为该分段')
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    },
    [draft.resourcePanel, onMaterializeOutput, updateDraft],
  )

  // 旧工作台把 node.data.url 放在独立单视频时间线；首次打开时迁入 V2 主视频轨。
  // 工作台保持打开时切换源视频会重建当前工程，避免旧多轨引用重新写回新源节点。
  useEffect(() => {
    if (!sourceVideoUrl || seededSourceUrlRef.current === sourceVideoUrl) return
    const sourceChanged = seededSourceUrlRef.current !== ''
    seededSourceUrlRef.current = sourceVideoUrl
    updateProject((current) => {
      const resourceId = `source:${node?.id ?? 'video'}`
      const persistedSource = current.resources.find((resource) => resource.id === resourceId)
      const sourceMetadata = current.probeInfo ?? persistedSource
      const sourceResource: VideoWorkbenchResourceV2 = {
        id: resourceId,
        source: 'canvas',
        kind: 'video',
        title: node?.title?.replace(/^视频工作台\s*[—-]?\s*/, '') || '源视频',
        url: sourceVideoUrl,
        originPath: resolveDiskPath(sourceVideoUrl) || sourceVideoUrl,
        importedAt: persistedSource?.importedAt ?? Date.now(),
        ...(sourceMetadata?.durationSec !== undefined
          ? { durationSec: sourceMetadata.durationSec }
          : {}),
        ...(sourceMetadata?.width !== undefined ? { width: sourceMetadata.width } : {}),
        ...(sourceMetadata?.height !== undefined ? { height: sourceMetadata.height } : {}),
        ...(sourceMetadata?.fileSize !== undefined ? { fileSize: sourceMetadata.fileSize } : {}),
      }
      if (sourceChanged || (persistedSource != null && persistedSource.url !== sourceVideoUrl)) {
        const reset = createDefaultVideoWorkbenchProject()
        const mainTrack = reset.tracks[0]
        if (!mainTrack) return reset
        return {
          ...reset,
          resources: [sourceResource],
          tracks: [
            {
              ...mainTrack,
              clips: [createVideoWorkbenchClipForResource(reset, sourceResource, 0)],
            },
          ],
        }
      }
      return syncVideoWorkbenchSourceResource(current, sourceResource)
    })
  }, [node?.id, node?.title, sourceVideoUrl, updateProject])

  const handleAddResourceToTrack = useCallback(
    (resource: WorkbenchResource) => {
      const projectResource = project.resources.find((candidate) => candidate.id === resource.id)
      if (!projectResource) return
      const targetTrack = findDefaultVideoWorkbenchTrackForResource(project, projectResource)
      if (targetTrack) {
        const clip = createVideoWorkbenchClipForResource(
          project,
          projectResource,
          resolveVideoWorkbenchTrackAppendTime(targetTrack),
        )
        const result = applyProjectCommand({
          type: 'clip/add',
          trackId: targetTrack.id,
          clip,
        })
        if (result.applied) {
          setSelectedClipIds([clip.id])
          playbackExit()
          setSelectedResourceId(projectResource.id)
        }
        return
      }
      let newTrackKind: 'audio' | 'overlay' | 'video'
      if (projectResource.kind === 'audio') newTrackKind = 'audio'
      else if (project.tracks.some((candidate) => candidate.kind === 'video')) {
        newTrackKind = 'overlay'
      } else newTrackKind = 'video'
      const track = createVideoWorkbenchTrack(project, newTrackKind)
      const clip = createVideoWorkbenchClipForResource(project, projectResource, 0)
      track.clips = [clip]
      const result = applyProjectCommand({ type: 'track/add', track })
      if (result.applied) {
        setSelectedClipIds([clip.id])
        playbackExit()
        setSelectedResourceId(projectResource.id)
      }
    },
    [applyProjectCommand, playbackExit, project],
  )

  const handleRemoveClip = useCallback(
    (clipId: string) => {
      setSelectedClipIds((current) => current.filter((candidate) => candidate !== clipId))
      const result = applyProjectCommand({ type: 'clip/remove', clipId })
      if (!result.applied) message.warning('轨道已锁定，无法删除片段')
    },
    [applyProjectCommand],
  )

  const handleSelectClips = useCallback(
    (clipIds: string[]) => {
      setSelectedClipIds(clipIds)
      const clipId = clipIds.at(-1)
      if (!clipId) return
      const found = findVideoWorkbenchClip(project, clipId)
      const resource = found?.clip.resourceId
        ? project.resources.find((item) => item.id === found.clip.resourceId)
        : undefined
      if (resource) {
        playbackExit()
        setSelectedResourceId(resource.id)
      }
    },
    [playbackExit, project],
  )

  const handleDuplicateClip = useCallback(
    (clipId: string) => {
      const found = findVideoWorkbenchClip(project, clipId)
      if (!found) return
      const duplicateClipId = createVideoWorkbenchEntityId('clip')
      const timelineStartSec =
        found.track.kind === 'video'
          ? resolveVideoWorkbenchTrackAppendTime(found.track)
          : resolveVideoWorkbenchClipTiming(found.clip).timelineEndSec
      const result = applyProjectCommand({
        type: 'clip/duplicate',
        clipId,
        duplicateClipId,
        timelineStartSec,
      })
      if (result.applied) setSelectedClipIds([duplicateClipId])
    },
    [applyProjectCommand, project],
  )

  const handlePreviewResource = useCallback(
    (resource: WorkbenchResource | VideoWorkbenchResourceV2) => {
      playbackExit()
      setSelectedResourceId(resource.id)
    },
    [playbackExit],
  )

  const handleRemoveResource = useCallback(
    (resourceId: string) => {
      setSelectedResourceId((current) => (current === resourceId ? null : current))
      updateProject(
        (current) => ({
          ...current,
          resources: current.resources.filter((resource) => resource.id !== resourceId),
          tracks: current.tracks.map((track) => ({
            ...track,
            clips: track.clips.filter((clip) => clip.resourceId !== resourceId),
          })),
        }),
        true,
      )
    },
    [updateProject],
  )

  // 视频缩略图 <video> onLoadedMetadata 回填：本机导入 / 上游收集的资源常缺 durationSec / 宽高，
  // 缩略图加载时由浏览器拿到的 metadata 批量补齐。每个卡片都可能触发，用 buffer + 短延迟合并，
  // 避免高频 setDraft；已有字段的资源原样返回，不触发 re-render。
  const metaBufferRef = useRef<Map<string, ThumbnailMeta>>(new Map())
  const metaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushResourceMeta = useCallback(() => {
    metaFlushTimerRef.current = null
    const buffer = metaBufferRef.current
    if (buffer.size === 0) return
    const metadataById = new Map(buffer)
    buffer.clear()
    updateProject((current) => backfillVideoWorkbenchProjectResourceMetadata(current, metadataById))
  }, [updateProject])
  const handleResourceMeta = useCallback(
    (resourceId: string, meta: ThumbnailMeta) => {
      const prev = metaBufferRef.current.get(resourceId) ?? {}
      metaBufferRef.current.set(resourceId, { ...prev, ...meta })
      if (metaFlushTimerRef.current == null) {
        metaFlushTimerRef.current = setTimeout(flushResourceMeta, 200)
      }
    },
    [flushResourceMeta],
  )
  // 卸载时清 timer，避免泄漏（buffer 随组件销毁，无需手动 clear）
  useEffect(() => {
    return () => {
      if (metaFlushTimerRef.current != null) {
        clearTimeout(metaFlushTimerRef.current)
      }
    }
  }, [])

  const handleAutoCollectToggle = useCallback(
    (next: boolean) => {
      updateDraft((d) => ({ ...d, autoCollectUpstream: next }))
    },
    [updateDraft],
  )

  const handleCollectUpstream = useCallback(async () => {
    if (!onCollectUpstream) {
      message.info('当前画布上下文未提供「按上级连线收集」能力，仅支持手动添加资源')
      return
    }
    setBusy(true)
    try {
      const collected = await onCollectUpstream()
      if (!Array.isArray(collected) || collected.length === 0) {
        message.info('未找到上级连线节点或没有可收集的产物')
        return
      }
      const incoming: WorkbenchResource[] = collected.map((r) =>
        canvasResourceOptionToWorkbenchResource(r, 'upstream'),
      )
      updateDraft((d) => ({ ...d, resourcePanel: mergeResources(d.resourcePanel, incoming) }))
      message.success(`已收集 ${incoming.length} 个上游产物`)
    } catch (err) {
      message.error(`自动收集上游失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [onCollectUpstream, updateDraft])

  useEffect(() => {
    if (!open || !draft.autoCollectUpstream) {
      autoCollectTriggeredRef.current = false
      return
    }
    if (!onCollectUpstream || autoCollectTriggeredRef.current) return
    autoCollectTriggeredRef.current = true
    void handleCollectUpstream()
  }, [draft.autoCollectUpstream, handleCollectUpstream, onCollectUpstream, open])

  const handleAddResourcesFromProps = useCallback(
    (resources: CanvasResourceOption[] | undefined) => {
      if (!resources || resources.length === 0) return
      const incoming: WorkbenchResource[] = resources.map((r) =>
        canvasResourceOptionToWorkbenchResource(r, 'canvas'),
      )
      updateDraft((d) => ({ ...d, resourcePanel: mergeResources(d.resourcePanel, incoming) }))
    },
    [updateDraft],
  )

  const handleAddLocalResourcesFromProps = useCallback(
    (files: LocalResourceFile[] | undefined) => {
      if (!files || files.length === 0) return
      const incoming: WorkbenchResource[] = files.map((f) =>
        localResourceFileToWorkbenchResource(f),
      )
      updateDraft((d) => ({ ...d, resourcePanel: mergeResources(d.resourcePanel, incoming) }))
    },
    [updateDraft],
  )

  const handlePickLocal = useCallback(async () => {
    if (!onAddLocalResources) return
    try {
      handleAddLocalResourcesFromProps(await onAddLocalResources())
    } catch (err) {
      message.error(`打开本机资源失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [handleAddLocalResourcesFromProps, onAddLocalResources])

  const handlePickCanvas = useCallback(async () => {
    if (!onPickCanvasResources) return
    try {
      const candidates = await onPickCanvasResources()
      if (candidates.length === 0) return // hook 内部已 message 提示
      setCanvasPickerPurpose('resources')
      setCanvasPickerCandidates(candidates)
      setCanvasPickerOpen(true)
    } catch (err) {
      message.error(`打开画布选择失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [onPickCanvasResources])

  const handlePickSourceVideo = useCallback(() => {
    if (!onSelectVideo || !videoNodes || videoNodes.length === 0) return
    setCanvasPickerPurpose('source')
    setCanvasPickerCandidates(
      videoNodes.map((video) => ({
        ...video,
        kind: 'video' as const,
      })),
    )
    setCanvasPickerOpen(true)
  }, [onSelectVideo, videoNodes])

  const handlePickerConfirm = useCallback(
    (selected: CanvasResourceOption[]) => {
      setCanvasPickerOpen(false)
      setCanvasPickerCandidates([])
      if (canvasPickerPurpose === 'source') {
        const source = selected[0]
        if (source && onSelectVideo) {
          void onSelectVideo(source.url).catch((error) => {
            message.error(
              `切换源视频失败：${error instanceof Error ? error.message : String(error)}`,
            )
          })
        }
        return
      }
      handleAddResourcesFromProps(selected)
    },
    [canvasPickerPurpose, handleAddResourcesFromProps, onSelectVideo],
  )

  const handlePickerCancel = useCallback(() => {
    setCanvasPickerOpen(false)
    setCanvasPickerCandidates([])
  }, [])

  // 「添加资源」Dropdown 的菜单项：依赖稳定时一次性计算，避免每次 render 重建数组对象
  const addResourceMenuItems = useMemo<NonNullable<MenuProps['items']>>(() => {
    const items: NonNullable<MenuProps['items']> = []
    if (onAddLocalResources) {
      items.push({
        key: 'resource-from-file',
        icon: <Icons.FolderPlus size={14} />,
        label: '从本机添加资源',
        onClick: () => {
          setActiveTab('resources')
          void handlePickLocal()
        },
      })
    }
    if (onPickCanvasResources) {
      items.push({
        key: 'resource-from-canvas',
        icon: <Icons.Canvas size={14} />,
        label: '从画布选择资源',
        onClick: () => {
          setActiveTab('resources')
          void handlePickCanvas()
        },
      })
    }
    if (onCollectUpstream) {
      items.push({ type: 'divider' })
      items.push({
        key: 'resource-collect-upstream',
        icon: <Icons.Link size={14} />,
        label: '按上级连线自动收集',
        onClick: () => {
          setActiveTab('resources')
          void handleCollectUpstream()
        },
      })
    }
    if (onAddVideo || (onSelectVideo && videoNodes && videoNodes.length > 0)) {
      items.push({ type: 'divider' })
      if (onAddVideo) {
        items.push({
          key: 'video-from-file',
          icon: <Icons.Film size={14} />,
          label: '从本机设置主视频',
          onClick: () => void onAddVideo(),
        })
      }
      if (onSelectVideo && videoNodes && videoNodes.length > 0) {
        items.push({
          key: 'video-source-from-canvas',
          icon: <Icons.Film size={14} />,
          label: '从画布设置主视频…',
          onClick: handlePickSourceVideo,
        })
      }
    }
    return items
  }, [
    onAddLocalResources,
    onPickCanvasResources,
    onCollectUpstream,
    onAddVideo,
    onSelectVideo,
    videoNodes,
    handlePickLocal,
    handlePickCanvas,
    handlePickSourceVideo,
    handleCollectUpstream,
  ])
  // 播放器快捷键：Space 播放/暂停、←/→ 逐帧、Shift+←/→ 5s 跳转、Home 回到开头、Esc 关闭。
  // 守卫：输入框 / 下拉菜单聚焦时不拦截。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (cropMode) {
          handleCancelCrop()
          return
        }
        onClose()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const inEditable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest(
            '.ant-select, .ant-dropdown-menu, [role="combobox"], [contenteditable="true"]',
          ) != null)
      if (inEditable) return
      const inSingleTimeline = !!target?.closest('.vwb-timeline')
      if (inSingleTimeline) return

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        handlePlayToggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (e.shiftKey) seekRelative(-5)
        else stepFrame(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.shiftKey) seekRelative(5)
        else stepFrame(1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        handleToStart()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    open,
    onClose,
    cropMode,
    handleCancelCrop,
    handlePlayToggle,
    stepFrame,
    handleToStart,
    seekRelative,
  ])

  const handleSaveAndClose = useCallback(async () => {
    if (projectReadOnly) {
      message.error('该工程来自更高版本，当前版本不能覆盖保存')
      return
    }
    setSavingDraft(true)
    try {
      let nextProject = project
      if (
        onMaterializeOutput &&
        isLegacyVideoWorkbenchExportCompatible(project) &&
        trackNeedsMaterialization(draft.track)
      ) {
        setBusy(true)
        try {
          const output = await exportTrackOutput(draft.track)
          if (!output) throw new Error('当前轨道没有可保存的视频')
          const materialized = await onMaterializeOutput(output, 'add')
          const nextOutput = materialized
            ? {
                ...output,
                canvasNodeId: materialized.nodeId,
                outputPath: materialized.outputPath,
                outputUrl: materialized.outputUrl,
              }
            : output
          nextProject = {
            ...project,
            outputs: [nextOutput, ...project.outputs].slice(0, 20),
            ui: { ...project.ui, activeTab: 'output' },
          }
          updateProject(() => nextProject)
        } finally {
          setBusy(false)
        }
      }
      await saveProjectNow(nextProject)
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存视频工作台失败')
    } finally {
      setSavingDraft(false)
    }
  }, [
    draft.track,
    exportTrackOutput,
    onClose,
    onMaterializeOutput,
    project,
    projectReadOnly,
    saveProjectNow,
    updateProject,
  ])

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
            {(onAddVideo ||
              (onSelectVideo && videoNodes && videoNodes.length > 0) ||
              onAddLocalResources ||
              onPickCanvasResources ||
              onCollectUpstream) && (
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                overlayClassName="vwb-add-resource-menu"
                menu={{ items: addResourceMenuItems }}
              >
                <Button
                  size="small"
                  type={draft.resourcePanel.length === 0 ? 'primary' : 'default'}
                  icon={<Icons.Video size={14} />}
                  disabled={projectReadOnly}
                >
                  添加资源
                </Button>
              </Dropdown>
            )}
            <Button
              size="small"
              type="primary"
              loading={savingDraft}
              disabled={busy || projectReadOnly}
              onClick={() => void handleSaveAndClose()}
              icon={<Icons.Check size={14} />}
            >
              保存并关闭
            </Button>
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
        {projectIssues.length > 0 && (
          <div
            className="vwb-project-warning"
            title={projectIssues.join('\n')}
            role={projectReadOnly ? 'alert' : 'status'}
          >
            <Icons.AlertTriangle size={15} />
            <span>
              {projectReadOnly
                ? '该工程版本高于当前客户端，已进入只读保护，避免覆盖新格式数据。'
                : `工程读取时发现 ${projectIssues.length} 处异常引用，数据已保留并可继续修复。`}
            </span>
          </div>
        )}

        {/* ── 主体 ── */}
        <div className="vwb-body">
          {/* 左侧：视频预览 + 时间线 */}
          <div className="vwb-preview-pane">
            <div ref={videoStageRef} className="vwb-video-stage">
              {selectedResource && (
                <div className="vwb-preview-meta">
                  <Icons.Eye size={12} />
                  <span>预览资源：{selectedResource.title}</span>
                  <Button size="small" type="text" onClick={() => setSelectedResourceId(null)}>
                    返回主源
                  </Button>
                </div>
              )}
              {previewUrl && previewKind === 'video' ? (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  preload="metadata"
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime
                    // 连播模式下 currentTime 无人消费（控件显示 playbackGlobalTime、
                    // 编辑轨道读取 playbackGlobalTime，跳过 setCurrentTime 避免一次全量 re-render；
                    // 只把时间转发给连播状态机驱动播放头。
                    if (isPlayback) playbackOnTimeUpdate(t)
                    else setCurrentTime(t)
                  }}
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration
                    if (Number.isFinite(d) && d > 0) setVideoMetaDuration(d)
                    if (e.currentTarget.videoWidth > 0 && e.currentTarget.videoHeight > 0) {
                      setVideoMetaSize({
                        width: e.currentTarget.videoWidth,
                        height: e.currentTarget.videoHeight,
                      })
                    }
                    if (cropMode) requestAnimationFrame(updateCropMediaBounds)
                  }}
                  onPlay={playbackOnPlay}
                  onPause={playbackOnPause}
                  onEnded={isPlayback ? playbackOnEnded : undefined}
                  className="vwb-video"
                />
              ) : previewUrl && previewKind === 'image' ? (
                <img
                  src={previewUrl}
                  alt={selectedResource?.title ?? ''}
                  className="vwb-video"
                  style={{ objectFit: 'contain' }}
                />
              ) : previewUrl && previewKind === 'audio' ? (
                <div className="vwb-audio-preview">
                  <Icons.AudioLines size={42} />
                  <strong>{selectedResource?.title ?? '音频素材'}</strong>
                  <audio src={previewUrl} controls preload="metadata" />
                </div>
              ) : (
                <div className="vwb-video-empty">
                  <Icons.Film size={48} />
                  <span>未关联视频</span>
                </div>
              )}
              {cropMode && cropMediaBounds && previewKind === 'video' && !isPlayback && (
                <VideoCropOverlay
                  bounds={cropMediaBounds}
                  rect={cropRect}
                  sourceWidth={probe?.width ?? videoMetaSize?.width ?? 0}
                  sourceHeight={probe?.height ?? videoMetaSize?.height ?? 0}
                  busy={busy}
                  onConfirm={(selection) => void handleConfirmCrop(selection)}
                  onCancel={handleCancelCrop}
                />
              )}
            </div>

            {/* 自定义播放控制条（连播 / 单独预览 / 源视频共用） */}
            {previewUrl && (
              <div className="vwb-player-controls">
                <button
                  className="vwb-player-btn"
                  onClick={() => stepFrame(-1)}
                  disabled={previewKind !== 'video'}
                  aria-label="上一帧"
                  title="上一帧（←）"
                >
                  <Icons.ChevronLeft size={16} />
                </button>
                <button
                  className="vwb-player-btn vwb-player-play"
                  onClick={handlePlayToggle}
                  disabled={!isPlayback && previewKind !== 'video'}
                  aria-label={playbackPlaying ? '暂停' : '播放'}
                  title={playbackPlaying ? '暂停（空格）' : '播放（空格）'}
                >
                  {playbackPlaying ? <Icons.Pause size={18} /> : <Icons.Play size={18} />}
                </button>
                <button
                  className="vwb-player-btn"
                  onClick={() => stepFrame(1)}
                  disabled={previewKind !== 'video'}
                  aria-label="下一帧"
                  title="下一帧（→）"
                >
                  <Icons.ChevronRight size={16} />
                </button>
                <button
                  className="vwb-player-btn"
                  onClick={() => void handleCaptureCurrentFrame()}
                  disabled={previewKind !== 'video' || busy || ffmpegReady !== true}
                  aria-label="截取当前帧"
                  title="截取当前帧到关键帧列表"
                >
                  <Icons.Camera size={15} />
                </button>
                <span className="vwb-player-time">
                  {formatTimestamp(isPlayback ? playbackGlobalTime : currentTime)}
                </span>
                <span className="vwb-player-divider">/</span>
                <span className="vwb-player-duration">
                  {formatTimestamp(isPlayback ? playbackTotal : duration)}
                </span>
                <Dropdown
                  menu={{
                    items: PLAYBACK_RATES.map((rate) => ({
                      key: String(rate),
                      label: formatPlaybackRate(rate),
                    })),
                    selectedKeys: [String(playbackRate)],
                    onClick: ({ key }) => setPlaybackRate(Number(key)),
                  }}
                  trigger={['click']}
                >
                  <button
                    className="vwb-player-btn vwb-player-rate"
                    aria-label="播放速率"
                    title="播放速率（含慢放）"
                  >
                    {formatPlaybackRate(playbackRate)}
                  </button>
                </Dropdown>
                {selectedClip ? (
                  <div className="vwb-player-clip-actions" aria-label="分段操作">
                    <span className="vwb-player-clip-label">
                      {selectedClipIds.length > 1
                        ? `主选分段 · 共 ${selectedClipIds.length} 段`
                        : '已选分段'}
                    </span>
                    <button
                      className="vwb-player-btn"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDuplicateClip(selectedClip.id)
                      }}
                      disabled={busy || projectReadOnly}
                      aria-label="复制选中的分段"
                      title="复制选中的分段"
                    >
                      <Icons.Copy size={14} />
                      <span>复制</span>
                    </button>
                    <button
                      className="vwb-player-btn"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleMaterializeClip(selectedClip, 'add')
                      }}
                      disabled={busy || !onMaterializeOutput}
                      aria-label="将选中的分段添加到画布"
                      title="将选中的分段添加为新的画布视频节点"
                    >
                      <Icons.Plus size={14} />
                      <span>添加到画布</span>
                    </button>
                    <button
                      className="vwb-player-btn"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleMaterializeClip(selectedClip, 'replace')
                      }}
                      disabled={busy || !onMaterializeOutput}
                      aria-label="用选中的分段替换当前视频"
                      title="用选中的分段替换当前视频节点"
                    >
                      <Icons.Refresh size={14} />
                      <span>替换当前</span>
                    </button>
                    <button
                      className="vwb-player-btn vwb-player-btn-danger"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRemoveClip(selectedClip.id)
                      }}
                      disabled={busy || projectReadOnly}
                      aria-label="删除选中的分段"
                      title="删除选中的分段"
                    >
                      <Icons.Trash size={14} />
                      <span>删除</span>
                    </button>
                  </div>
                ) : null}
                <div className="vwb-player-spacer" />
                <button
                  className="vwb-player-btn"
                  onClick={handleToStart}
                  aria-label="回到开头"
                  title="回到开头（Home）"
                >
                  <Icons.RotateCcw size={14} />
                </button>
              </div>
            )}

            <VideoWorkbenchMultiTrackTimeline
              project={project}
              busy={busy}
              readOnly={projectReadOnly}
              selectedClipIds={selectedClipIds}
              playheadSec={playbackGlobalTime}
              canUndo={canUndo}
              canRedo={canRedo}
              onSelectionChange={handleSelectClips}
              onPreviewResource={handlePreviewResource}
              onSeek={handlePlaybackSeek}
              onCommand={applyProjectCommand}
              onUpdateProject={updateProject}
              onUndo={undoProject}
              onRedo={redoProject}
              onOpenFrames={() => setActiveTab('frames')}
              onOpenEdit={() => setActiveTab('edit')}
              onOpenOutput={() => setActiveTab('output')}
            />
          </div>

          {/* 右侧：Tab 面板 */}
          <div className="vwb-side-pane">
            <div className="vwb-workflow-strip" aria-label="视频工作流">
              <span className={activeTab === 'resources' ? 'is-active' : ''}>00 资源</span>
              <Icons.ChevronRight size={13} />
              <span className={activeTab === 'frames' ? 'is-active' : ''}>01 素材分析</span>
              <Icons.ChevronRight size={13} />
              <span className={activeTab === 'edit' ? 'is-active' : ''}>02 剪辑处理</span>
              <Icons.ChevronRight size={13} />
              <span className={activeTab === 'output' ? 'is-active' : ''}>03 产物检查</span>
            </div>
            <Segmented
              value={activeTab}
              onChange={(v) => setActiveTab(v as 'resources' | 'frames' | 'edit' | 'output')}
              options={[
                { label: '资源', value: 'resources' },
                { label: '关键帧', value: 'frames' },
                { label: '剪辑', value: 'edit' },
                { label: '产物', value: 'output' },
              ]}
              block
              size="small"
            />

            {activeTab === 'resources' && (
              <VideoWorkbenchResourcePanel
                resources={draft.resourcePanel}
                track={draft.track}
                usedResourceIds={usedResourceIds}
                autoCollectUpstream={draft.autoCollectUpstream}
                busy={busy}
                readOnly={projectReadOnly}
                onAddToTrack={handleAddResourceToTrack}
                onPreview={handlePreviewResource}
                onRemoveResource={handleRemoveResource}
                onAutoCollectToggle={handleAutoCollectToggle}
                onCollectUpstream={() => void handleCollectUpstream()}
                onPickLocal={onAddLocalResources ? () => void handlePickLocal() : undefined}
                onPickCanvas={onPickCanvasResources ? () => void handlePickCanvas() : undefined}
                onResourceMeta={handleResourceMeta}
              />
            )}

            {activeTab === 'frames' && (
              <VideoWorkbenchFramePanel
                draft={draft}
                busy={busy || projectReadOnly}
                progress={progress}
                progressStage={progressStage}
                ffmpegReady={ffmpegReady}
                onExtract={extractKeyframes}
                onConfigChange={(cfg) => {
                  updateDraft((d) => ({ ...d, extractConfig: cfg }))
                }}
                onSeek={seekTo}
                onExport={handleExportKeyframes}
                onRemoveKeyframes={(indexes) => {
                  const indexesToRemove = new Set(indexes)
                  updateDraft((d) => ({
                    ...d,
                    keyframes: d.keyframes.filter(
                      (keyframe) => !indexesToRemove.has(keyframe.index),
                    ),
                  }))
                }}
              />
            )}

            {activeTab === 'edit' && (
              <VideoWorkbenchEditPanel
                probe={probe}
                busy={busy || projectReadOnly}
                progress={progress}
                ffmpegReady={ffmpegReady}
                probeFailed={probeFailed}
                fallbackDuration={videoMetaDuration}
                onProcess={handleProcess}
                onStartCrop={handleStartCrop}
                onOutput={recordOutput}
              />
            )}

            {activeTab === 'output' && (
              <VideoWorkbenchOutputPanel
                outputs={draft.outputs}
                trackLength={project.tracks.reduce((count, track) => count + track.clips.length, 0)}
                busy={busy || projectReadOnly}
                onExportTrack={() => void handleExportTrack()}
                onAddToCanvas={(output) => void handleMaterializeOutput(output, 'add')}
                onReplaceCurrent={(output) => void handleMaterializeOutput(output, 'replace')}
              />
            )}
          </div>
        </div>
      </div>
      {canvasPickerOpen && (
        <VideoWorkbenchResourcePicker
          open
          candidates={canvasPickerCandidates}
          selectionMode={canvasPickerPurpose === 'source' ? 'single' : 'multiple'}
          title={canvasPickerPurpose === 'source' ? '从画布设置主视频' : '从画布选择资源'}
          confirmLabel={canvasPickerPurpose === 'source' ? '设为主视频' : '加入资源面板'}
          onConfirm={handlePickerConfirm}
          onCancel={handlePickerCancel}
        />
      )}
    </div>
  )
}
