import { useCallback, useEffect, useRef, useState } from 'react'
import {
  evaluateStage3DCameraMotion,
  type Stage3DCameraMotion,
  type Stage3DMotionFrame,
  type Stage3DMotionSubject,
} from './cameraMotion'

/**
 * 机位运镜播放器：rAF 按真实时间轴驱动 evaluateStage3DCameraMotion，
 * 每帧把动画机位写进 onFrame（通常是 Scene3D 的 cameraOverrideRef，命令式、
 * 不触发 React 重渲染），progress 状态按 ~5% 步进节流只喂进度条。
 */

export type Stage3DMotionPlayback = {
  playing: boolean
  /** 0..1 */
  progress: number
  play: (motion: Stage3DCameraMotion, subject?: Stage3DMotionSubject | undefined) => void
  stop: () => void
}

export function useStage3DMotionPlayback(options: {
  onFrame: (frame: Stage3DMotionFrame | null) => void
  /** 播放自然结束（非手动 stop）时回调 */
  onFinish?: (() => void) | undefined
}): Stage3DMotionPlayback {
  const { onFrame, onFinish } = options
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const rafRef = useRef<number | null>(null)
  const startPerfRef = useRef(0)
  const motionRef = useRef<Stage3DCameraMotion | null>(null)
  const subjectRef = useRef<Stage3DMotionSubject | undefined>(undefined)
  const lastProgressRef = useRef(0)
  const onFrameRef = useRef(onFrame)
  const onFinishRef = useRef(onFinish)
  onFrameRef.current = onFrame
  onFinishRef.current = onFinish

  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    motionRef.current = null
    subjectRef.current = undefined
  }, [])

  const stop = useCallback(() => {
    teardown()
    onFrameRef.current(null)
    setPlaying(false)
    setProgress(0)
    lastProgressRef.current = 0
  }, [teardown])

  const play = useCallback(
    (motion: Stage3DCameraMotion, subject?: Stage3DMotionSubject | undefined) => {
      teardown()
      onFrameRef.current(null)
      motionRef.current = motion
      subjectRef.current = subject
      startPerfRef.current = performance.now()
      lastProgressRef.current = 0
      setProgress(0)
      setPlaying(true)

      const duration = Math.max(0.1, motion.durationSec)
      const loop = () => {
        const current = motionRef.current
        if (!current) return
        const elapsedSec = (performance.now() - startPerfRef.current) / 1000
        const t = Math.min(elapsedSec, duration)
        onFrameRef.current(evaluateStage3DCameraMotion(current, t, subjectRef.current))
        const p = Math.min(1, elapsedSec / duration)
        // 进度状态节流：变化超过 2%（或播完）才 setState，避免 60fps 重渲染弹窗
        if (p >= 1 || p - lastProgressRef.current >= 0.02) {
          lastProgressRef.current = p
          setProgress(p)
        }
        if (elapsedSec >= duration) {
          const finish = onFinishRef.current
          teardown()
          onFrameRef.current(null)
          setPlaying(false)
          setProgress(1)
          lastProgressRef.current = 0
          finish?.()
          return
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    },
    [teardown],
  )

  // 卸载时兜底清理，避免泄漏 rAF 与 override
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { playing, progress, play, stop }
}
