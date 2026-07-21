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
import type { MenuProps } from 'antd'
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
import { VideoWorkbenchResourcePanel } from './VideoWorkbenchResourcePanel'
import { VideoWorkbenchTrackTimeline } from './VideoWorkbenchTrackTimeline'
import { VideoWorkbenchOutputPanel } from './VideoWorkbenchOutputPanel'
import type { ThumbnailMeta } from './VideoWorkbenchResourceThumb'
import { VideoWorkbenchResourcePicker } from './VideoWorkbenchResourcePicker'
import { useVideoWorkbenchPlayback } from './useVideoWorkbenchPlayback'
import {
  indexResourcesById,
  insertResourceIntoTrack,
  mergeResources,
  removeTrackClip,
  resolveClipAtGlobalTime,
  shouldSeedSourceTrack,
  splitTrackClip,
} from './resourcePanelUtils'
import type { TrackClip, WorkbenchResource } from './videoWorkbench.types'
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

/** 父级支持的"从画布选择资源"输入（含图片 + 视频） */
export interface CanvasResourceOption {
  id: string
  title: string
  url: string
  kind: 'video' | 'image'
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
  kind: 'video' | 'image'
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
  onSave: (data: VideoWorkbenchData) => Promise<void>
  /** 把关键帧导出为画布图片节点 */
  onExportKeyframes?: (frames: WorkbenchKeyframe[], sourceNodeId: string) => Promise<void>
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

/** 持久化防抖窗口（毫秒）。拖拽重排 / 加 mark 这类高频操作会被合并为一次 onSave。 */
const PERSIST_DEBOUNCE_MS = 300

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
}: Props): ReactElement | null {
  // 惰性初始化：只在 mount 时跑一次 readVideoWorkbenchData，避免每次 re-render 都重跑校验。
  // Modal 在父级用 key={node.id} 绑定节点，切换节点会完整 remount，所以这里不需要额外重置 draft。
  const [draft, setDraft] = useState<VideoWorkbenchData>(() =>
    node?.data?.videoWorkbench
      ? readVideoWorkbenchData(node.data.videoWorkbench as Record<string, unknown>)
      : createDefaultVideoWorkbenchData(),
  )
  const [activeTab, setActiveTab] = useState<'resources' | 'frames' | 'edit' | 'output'>(
    draft.activeTab === 'frames' ||
      draft.activeTab === 'edit' ||
      draft.activeTab === 'output' ||
      draft.activeTab === 'resources'
      ? draft.activeTab
      : 'resources',
  )
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
  /** video 元素的 duration（probe 失败时兜底用） */
  const [videoMetaDuration, setVideoMetaDuration] = useState(0)
  /** 当前播放位置（秒），用于手动标记 */
  const [currentTime, setCurrentTime] = useState(0)
  /** 资源面板当前选中的资源 id（用于在主预览区单独预览） */
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
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
    active: playbackActive,
    globalTimeSec: playbackGlobalTime,
    totalDurationSec: playbackTotal,
    currentClipId: playbackCurrentClipId,
  } = playback

  const probe = draft.probeInfo
  const duration = probe?.durationSec ?? videoMetaDuration ?? 0
  // ── 检测 ffmpeg 可用性 ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    void window.spark
      .invoke('ffmpeg:status', {})
      .then((s: { ffmpegReady: boolean }) => setFfmpegReady(s.ffmpegReady))
      .catch(() => setFfmpegReady(false))
  }, [open])

  // ── 防抖持久化：draft 变化时合并为一次 onSave ──────────────────────
  // 关键点：
  //  - setDraft 的 updater 必须是纯函数，不能塞 IPC 副作用
  //  - unmount / open 关闭时强制 flush 一次，避免最后一次改动丢失
  //  - 跳过首次 mount（draft 与已持久化数据一致，不重复写）
  const isFirstRenderRef = useRef(true)
  const pendingDraftRef = useRef<VideoWorkbenchData | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])
  const flushSave = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (pendingDraftRef.current) {
      const next = pendingDraftRef.current
      pendingDraftRef.current = null
      void onSaveRef.current(next)
    }
  }, [])
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    pendingDraftRef.current = draft
    if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(flushSave, PERSIST_DEBOUNCE_MS)
    return () => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [draft, flushSave])
  // open 转 false（父级把 videoWorkbenchNode 设回 null → key 变化导致 unmount）时 flush 兜底
  useEffect(() => {
    if (open) return
    flushSave()
    return flushSave
  }, [open, flushSave])
  // 组件卸载（key 变化时也会触发）再 flush 一次，最后一道防线
  useEffect(() => flushSave, [flushSave])

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

  const probeAndUpdate = useCallback(async (n: CanvasNode) => {
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
        setDraft((d) => ({ ...d, probeInfo }))
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
  }, [])

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
          setDraft((d) => ({ ...d, keyframes: frames }))
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
    [node, probe, extractConfig],
  )

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

  /** 播放条 seek：若正在单独预览某资源，自动切回连播模式（点播放控件 = 想看整条） */
  const handlePlaybackSeek = useCallback(
    (sec: number) => {
      if (selectedResourceId) setSelectedResourceId(null)
      playbackSeek(sec)
    },
    [selectedResourceId, playbackSeek],
  )

  /** 播放条播放按钮：同上，自动退出单独预览 */
  const handlePlaybackToggle = useCallback(() => {
    if (selectedResourceId) setSelectedResourceId(null)
    playbackToggle()
  }, [selectedResourceId, playbackToggle])

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
        return { ...d, outputs, activeTab: 'output' as const }
      })
    },
    [],
  )

  const recordOutput = useCallback(
    (summary: string, outputPath: string, type: WorkbenchOutput['type']) => {
      recordOutputs([{ summary, outputPath, type }])
    },
    [recordOutputs],
  )

  // ── 资源面板 / 多段轨道 handlers ───────────────────────────────
  // updater 必须是纯函数（无 IPC 副作用）；持久化由 useEffect 防抖接管
  const updateDraft = useCallback((updater: (d: VideoWorkbenchData) => VideoWorkbenchData) => {
    setDraft((d) => updater(d))
  }, [])

  // 旧工作台把 node.data.url 放在独立单视频时间线；首次打开时迁入统一资源轨道。
  // 工作台保持打开时若切换源视频，父级会重置持久化数据，这里同步重置本地 draft，
  // 避免防抖保存把旧轨道重新写回节点。
  useEffect(() => {
    if (!sourceVideoUrl || seededSourceUrlRef.current === sourceVideoUrl) return
    const sourceChanged = seededSourceUrlRef.current !== ''
    seededSourceUrlRef.current = sourceVideoUrl
    updateDraft((current) => {
      const resourceId = `source:${node?.id ?? 'video'}`
      const persistedSource = current.resourcePanel.find((resource) => resource.id === resourceId)
      const sourceResource: WorkbenchResource = {
        id: resourceId,
        source: 'canvas',
        kind: 'video',
        title: node?.title?.replace(/^视频工作台\s*[—-]?\s*/, '') || '源视频',
        url: sourceVideoUrl,
        originPath: resolveDiskPath(sourceVideoUrl) || sourceVideoUrl,
        importedAt: Date.now(),
      }
      if (sourceChanged || (persistedSource != null && persistedSource.url !== sourceVideoUrl)) {
        const reset = createDefaultVideoWorkbenchData()
        return {
          ...reset,
          resourcePanel: [sourceResource],
          track: insertResourceIntoTrack([], sourceResource),
        }
      }
      if (!shouldSeedSourceTrack(current.track, current.resourcePanel, resourceId)) return current
      const resourcePanel = mergeResources(current.resourcePanel, [sourceResource])
      return {
        ...current,
        resourcePanel,
        track: insertResourceIntoTrack([], sourceResource),
      }
    })
  }, [node?.id, node?.title, sourceVideoUrl, updateDraft])

  const handleAddResourceToTrack = useCallback(
    (resource: WorkbenchResource, insertAfterClipId?: string | null) => {
      updateDraft((d) => ({
        ...d,
        track: insertResourceIntoTrack(d.track, resource, insertAfterClipId),
      }))
    },
    [updateDraft],
  )

  const handleReorderTrack = useCallback(
    (nextTrack: TrackClip[]) => {
      updateDraft((d) => ({ ...d, track: nextTrack }))
    },
    [updateDraft],
  )

  const handleRemoveClip = useCallback(
    (clipId: string) => {
      updateDraft((d) => ({ ...d, track: removeTrackClip(d.track, clipId) }))
    },
    [updateDraft],
  )

  const handleClearTrack = useCallback(() => {
    updateDraft((d) => ({ ...d, track: [] }))
  }, [updateDraft])

  const handleTrackDurationChange = useCallback(
    (clipId: string, nextDuration: number) => {
      updateDraft((current) => {
        const resources = indexResourcesById(current.resourcePanel)
        return {
          ...current,
          track: current.track.map((clip) => {
            if (clip.id !== clipId) return clip
            const resource = resources.get(clip.resourceId)
            if (resource?.kind === 'image') return { ...clip, staticDuration: nextDuration }
            const startSec = clip.range?.startSec ?? 0
            const maxEnd = resource?.durationSec ?? startSec + nextDuration
            return {
              ...clip,
              range: { startSec, endSec: Math.min(maxEnd, startSec + nextDuration) },
            }
          }),
        }
      })
    },
    [updateDraft],
  )

  const handleSplitTrackAtPlayhead = useCallback(() => {
    const resources = indexResourcesById(draft.resourcePanel)
    const resolved = resolveClipAtGlobalTime(draft.track, resources, playbackGlobalTime)
    if (!resolved) return
    const nextTrack = splitTrackClip(draft.track, resources, resolved.clip.id, resolved.offsetSec)
    if (nextTrack.length === draft.track.length) {
      message.info('请把播放头移到片段内部后再分割')
      return
    }
    handleReorderTrack(nextTrack)
  }, [draft.resourcePanel, draft.track, handleReorderTrack, playbackGlobalTime])

  const handleExportWhole = useCallback(() => {
    if (draft.track.length === 0) {
      message.warning('请先把资源加入轨道再导出整条')
      return
    }
    // P1：UI 入口已就位；真实 ffmpeg concat 流程由父级 / IPC 在后续 P2 接入
    message.info('导出整条需要 ffmpeg concat 流程（P2 任务），当前为占位')
  }, [draft.track.length])

  const handlePreviewResource = useCallback(
    (resource: WorkbenchResource) => {
      playbackExit()
      setSelectedResourceId(resource.id)
    },
    [playbackExit],
  )

  const handleRemoveResource = useCallback(
    (resourceId: string) => {
      updateDraft((d) => ({
        ...d,
        resourcePanel: d.resourcePanel.filter((r) => r.id !== resourceId),
        // 同时从轨道中清理引用了该资源的 clip
        track: d.track.filter((c) => c.resourceId !== resourceId),
      }))
    },
    [updateDraft],
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
    const entries = Array.from(buffer.entries())
    buffer.clear()
    updateDraft((d) => {
      let changed = false
      const resourcePanel = d.resourcePanel.map((r) => {
        const entry = entries.find(([id]) => id === r.id)
        if (!entry) return r
        const meta = entry[1]
        const durationSec = r.durationSec ?? meta.durationSec
        const width = r.width ?? meta.width
        const height = r.height ?? meta.height
        if (durationSec === r.durationSec && width === r.width && height === r.height) return r
        changed = true
        return {
          ...r,
          ...(durationSec !== undefined ? { durationSec } : {}),
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        }
      })
      return changed ? { ...d, resourcePanel } : d
    })
  }, [updateDraft])
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
        label: '📁 从本机添加资源',
        onClick: () => {
          setActiveTab('resources')
          void handlePickLocal()
        },
      })
    }
    if (onPickCanvasResources) {
      items.push({
        key: 'resource-from-canvas',
        label: '🖼️ 从画布选择资源',
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
        label: '🔗 按上级连线自动收集',
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
          label: '🎬 从本机设置主视频',
          onClick: () => void onAddVideo(),
        })
      }
      if (onSelectVideo && videoNodes && videoNodes.length > 0) {
        items.push({
          key: 'video-source-from-canvas',
          label: '🎬 从画布设置主视频…',
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
  }, [open, onClose, handlePlayToggle, stepFrame, handleToStart, seekRelative])

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
                >
                  添加资源
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
              ) : (
                <div className="vwb-video-empty">
                  <Icons.Film size={48} />
                  <span>未关联视频</span>
                </div>
              )}
            </div>

            {/* 自定义播放控制条（连播 / 单独预览 / 源视频共用） */}
            {previewUrl && (
              <div className="vwb-player-controls">
                <button
                  className="vwb-player-btn"
                  onClick={() => stepFrame(-1)}
                  disabled={previewKind !== 'video'}
                  title="上一帧（←）"
                >
                  <Icons.ChevronLeft size={16} />
                </button>
                <button
                  className="vwb-player-btn vwb-player-play"
                  onClick={handlePlayToggle}
                  disabled={!isPlayback && previewKind !== 'video'}
                  title={playbackPlaying ? '暂停（空格）' : '播放（空格）'}
                >
                  {playbackPlaying ? <Icons.Pause size={18} /> : <Icons.Play size={18} />}
                </button>
                <button
                  className="vwb-player-btn"
                  onClick={() => stepFrame(1)}
                  disabled={previewKind !== 'video'}
                  title="下一帧（→）"
                >
                  <Icons.ChevronRight size={16} />
                </button>
                <span className="vwb-player-time">
                  {formatTimestamp(isPlayback ? playbackGlobalTime : currentTime)}
                </span>
                <span className="vwb-player-divider">/</span>
                <span className="vwb-player-duration">
                  {formatTimestamp(isPlayback ? playbackTotal : duration)}
                </span>
                <div className="vwb-player-spacer" />
                <button className="vwb-player-btn" onClick={handleToStart} title="回到开头（Home）">
                  <Icons.RotateCcw size={14} />
                </button>
              </div>
            )}

            {/* 唯一主编辑轨道：多资源拼接、播放、排序、切分与时长调整 */}
            <VideoWorkbenchTrackTimeline
              track={draft.track}
              resources={draft.resourcePanel}
              busy={busy}
              onReorder={handleReorderTrack}
              onRemoveClip={handleRemoveClip}
              onPreviewResource={handlePreviewResource}
              onAddResourceToTrack={handleAddResourceToTrack}
              onExportWhole={handleExportWhole}
              onClearTrack={handleClearTrack}
              onOpenFrames={() => setActiveTab('frames')}
              onOpenEdit={() => setActiveTab('edit')}
              onOpenOutput={() => setActiveTab('output')}
              onSplitAtPlayhead={handleSplitTrackAtPlayhead}
              onDurationChange={handleTrackDurationChange}
              playback={{
                active: playbackActive,
                playing: playbackPlaying,
                currentClipId: playbackCurrentClipId,
                globalTimeSec: playbackGlobalTime,
                totalDurationSec: playbackTotal,
              }}
              onPlaybackSeek={handlePlaybackSeek}
              onPlaybackToggle={handlePlaybackToggle}
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
                autoCollectUpstream={draft.autoCollectUpstream}
                busy={busy}
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
                busy={busy}
                progress={progress}
                progressStage={progressStage}
                ffmpegReady={ffmpegReady}
                onExtract={extractKeyframes}
                onConfigChange={(cfg) => {
                  setDraft((d) => ({ ...d, extractConfig: cfg }))
                }}
                onSeek={seekTo}
                onExport={handleExportKeyframes}
                onRemoveKeyframe={(idx) => {
                  setDraft((d) => ({ ...d, keyframes: d.keyframes.filter((k) => k.index !== idx) }))
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

            {activeTab === 'output' && <VideoWorkbenchOutputPanel outputs={draft.outputs} />}
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
