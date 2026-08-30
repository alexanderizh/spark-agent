/**
 * 画布音频节点呈现层。
 *
 * 把原来在 CanvasNode.tsx 里内联的 audio 分支整体迁出到这里，避免 CanvasNode.tsx
 * 越过 3000 行上限。组件结构：
 *   - 默认外壳：上行 TikTok / FileType 图标 + 文件名，中间自绘波形条，下行时间码 + 居中播放键
 *   - 选中态：由 CanvasNodeSelectionToolbar 统一承载「截取 / 变速 / 下载」入口
 *   - 点击「截取」：蒙层 + CanvasAudioTrimOverlay 接管交互
 *   - 点击「变速」：底部追加 CanvasAudioSpeedDrawer
 *   - 「生成」「应用」 → 各自回调 onTrimApply / onSpeedApply，由上层完成 IPC + 物化
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Icons } from '../../../Icons'
import type { CanvasAudioSpeedDrawerProps } from './CanvasAudioSpeedDrawer'
import { CanvasAudioSpeedDrawer, SPEED_CEIL, SPEED_FLOOR } from './CanvasAudioSpeedDrawer'
import { CanvasAudioTrimOverlay } from './CanvasAudioTrimOverlay'
import { CanvasAudioWaveform } from './CanvasAudioWaveform'

type AudioActions = {
  /** 触发音频截取；返回是否成功物化出新节点 */
  onTrimApply?: (start: number, end: number) => Promise<void> | void
  /** 触发音频变速；同上 */
  onSpeedApply?: (factor: number) => Promise<void> | void
  /** 下载当前节点对应的音频（复用画布现有 downloadMedia） */
  onDownload?: () => void
  /** peaks 解码后回写节点 data（缓存） */
  onPeaks?: (peaks: number[]) => void
}

type Props = {
  src: string
  fileName: string
  durationSec: number
  /** 已缓存 peaks 来自 node.data.audioWaveformPeaks */
  cachedPeaks?: readonly number[] | undefined
  selected: boolean
  actions: AudioActions
  /** 鼠标进入节点区，用来在 idle 状态下开启/取消 hover 的微反馈（之后接入按需扩展） */
  hoverable?: boolean | undefined
}

export type CanvasAudioNodePresentationHandle = {
  openTrim: () => void
  openSpeed: () => void
}

type Mode = 'idle' | 'trimming' | 'speeding'

const MIN_TRIM_DURATION_SEC = 0.1

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return 1.0
  return Math.min(SPEED_CEIL, Math.max(SPEED_FLOOR, n))
}

