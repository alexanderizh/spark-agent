/**
 * 画布自研视频播放器的状态机 hook。
 *
 * 职责：持有 <video> 的播放态并暴露命令式操作（播放/暂停/seek/逐帧/倍速/音量/循环）。
 * 不渲染任何 UI，档位适配与自动隐藏控制条由 CanvasVideoPlayer 组件负责。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { VIDEO_PLAYER_FRAME_SEC, clampVideoPlayerValue } from './videoPlayerFormat'

export type VideoPlayerPlaybackState = 'unready' | 'playing' | 'paused' | 'ended'

export type UseVideoPlayerControllerResult = {
  playback: VideoPlayerPlaybackState
  currentTime: number
  duration: number
  /** 已缓冲区间末端（秒），用于进度条缓冲指示。 */
  bufferedEnd: number
  volume: number
  muted: boolean
  rate: number
  loop: boolean
  /** metadata 已加载（duration 可用）。 */
  ready: boolean
  /** 资源加载失败（进入终态，换 src 由上层重挂载）。 */
  failed: boolean
  togglePlay: () => void
  play: () => void
  pause: () => void
  seek: (seconds: number) => void
  /** 逐帧步进：direction 为 -1（上一帧）/ +1（下一帧），步进前会先暂停。 */
  stepFrame: (direction: -1 | 1) => void
  changeRate: (rate: number) => void
  changeVolume: (volume: number) => void
  toggleMuted: () => void
  toggleLoop: () => void
  /** 进度条拖动期间暂停 timeupdate 回写，避免拖动手感抖动。 */
  scrubbing: () => void
  scrubbingEnd: () => void
  /** 事件桥：绑定到 <video> 的 React 事件回调。 */
  handlers: {
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onLoadedData: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onTimeUpdate: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onDurationChange: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onProgress: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onPlay: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onPause: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onEnded: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onVolumeChange: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onRateChange: (event: React.SyntheticEvent<HTMLVideoElement>) => void
    onError: (event: React.SyntheticEvent<HTMLVideoElement>) => void
  }
}

export function useVideoPlayerController(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
): UseVideoPlayerControllerResult {
  const [playback, setPlayback] = useState<VideoPlayerPlaybackState>('unready')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRateState] = useState(1)
  const [loop, setLoop] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // 拖动进度条时暂停 timeupdate 回写，避免拖动手感抖动；pointerup 后再放行。
  const scrubbingRef = useRef(false)
  const scrubbing = useCallback(() => {
    scrubbingRef.current = true
  }, [])
  const scrubbingEnd = useCallback(() => {
    scrubbingRef.current = false
  }, [])

  const readBufferedEnd = useCallback((video: HTMLVideoElement) => {
    const ranges = video.buffered
    if (ranges.length <= 0) return
    // 取覆盖当前播放位置的缓冲区间；取不到就取最后一段的末端。
    let end = ranges.end(ranges.length - 1)
    for (let index = 0; index < ranges.length; index += 1) {
      if (video.currentTime >= ranges.start(index) && video.currentTime <= ranges.end(index)) {
        end = ranges.end(index)
        break
      }
    }
    setBufferedEnd((prev) => (end > prev ? end : prev))
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !ready) return
    if (video.paused || video.ended) {
      void video.play().catch(() => {
        // 自动播放策略或解码失败：保持 paused 状态即可，UI 与实际态一致。
      })
    } else {
      video.pause()
    }
  }, [ready, videoRef])

  const play = useCallback(() => {
    const video = videoRef.current
    if (!video || (!video.paused && !video.ended)) return
    void video.play().catch(() => undefined)
  }, [videoRef])

  const pause = useCallback(() => {
    videoRef.current?.pause()
  }, [videoRef])

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current
      if (!video || !ready) return
      const target = clampVideoPlayerValue(seconds, 0, video.duration || seconds)
      video.currentTime = target
      setCurrentTime(target)
    },
    [ready, videoRef],
  )

  const stepFrame = useCallback(
    (direction: -1 | 1) => {
      const video = videoRef.current
      if (!video || !ready) return
      video.pause()
      const max = video.duration || 0
      const target = clampVideoPlayerValue(
        video.currentTime + direction * VIDEO_PLAYER_FRAME_SEC,
        0,
        max,
      )
      video.currentTime = target
      setCurrentTime(target)
    },
    [ready, videoRef],
  )

  const changeRate = useCallback(
    (next: number) => {
      const video = videoRef.current
      if (!video) return
      const value = clampVideoPlayerValue(next, 0.25, 4)
      video.playbackRate = value
      setRateState(value)
    },
    [videoRef],
  )

  const changeVolume = useCallback(
    (next: number) => {
      const video = videoRef.current
      if (!video) return
      const value = clampVideoPlayerValue(next, 0, 1)
      video.volume = value
      if (value > 0 && video.muted) video.muted = false
      setVolumeState(value)
      setMuted(video.muted)
    },
    [videoRef],
  )

  const toggleMuted = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [videoRef])

  const toggleLoop = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const next = !video.loop
    video.loop = next
    setLoop(next)
  }, [videoRef])

  // 换源时整体复位，避免上一个视频的进度/时长残留到新视频。
  useEffect(() => {
    setPlayback('unready')
    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
    setRateState(1)
    setReady(false)
    setFailed(false)
  }, [src])

  return {
    playback,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    muted,
    rate,
    loop,
    ready,
    failed,
    togglePlay,
    play,
    pause,
    seek,
    stepFrame,
    changeRate,
    changeVolume,
    toggleMuted,
    toggleLoop,
    scrubbing,
    scrubbingEnd,
    handlers: {
      onLoadedMetadata: (event) => {
        const video = event.currentTarget
        if (video.duration > 0 && Number.isFinite(video.duration)) setDuration(video.duration)
        setReady(true)
        setPlayback(video.paused ? 'paused' : 'playing')
      },
      onLoadedData: () => undefined,
      onTimeUpdate: (event) => {
        if (scrubbingRef.current) return
        setCurrentTime(event.currentTarget.currentTime)
      },
      onDurationChange: (event) => {
        const video = event.currentTarget
        if (video.duration > 0 && Number.isFinite(video.duration)) setDuration(video.duration)
      },
      onProgress: (event) => readBufferedEnd(event.currentTarget),
      onPlay: () => setPlayback('playing'),
      onPause: () => setPlayback((prev) => (prev === 'ended' ? prev : 'paused')),
      onEnded: () => setPlayback('ended'),
      onVolumeChange: (event) => {
        const video = event.currentTarget
        setVolumeState(video.volume)
        setMuted(video.muted)
      },
      onRateChange: (event) => setRateState(event.currentTarget.playbackRate),
      onError: () => setFailed(true),
    },
  }
}
