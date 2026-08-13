/**
 * 画布自研视频播放器。
 *
 * 替代画布内三处原生 <video controls>（视频节点 / 操作产物预览 / 媒体编辑面板预览），
 * 统一一套控件、三档自适应（mini <260px / standard <420px / panel ≥420px，随容器宽度）。
 *
 * 画布事件协同：
 * - 控件区带 nodrag/nopan/nowheel，拖进度条不会拖动节点或平移/缩放画布
 * - 画面区不拦截事件，节点原有的点选/拖拽、双击编辑、右键菜单链路保持不变
 * - 键盘操作全部阻断冒泡，避免方向键误触画布快捷键或节点删除
 */
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Icons } from '../../../Icons'
import { CanvasVideoPlayerControls } from './CanvasVideoPlayerControls'
import { useVideoPlayerController } from './useVideoPlayerController'
import { formatVideoPlayerTime, resolveVideoPlayerTier } from './videoPlayerFormat'
import './CanvasVideoPlayer.less'

/** 播放中控制条自动隐藏的空闲阈值（毫秒）。 */
const CONTROLS_IDLE_DELAY_MS = 2500

export type CanvasVideoPlayerProps = {
  src: string
  /** 尺寸/布局类名（canvas-node-image / canvas-operation-output-media 等）会打到外壳上。 */
  className?: string
  /** metadata 加载回调；同时暴露 videoWidth/videoHeight 供节点回填尺寸。 */
  onVideoMetadata?: (info: { width: number; height: number; duration: number }) => void
  /** 首帧数据就绪回调（面板预览用它切换 loading 态）。 */
  onVideoLoadedData?: () => void
  /** 资源加载失败回调。 */
  onVideoError?: () => void
  /** 双击画面进入编辑（保留节点原有的双击编辑交互）。 */
  onDoubleClickEdit?: (() => void) | undefined
}

export function CanvasVideoPlayer({
  src,
  className,
  onVideoMetadata,
  onVideoLoadedData,
  onVideoError,
  onDoubleClickEdit,
}: CanvasVideoPlayerProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controller = useVideoPlayerController(videoRef, src)

  const [tier, setTier] = useState(() => resolveVideoPlayerTier(0))
  const [fullscreen, setFullscreen] = useState(false)
  const [idle, setIdle] = useState(false)
  const idleTimerRef = useRef<number | null>(null)

  // 档位自适应：跟随容器宽度，ResizeObserver 比媒体查询可靠（画布节点可任意缩放）。
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setTier(resolveVideoPlayerTier(width))
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  // 全屏态跟踪（Electron/Chromium 支持 document.fullscreenElement）。
  useEffect(() => {
    const handleFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === wrapperRef.current)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (document.fullscreenElement === wrapper) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void wrapper.requestFullscreen().catch(() => undefined)
    }
  }, [])

  // 播放中 2.5s 无操作隐藏控制条；暂停/悬停时保持可见（CSS :hover/:focus-within 兜底）。
  const noteActivity = useCallback(() => {
    setIdle(false)
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => setIdle(true), CONTROLS_IDLE_DELAY_MS)
  }, [])

  useEffect(() => {
    if (controller.playback !== 'playing') {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
      return
    }
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => setIdle(true), CONTROLS_IDLE_DELAY_MS)
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    }
  }, [controller.playback])

  const isPlaying = controller.playback === 'playing'
  const isIdle = isPlaying && idle

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // 键盘操作只服务播放器，不向画布冒泡。
      event.stopPropagation()
      noteActivity()
      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          controller.togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          controller.seek(controller.currentTime - 5)
          break
        case 'ArrowRight':
          event.preventDefault()
          controller.seek(controller.currentTime + 5)
          break
        case 'm':
          controller.toggleMuted()
          break
        case 'f':
          toggleFullscreen()
          break
        default:
          break
      }
    },
    [controller, noteActivity, toggleFullscreen],
  )

  const mergeHandler =
    <K extends keyof typeof controller.handlers>(
      key: K,
      extra?: (event: SyntheticEvent<HTMLVideoElement>) => void,
    ) =>
    (event: SyntheticEvent<HTMLVideoElement>) => {
      controller.handlers[key](event)
      extra?.(event)
    }

  const progressRatio =
    controller.duration > 0
      ? Math.min(1, Math.max(0, controller.currentTime / controller.duration))
      : 0

  return (
    <div
      ref={wrapperRef}
      className={`canvas-video-player${className ? ` ${className}` : ''}${
        isIdle ? ' is-idle' : ''
      }${fullscreen ? ' is-fullscreen' : ''}`}
      data-tier={tier}
      tabIndex={0}
      role="region"
      aria-label="视频播放器"
      onPointerMove={noteActivity}
      onPointerDown={noteActivity}
      onKeyDown={handleKeyDown}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        // 控件区的双击只用于阻断画布缩放，不应误触发节点编辑。
        if (event.target === videoRef.current) onDoubleClickEdit?.()
      }}
      onContextMenu={(event) => {
        // 阻止 <video> 原生右键菜单，事件继续冒泡给外层节点的 contextMenu trigger。
        event.preventDefault()
      }}
    >
      <video
        key={src}
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        disablePictureInPicture
        controlsList="noremoteplayback"
        onLoadedMetadata={mergeHandler('onLoadedMetadata', (event) => {
          const video = event.currentTarget
          onVideoMetadata?.({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
          })
        })}
        onLoadedData={mergeHandler('onLoadedData', () => onVideoLoadedData?.())}
        onTimeUpdate={controller.handlers.onTimeUpdate}
        onDurationChange={controller.handlers.onDurationChange}
        onProgress={controller.handlers.onProgress}
        onPlay={controller.handlers.onPlay}
        onPause={controller.handlers.onPause}
        onEnded={controller.handlers.onEnded}
        onVolumeChange={controller.handlers.onVolumeChange}
        onRateChange={controller.handlers.onRateChange}
        onError={mergeHandler('onError', () => onVideoError?.())}
      />

      <div className="canvas-video-player-overlay">
        <div className="canvas-video-player-center">
          <button
            type="button"
            className="canvas-video-player-center-btn nodrag nopan"
            aria-label={isPlaying ? '暂停' : '播放'}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              controller.togglePlay()
            }}
          >
            {isPlaying ? <Icons.Pause size={20} /> : <Icons.Play size={20} />}
          </button>
        </div>
        <span className="canvas-video-player-duration-badge">
          {formatVideoPlayerTime(controller.duration)}
        </span>
        <CanvasVideoPlayerControls
          tier={tier}
          controller={controller}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>

      {/* 迷你档常驻细进度条：贴底 3px，仅指示不可交互。 */}
      <div className="canvas-video-player-mini-bar" aria-hidden="true">
        <div
          className="canvas-video-player-mini-bar-fill"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>
    </div>
  )
}
