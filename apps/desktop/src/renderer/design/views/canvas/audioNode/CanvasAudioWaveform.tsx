/**
 * 画布音频节点的自绘波形条。
 *
 * 行为：
 * - 首次进入：根据 props.src `fetch` 出 ArrayBuffer，
 *   通过 `AudioContext.decodeAudioData` 解码，下采样到 240 桶的 max。
 *   通过 onPeaks 回调把 peaks 写回 node.data.audioWaveformPeaks（CanvasNodeData 字段），
 *   后续访问直接复用缓存，避免重复解码。
 * - 渲染：固定高度的 `<canvas>`，按 `bars` 数画 2px 间距的条形；
 *   按 `progress` 参数(0..1)切"已播"/"未播"两段（与截图一致）。
 *
 * 性能：`requestAnimationFrame` 一次绘制，桶内取 max → 240 个条几乎瞬时。
 * 解码：调度到 `requestIdleCallback` 兜底，保证不抢占交互帧。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_BARS = 240

type Props = {
  src: string
  /** 已缓存的 peaks（来自 node.data.audioWaveformPeaks） */
  cachedPeaks?: readonly number[] | undefined
  /** 0..1 已播进度；用于高亮"已播"段 */
  progress?: number | undefined
  /** canvas 高度（chip 模式 36 / trim 模式 64） */
  height?: number | undefined
  /** canvas 宽度（直接给数字像素；不传则画布按容器宽度自适应） */
  width?: number | undefined
  className?: string | undefined
  /** peaks 算好后回调，调用方负责写回 node.data */
  onPeaks?: ((peaks: number[]) => void) | undefined
}

const DEFAULT_HEIGHT = 36

function downsamplePeaks(channel: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const samplesPerBucket = Math.max(1, Math.floor(channel.length / buckets))
  for (let i = 0; i < buckets; i++) {
    let max = 0
    const start = i * samplesPerBucket
    const end = Math.min(channel.length, start + samplesPerBucket)
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j] ?? 0)
      if (v > max) max = v
    }
    out[i] = max
  }
  return out
}

function makePlaceholderPeaks(buckets: number): Float32Array {
  // 18 维骨架风格的占位（参考 voiceAudioLevel EMPTY_VOICE_WAVEFORM）
  const seed = [
    0.12, 0.18, 0.24, 0.32, 0.4, 0.46, 0.52, 0.58, 0.62, 0.66, 0.62, 0.58, 0.52, 0.46,
    0.4, 0.32, 0.24, 0.18,
  ]
  const out = new Float32Array(buckets)
  for (let i = 0; i < buckets; i++) {
    out[i] = seed[i % seed.length] ?? 0.2
  }
  return out
}