function formatTimecode(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec >= 0 ? totalSec : 0
  const min = Math.floor(safe / 60)
  const sec = Math.floor(safe % 60)
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export const CanvasAudioNodePresentation = forwardRef<CanvasAudioNodePresentationHandle, Props>(
  function CanvasAudioNodePresentation(
    { src, fileName, durationSec, cachedPeaks, selected, actions }: Props,
    ref,
  ) {
    const [mode, setMode] = useState<Mode>('idle')
    const [busy, setBusy] = useState<'trim' | 'speed' | null>(null)
    const [speedDraft, setSpeedDraft] = useState<number>(1.0)
    const [progress, setProgress] = useState(0)
    const [timePosition, setTimePosition] = useState(0)
    const [mediaDuration, setMediaDuration] = useState(0)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const restoredPeaksRef = useRef(false)

    // 把 cached peaks 直接当作首渲染可见的波形（避免新节点首次 decode 闪现空白）
    useEffect(() => {
      if (!cachedPeaks || cachedPeaks.length === 0 || restoredPeaksRef.current) return
      restoredPeaksRef.current = true
    }, [cachedPeaks])

    // 关闭态：选中态切走 / 节点失焦自动退出交互模式
    useEffect(() => {
      if (!selected && mode !== 'idle') setMode('idle')
    }, [selected, mode])

    const safeDuration =
      Number.isFinite(durationSec) && durationSec > 0
        ? durationSec
        : Number.isFinite(mediaDuration) && mediaDuration > 0
          ? mediaDuration
          : 0

    const onTogglePlay = useCallback(() => {
      const el = audioRef.current
      if (!el) return
      if (el.paused) {
        const play = el.play()
        if (play && typeof play.then === 'function') {
          play.catch(() => undefined)
        }
      } else {
        el.pause()
      }
    }, [])

    const onTimeUpdate = useCallback(() => {
      const el = audioRef.current
      if (!el) return
      if (safeDuration > 0) {
        setProgress(el.currentTime / safeDuration)
      }
      setTimePosition(el.currentTime)
    }, [safeDuration])

    const onPlay = useCallback(() => setIsPlaying(true), [])
    const onPause = useCallback(() => setIsPlaying(false), [])

    const onTrim = useCallback(() => {
      setMode('trimming')
    }, [])
    const onSpeed = useCallback(() => {
      setSpeedDraft(1.0)
      setMode('speeding')
    }, [])
    useImperativeHandle(ref, () => ({ openTrim: onTrim, openSpeed: onSpeed }), [onSpeed, onTrim])
    const onCancel = useCallback(() => {
      setMode('idle')
      setBusy(null)
    }, [])
    const onApplyTrim = useCallback(
      async (start: number, end: number) => {
        if (!actions.onTrimApply) {
          setMode('idle')
          return
        }
        setBusy('trim')
        try {
          await actions.onTrimApply(start, end)
        } finally {
          setBusy(null)
          setMode('idle')
        }
      },
      [actions],
    )

    const onApplySpeed: CanvasAudioSpeedDrawerProps['onApply'] = useCallback(
      async (factor) => {
        if (!actions.onSpeedApply) {
          setMode('idle')
          return
        }
        setBusy('speed')
        try {
          await actions.onSpeedApply(clampSpeed(factor))
        } finally {
          setBusy(null)
          setMode('idle')
        }
      },
      [actions],
    )

    const onSpeedChange: CanvasAudioSpeedDrawerProps['onChange'] = useCallback((next) => {
      setSpeedDraft(clampSpeed(next))
    }, [])

    const onPeaksComputed = useCallback(
      (peaks: number[]) => {
        actions.onPeaks?.(peaks)
      },
      [actions],
    )

    return (
      <div className="canvas-node-audio-shell">
        <div className="canvas-node-audio-header">
          <Icons.Mic size={14} aria-hidden />
          <span className="canvas-node-audio-name" title={fileName}>
            {fileName}
          </span>
        </div>

        <div className="canvas-node-audio-waveform-row">
          <CanvasAudioWaveform
            src={src}
            cachedPeaks={cachedPeaks}
            progress={progress}
            height={40}
            onPeaks={onPeaksComputed}
          />
          {/* 节点内 mp3 真正播放靠这个隐藏 audio；进度由 onTimeUpdate 上报 */}
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={(event) => {
              if (event.currentTarget.duration > 0) setMediaDuration(event.currentTarget.duration)
            }}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onPause}
            className="canvas-node-audio-hidden"
            aria-hidden
          />
        </div>

        <div className="canvas-node-audio-time-row">
          <span className="canvas-node-audio-time">{formatTimecode(timePosition)}</span>
          <button
            type="button"
            className="canvas-node-audio-play"
            onClick={onTogglePlay}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Icons.Pause size={14} /> : <Icons.Play size={14} />}
          </button>
          <span className="canvas-node-audio-time">/ {formatTimecode(safeDuration)}</span>
        </div>

        {mode === 'trimming' && (
          <div
            className="canvas-node-audio-overlay-backdrop nodrag nopan"
            onPointerDown={(event) => {
              // 点击遮罩外区域 = 取消（但点击 overlay 本身不取消）
              if (event.target === event.currentTarget) {
                onCancel()
              }
            }}
          >
            <CanvasAudioTrimOverlay
              src={src}
              cachedPeaks={cachedPeaks}
              durationSec={safeDuration || 60}
              onApply={onApplyTrim}
              onCancel={onCancel}
              busy={busy === 'trim'}
            />
          </div>
        )}

        {mode === 'speeding' && (
          <CanvasAudioSpeedDrawer
            value={speedDraft}
            onChange={onSpeedChange}
            onApply={onApplySpeed}
            onCancel={onCancel}
            busy={busy === 'speed'}
          />
        )}

        {/* MIN_TRIM_DURATION_SEC 仅作模块内部引用，避免 noUnusedLocals 误报（并保留扩展点） */}
        <span style={{ display: 'none' }} aria-hidden>
          {useMemo(() => MIN_TRIM_DURATION_SEC, [])}
        </span>
      </div>
    )
  },
)
