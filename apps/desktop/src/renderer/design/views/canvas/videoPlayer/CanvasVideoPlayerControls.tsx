/**
 * 画布视频播放器控制条（标准/面板档）。
 *
 * 只负责渲染与交互上报：进度拖动、播放/暂停、静音、倍速、循环、逐帧、全屏。
 * 播放状态全部来自 useVideoPlayerController，组件自身不持有媒体状态。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icons } from '../../../Icons'
import {
  formatVideoPlayerTime,
  formatVideoPlayerTimecode,
  ratioFromPointerEvent,
  type VideoPlayerTier,
} from './videoPlayerFormat'
import type { UseVideoPlayerControllerResult } from './useVideoPlayerController'

const SPEED_OPTIONS = [0.5, 1, 1.5, 2]

export type CanvasVideoPlayerControlsProps = {
  tier: VideoPlayerTier
  controller: UseVideoPlayerControllerResult
  fullscreen: boolean
  onToggleFullscreen: () => void
}

export function CanvasVideoPlayerControls({
  tier,
  controller,
  fullscreen,
  onToggleFullscreen,
}: CanvasVideoPlayerControlsProps) {
  const {
    playback,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    muted,
    rate,
    loop,
    ready,
    togglePlay,
    seek,
    stepFrame,
    changeRate,
    changeVolume,
    toggleMuted,
    toggleLoop,
  } = controller

  const trackRef = useRef<HTMLDivElement | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const speedRef = useRef<HTMLDivElement | null>(null)

  // 倍速菜单点外关闭
  useEffect(() => {
    if (!speedMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!speedRef.current?.contains(event.target as Node)) setSpeedMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [speedMenuOpen])

  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0
  const bufferedRatio =
    duration > 0 ? Math.min(1, Math.max(progressRatio, bufferedEnd / duration)) : 0

  const seekFromEvent = (event: ReactPointerEvent<HTMLElement>) => {
    if (duration <= 0) return
    seek(ratioFromPointerEvent(event, trackRef.current) * duration)
  }

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubbing(true)
    controller.scrubbing()
    seekFromEvent(event)
  }

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    seekFromEvent(event)
  }

  const handleTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setScrubbing(false)
    controller.scrubbingEnd()
  }

  const isPlaying = playback === 'playing'
  const timeLabel =
    tier === 'panel' ? formatVideoPlayerTimecode(currentTime) : formatVideoPlayerTime(currentTime)

  return (
    <div className="canvas-video-player-controls nodrag nopan nowheel">
      <div
        className={`canvas-video-player-progress${scrubbing ? ' is-scrubbing' : ''}`}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
        onPointerCancel={handleTrackPointerUp}
      >
        <div className="canvas-video-player-progress-track" ref={trackRef}>
          <div
            className="canvas-video-player-progress-buffered"
            style={{ width: `${bufferedRatio * 100}%` }}
          />
          <div
            className="canvas-video-player-progress-played"
            style={{ width: `${progressRatio * 100}%` }}
          />
        </div>
        <div
          className="canvas-video-player-progress-thumb"
          style={{ left: `${progressRatio * 100}%` }}
        />
      </div>

      <div className="canvas-video-player-buttons">
        <button
          type="button"
          className="canvas-video-player-btn"
          aria-label={isPlaying ? '暂停' : '播放'}
          disabled={!ready}
          onClick={togglePlay}
        >
          {isPlaying ? <Icons.Pause size={15} /> : <Icons.Play size={15} />}
        </button>
        <span className="canvas-video-player-time">
          {timeLabel}
          <span className="canvas-video-player-time-separator">/</span>
          {formatVideoPlayerTime(duration)}
        </span>

        {tier === 'panel' ? (
          <>
            <button
              type="button"
              className="canvas-video-player-btn"
              aria-label="上一帧"
              disabled={!ready}
              onClick={() => stepFrame(-1)}
            >
              <Icons.StepBack size={14} />
            </button>
            <button
              type="button"
              className="canvas-video-player-btn"
              aria-label="下一帧"
              disabled={!ready}
              onClick={() => stepFrame(1)}
            >
              <Icons.StepForward size={14} />
            </button>
          </>
        ) : null}

        <div className="canvas-video-player-volume">
          <button
            type="button"
            className="canvas-video-player-btn"
            aria-label={muted ? '取消静音' : '静音'}
            onClick={toggleMuted}
          >
            {muted ? <Icons.VolumeX size={15} /> : <Icons.Volume2 size={15} />}
          </button>
          {tier === 'panel' ? (
            <div className={`canvas-video-player-volume-slider${muted ? '' : ' is-open'}`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                aria-label="音量"
                onChange={(event) => changeVolume(Number(event.currentTarget.value))}
              />
            </div>
          ) : null}
        </div>

        <span className="canvas-video-player-spacer" />

        {tier === 'panel' ? (
          <>
            <div className="canvas-video-player-speed" ref={speedRef}>
              <button
                type="button"
                className={`canvas-video-player-btn${rate !== 1 ? ' is-active' : ''}`}
                aria-label="播放速度"
                aria-expanded={speedMenuOpen}
                onClick={() => setSpeedMenuOpen((open) => !open)}
              >
                {rate}x
              </button>
              {speedMenuOpen ? (
                <div className="canvas-video-player-speed-menu" role="menu">
                  {SPEED_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option}
                      role="menuitemradio"
                      aria-checked={rate === option}
                      className={`canvas-video-player-speed-option${
                        rate === option ? ' is-active' : ''
                      }`}
                      onClick={() => {
                        changeRate(option)
                        setSpeedMenuOpen(false)
                      }}
                    >
                      <span>{option}x</span>
                      {rate === option ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={`canvas-video-player-btn${loop ? ' is-active' : ''}`}
              aria-label="循环播放"
              aria-pressed={loop}
              onClick={toggleLoop}
            >
              <Icons.Repeat size={14} />
            </button>
          </>
        ) : null}

        <button
          type="button"
          className="canvas-video-player-btn"
          aria-label={fullscreen ? '退出全屏' : '全屏'}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
        </button>
      </div>
    </div>
  )
}
