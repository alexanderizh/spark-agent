/**
 * useVideoWorkbenchPlayback — 多段轨道的"播放列表式连播"状态机。
 *
 * 为什么是"播放列表式"而非 ffmpeg 真拼接：
 *  - 预览场景要即时反馈，ffmpeg concat 有秒级延迟且依赖 ffmpeg 就绪，不适合预览。
 *  - 这里复用主预览区单个 <video> 元素：按 clip 顺序切换 src，播完一段自动进下一段；
 *    图片 clip 没有 video，用 setTimeout(staticDuration) 计时推进。
 *
 * 状态机：
 *  - active：是否进入连播模式（点过播放按钮 / 播放条 seek）。未 active 时主预览走原逻辑
 *    （单独预览 / 源视频），hook 不接管。
 *  - playing：同步自 video onPlay/onPause；图片 clip 时由计时器维持 true。
 *  - currentClipId / globalTimeSec：播放头位置。
 *
 * 与 Modal 的契约：
 *  - Modal 的 preview useMemo 在 active 时用 currentResource 覆盖 previewUrl。
 *  - Modal 的 <video> 把 onEnded/onTimeUpdate/onPlay/onPause 转发给本 hook（仅 active 时）。
 *  - 播放进度条 onSeek → seekToGlobal；播放按钮 → toggle。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { TrackClip, WorkbenchResource } from './videoWorkbench.types'
import {
  calculateTrackDuration,
  clipDurationSec,
  clipSeekTimeSec,
  clipStartSecInTrack,
  indexResourcesById,
  resolveClipAtGlobalTime,
} from './resourcePanelUtils'

interface Args {
  track: TrackClip[]
  resources: WorkbenchResource[]
  /** 主预览区 <video> 元素 ref（图片 clip 时不渲染，current 为 null） */
  videoRef: RefObject<HTMLVideoElement | null>
}