export function CanvasAudioWaveform({
  src,
  cachedPeaks,
  progress = 0,
  height = DEFAULT_HEIGHT,
  width,
  className,
  onPeaks,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [resolvedWidth, setResolvedWidth] = useState<number>(width ?? 480)
  const [localPeaks, setLocalPeaks] = useState<Float32Array | null>(null)
  const [failed, setFailed] = useState(false)

  // 已有缓存 → 直接读
  useEffect(() => {
    if (cachedPeaks && cachedPeaks.length > 0 && !localPeaks) {
      setLocalPeaks(Float32Array.from(cachedPeaks))
    }
  }, [cachedPeaks, localPeaks])

  // 容器宽度自适应
  useEffect(() => {
    if (width != null) {
      setResolvedWidth(width)
      return
    }
    const node = wrapperRef.current
    if (!node) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setResolvedWidth(Math.round(w))
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [width])

  // 解码 → 下采样
  useEffect(() => {
    if (localPeaks || failed) return
    if (!src) return
    let cancelled = false
    const run = () => {
      const doWork = async () => {
        try {
          const AudioCtor: typeof AudioContext | undefined =
            (typeof window !== 'undefined' &&
              (window.AudioContext ||
                (window as unknown as { webkitAudioContext?: typeof AudioContext })
                  .webkitAudioContext)) ||
            undefined
          if (!AudioCtor) {
            throw new Error('当前环境不支持 AudioContext')
          }
          const res = await fetch(src)
          if (!res.ok) throw new Error(`无法获取音频文件: ${res.status}`)
          const buf = await res.arrayBuffer()
          const ctx = new AudioCtor()
          const decoded = await ctx.decodeAudioData(buf.slice(0))
          const channel = decoded.getChannelData(0)
          const peaks = downsamplePeaks(channel, DEFAULT_BARS)
          ctx.close().catch(() => undefined)
          if (cancelled) return
          setLocalPeaks(peaks)
          onPeaks?.(Array.from(peaks))
        } catch (err) {
          if (cancelled) return
          // 解码失败 → 回退到骨架占位（避免空白节点）
          setLocalPeaks(makePlaceholderPeaks(DEFAULT_BARS))
          setFailed(true)
          // 调试时方便定位；测试环境无 console 也安全
          if (typeof console !== 'undefined') {
            console.warn('[CanvasAudioWaveform] decodeAudioData 失败,使用占位骨架:', err)
          }
        }
      }
      // 错峰解码，避免阻塞主线程
      const idle = (cb: () => void) =>
        'requestIdleCallback' in window
          ? (window as unknown as { requestIdleCallback: (cb: () => void) => number })
              .requestIdleCallback(cb)
          : setTimeout(cb, 50)
      idle(doWork)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [src, localPeaks, failed, onPeaks])

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current
    const peaks = localPeaks
    if (!canvas || !peaks) return
    const dpr = Math.max(1, Math.round(window.devicePixelRatio) || 1)
    const w = Math.max(1, resolvedWidth)
    const h = Math.max(1, height)
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const c2d = canvas.getContext('2d')
    if (!c2d) return
    c2d.scale(dpr, dpr)
    c2d.clearRect(0, 0, w, h)

    const barWidth = 2
    const gap = 1
    const step = barWidth + gap
    const count = Math.max(1, Math.floor(w / step))
    const midY = h / 2
    const playedTo = Math.round(progress * count)

    for (let i = 0; i < count; i++) {
      // 等间距采样 peaks
      const t = (i / count) * peaks.length
      const lo = Math.floor(t)
      const hi = Math.min(peaks.length - 1, lo + 1)
      const frac = t - lo
      const v = (peaks[lo] ?? 0) * (1 - frac) + (peaks[hi] ?? 0) * frac
      const barH = Math.max(1.5, Math.abs(v) * (h * 0.9))
      const x = i * step
      const y = midY - barH / 2
      // 已播段（红色细条）/ 未播段（浅灰细条）
      const played = i < playedTo
      c2d.fillStyle = played
        ? 'rgba(255, 95, 102, 0.85)'
        : 'rgba(180, 188, 200, 0.45)'
      c2d.fillRect(x, y, barWidth, barH)
    }
  }, [localPeaks, progress, resolvedWidth, height])

  return (
    <div ref={wrapperRef} className={className} style={{ width: width ?? '100%' }}>
      <canvas
        ref={canvasRef}
        className="canvas-node-audio-waveform"
        style={{ display: 'block', width: '100%', height, borderRadius: 6 }}
        aria-label="音频波形"
        role="img"
      />
    </div>
  )
}

/**
 * 工具：把峰值数组归一化到 0..1 范围（防御极端值）。
 */
export function normalizePeaks(peaks: readonly number[]): number[] {
  if (peaks.length === 0) return []
  let max = 0
  for (const p of peaks) {
    if (typeof p === 'number' && Number.isFinite(p) && p > max) max = p
  }
  if (max <= 0) return peaks.map(() => 0)
  return peaks.map((p) => (typeof p === 'number' && Number.isFinite(p) ? p / max : 0))
}

/** 读出节点上生效的 peaks（已缓存优先，本地峰值兜底） */
export function useAudioPeaks(
  cachedPeaks: readonly number[] | undefined,
): readonly number[] {
  return useMemo(() => normalizePeaks(cachedPeaks ?? []), [cachedPeaks])
}