export function useVideoWorkbenchPlayback({ track, resources, videoRef }: Args) {
  const resourcesById = useMemo(() => indexResourcesById(resources), [resources])
  const sortedTrack = useMemo(() => track.slice().sort((a, b) => a.order - b.order), [track])
  const totalDurationSec = useMemo(
    () => calculateTrackDuration(sortedTrack, resourcesById),
    [sortedTrack, resourcesById],
  )

  const [active, setActive] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentClipId, setCurrentClipId] = useState<string | null>(null)
  const [globalTimeSec, setGlobalTimeSec] = useState(0)
  /** 保留用户的连续播放意图，避免切换 video src 触发的 pause 事件误停下一段。 */
  const playIntentRef = useRef(false)

  const currentClip = useMemo(
    () => (currentClipId ? (sortedTrack.find((c) => c.id === currentClipId) ?? null) : null),
    [sortedTrack, currentClipId],
  )
  const currentResource = currentClip ? resourcesById.get(currentClip.resourceId) : undefined
  const currentClipStartSec = useMemo(
    () => clipStartSecInTrack(sortedTrack, resourcesById, currentClipId),
    [sortedTrack, resourcesById, currentClipId],
  )

  // 切 clip 后要 seek 的目标偏移（clip 内相对），apply 后清空
  const pendingSeekRef = useRef<number | null>(null)

  const seekToGlobal = useCallback(
    (sec: number, autoPlay = false) => {
      const target = resolveClipAtGlobalTime(sortedTrack, resourcesById, sec)
      if (!target) return
      setActive(true)
      if (autoPlay) {
        playIntentRef.current = true
        setPlaying(true)
      }
      if (target.clip.id !== currentClipId) {
        setCurrentClipId(target.clip.id)
        pendingSeekRef.current = target.offsetSec
      } else {
        const v = videoRef.current
        if (v) v.currentTime = clipSeekTimeSec(target.clip, target.offsetSec)
      }
      setGlobalTimeSec(sec)
    },
    [currentClipId, resourcesById, sortedTrack, videoRef],
  )

  const playFromStart = useCallback(() => {
    if (sortedTrack.length === 0) return false
    seekToGlobal(0, true)
    return true
  }, [seekToGlobal, sortedTrack.length])

  const toggle = useCallback(() => {
    if (!active) {
      playFromStart()
      return
    }
    setPlaying((current) => {
      playIntentRef.current = !current
      return !current
    })
  }, [active, playFromStart])

  const exit = useCallback(() => {
    playIntentRef.current = false
    setActive(false)
    setPlaying(false)
  }, [])

  // video 事件转发 ────────────────────────────────────────────────────
  // video.currentTime 是原视频绝对时间；clip 内偏移 = currentTime - range.startSec；
  // 全局时间 = currentClipStartSec + clip 内偏移。
  const advanceToNextClip = useCallback(() => {
    const idx = sortedTrack.findIndex((clip) => clip.id === currentClipId)
    const next = idx >= 0 ? sortedTrack[idx + 1] : undefined
    if (next) {
      setCurrentClipId(next.id)
      pendingSeekRef.current = 0
      setGlobalTimeSec(clipStartSecInTrack(sortedTrack, resourcesById, next.id))
      return
    }
    playIntentRef.current = false
    setPlaying(false)
  }, [currentClipId, resourcesById, sortedTrack])

  const handleVideoTimeUpdate = useCallback(
    (currentTime: number) => {
      const rangeStart = currentClip?.range?.startSec ?? 0
      const rangeEnd = currentClip?.range?.endSec
      if (rangeEnd != null && currentTime >= rangeEnd - 0.02) {
        advanceToNextClip()
        return
      }
      const duration = clipDurationSec(currentClip ?? undefined, currentResource)
      const offset = Math.min(duration, Math.max(0, currentTime - rangeStart))
      setGlobalTimeSec(currentClipStartSec + offset)
    },
    [advanceToNextClip, currentClip, currentClipStartSec, currentResource],
  )

  const handleVideoEnded = useCallback(() => {
    if (!active) return
    advanceToNextClip()
  }, [active, advanceToNextClip])

  const handleVideoPlay = useCallback(() => {
    if (!active || playIntentRef.current) setPlaying(true)
  }, [active])
  const handleVideoPause = useCallback(() => {
    if (!playIntentRef.current) setPlaying(false)
  }, [])

  // 切 clip 后 seek + play/pause（仅视频 clip；图片 clip 时 video 不渲染）
  useEffect(() => {
    if (!active || !currentClip) return
    const v = videoRef.current
    if (!v) return
    const resource = resourcesById.get(currentClip.resourceId)
    if (!resource || resource.kind !== 'video') return
    const apply = () => {
      if (pendingSeekRef.current != null) {
        v.currentTime = clipSeekTimeSec(currentClip, pendingSeekRef.current)
        pendingSeekRef.current = null
      }
      if (playing) void v.play().catch(() => {})
      else v.pause()
    }
    if (v.readyState >= 1 && v.getAttribute('src')) {
      apply()
      return
    }
    const handler = () => apply()
    v.addEventListener('loadedmetadata', handler, { once: true })
    return () => v.removeEventListener('loadedmetadata', handler)
  }, [active, currentClip, currentClipId, playing, resourcesById, videoRef])

  // 图片 clip 计时器推进（仅图片 clip）
  useEffect(() => {
    if (!active || !playing || !currentClip || !currentResource) return
    if (currentResource.kind !== 'image') return
    const dur = clipDurationSec(currentClip, currentResource)
    const offsetInClip = Math.max(0, globalTimeSec - currentClipStartSec)
    const remainingMs = Math.max(50, (dur - offsetInClip) * 1000)
    const timer = setTimeout(() => {
      advanceToNextClip()
    }, remainingMs)
    return () => clearTimeout(timer)
  }, [
    active,
    advanceToNextClip,
    currentClip,
    currentClipStartSec,
    currentResource,
    globalTimeSec,
    playing,
  ])

  // track 清空时退出连播
  useEffect(() => {
    if (active && sortedTrack.length === 0) {
      playIntentRef.current = false
      setActive(false)
      setPlaying(false)
      setCurrentClipId(null)
    }
  }, [active, sortedTrack.length])

  return {
    active,
    playing,
    currentClipId,
    currentClip,
    currentResource,
    globalTimeSec,
    totalDurationSec,
    sortedTrack,
    seekToGlobal,
    playFromStart,
    toggle,
    exit,
    handleVideoTimeUpdate,
    handleVideoEnded,
    handleVideoPlay,
    handleVideoPause,
  }
}
