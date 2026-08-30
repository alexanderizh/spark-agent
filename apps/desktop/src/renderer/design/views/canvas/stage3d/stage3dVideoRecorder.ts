/**
 * 3D 导演台·运镜视频录制器。
 *
 * 原理：离屏 2D canvas 作为 MediaRecorder 的帧源（canvas.captureStream(fps) 自动推帧，
 * 叠加 requestFrame 手动推帧保证节奏），逐帧用 rAF 按真实时间轴驱动轨迹求值并渲染，
 * 产出一个与轨迹等长的 WebM Blob。走离屏渲染管线（隐藏 gizmo/取景相机模型），
 * 成片干净、不受主视口尺寸与画幅影响。
 */

export type Stage3DVideoSize = { width: number; height: number }

export type RecordStage3DVideoOptions = {
  /** 输出分辨率（像素） */
  size: Stage3DVideoSize
  /** 轨迹时长（秒） */
  durationSec: number
  /** 目标帧率（默认 30） */
  fps?: number
  /**
   * 渲染第 tSec 秒的一帧到给定 canvas；返回 false 视为该帧失败（跳过，不中断录制）。
   * 传入的 canvas 就是录制源 canvas，实现方直接在上面画即可。
   */
  renderFrame: (tSec: number, canvas: HTMLCanvasElement) => boolean
  /** 录制进度（0..1） */
  onProgress?: (progress: number) => void
  /** 外部取消信号：每帧检查，取消后尽快结束并抛 CancelledError */
  signal?: { cancelled: boolean } | undefined
}

export type Stage3DVideoRecording = {
  blob: Blob
  mimeType: string
  durationMs: number
  size: Stage3DVideoSize
}

/** 用户取消录制时抛出（调用方静默处理即可） */
export class Stage3DVideoCancelledError extends Error {
  constructor() {
    super('stage3d video recording cancelled')
    this.name = 'Stage3DVideoCancelledError'
  }
}

/** 按画幅换算录制分辨率：长边 1280（720p 级别，清晰度与性能均衡） */
export function stage3DVideoSizeForAspect(ratio: number): Stage3DVideoSize {
  const longEdge = 1280
  const w = ratio >= 1 ? longEdge : Math.round(longEdge * ratio)
  const h = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge
  // 编码器普遍要求偶数尺寸
  return { width: Math.max(2, w - (w % 2)), height: Math.max(2, h - (h % 2)) }
}

function pickVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/webm'
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return 'video/webm'
}

function waitFrames(frames: number): Promise<void> {
  return new Promise((resolve) => {
    let left = frames
    const tick = () => {
      left -= 1
      if (left <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/**
 * 录制一段运镜视频。
 *
 * 帧节奏：rAF + 真实时钟（performance.now）对齐轨迹时间轴，requestFrame 手动推帧——
 * 机器性能不足时宁掉帧不拖时长，保证成片时长与轨迹一致。
 */
export async function recordStage3DVideo(
  options: RecordStage3DVideoOptions,
): Promise<Stage3DVideoRecording> {
  const { size, durationSec, fps = 30, renderFrame, onProgress, signal } = options
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前环境不支持视频录制（MediaRecorder 不可用）')
  }
  const durationMs = Math.max(200, durationSec * 1000)

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('无法创建离屏录制画布')

  const stream = canvas.captureStream(fps)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
  if (!track) throw new Error('无法创建视频轨道')

  const mimeType = pickVideoMimeType()
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: BlobPart[] = []
  /** 渲染/编码链路上的致命错误；置位后帧循环停止，await finished 后优先抛出。 */
  let loopFailure: Error | null = null
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      if (chunks.length === 0) {
        reject(new Error('录制内容为空'))
        return
      }
      resolve(new Blob(chunks, { type: mimeType }))
    }
    recorder.onerror = () => {
      loopFailure = new Error('视频录制失败')
      reject(loopFailure)
    }
  })

  let cancelled = false
  let stopped = false
  /** 连续渲染失败计数：达到阈值判定视口已失效（弹窗已关闭/gl 已释放），中止而非录黑帧。 */
  let consecutiveRenderFailures = 0

  const stopRecorder = () => {
    if (stopped) return
    stopped = true
    // 给最后一帧留出编码窗口，避免结尾黑帧/丢帧
    try {
      track.requestFrame()
    } catch {
      // 部分实现自动推帧，requestFrame 不存在时忽略
    }
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
      stream.getTracks().forEach((t) => t.stop())
    }, 80)
  }

  const failLoop = (error: Error) => {
    if (loopFailure == null) loopFailure = error
    stopRecorder()
  }

  // 首帧先画出来再 start，避免首帧黑屏；首帧即抛错时回收轨道后上抛，
  // 否则 captureStream 轨道泄漏且调用方拿不到明确错误。
  try {
    renderFrame(0, canvas)
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop())
    throw error instanceof Error ? error : new Error(String(error))
  }
  try {
    track.requestFrame()
  } catch {
    // 同上
  }
  recorder.start(250)

  const startAt = performance.now()
  const loop = () => {
    if (stopped || loopFailure != null) return
    if (signal?.cancelled) {
      cancelled = true
      stopRecorder()
      return
    }
    const elapsed = performance.now() - startAt
    const tSec = Math.min(elapsed / 1000, durationSec)
    let rendered: boolean
    try {
      rendered = renderFrame(tSec, canvas) !== false
    } catch (error) {
      // 帧循环里不捕获异常会永久卡死录制入口（recorder/track 泄漏、finished 永挂）
      failLoop(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (!rendered) {
      consecutiveRenderFailures += 1
      if (consecutiveRenderFailures >= 45) {
        failLoop(new Error('3D 视口不可用，录制已中止（连续多帧渲染失败）'))
        return
      }
    } else {
      consecutiveRenderFailures = 0
    }
    try {
      track.requestFrame()
    } catch {
      // 自动推帧模式忽略
    }
    onProgress?.(Math.min(1, elapsed / durationMs))
    if (elapsed >= durationMs) {
      stopRecorder()
      return
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  try {
    const blob = await finished
    if (cancelled) throw new Stage3DVideoCancelledError()
    if (loopFailure != null) throw loopFailure
    // 等两帧让 stop 回调彻底落地（防抖，一般已 resolved）
    await waitFrames(1)
    return { blob, mimeType, durationMs, size }
  } catch (error) {
    if (cancelled) throw new Stage3DVideoCancelledError()
    if (loopFailure != null) throw loopFailure
    throw error
  }
}

/** Blob → dataURL（落盘走 file:save-pasted-media 的 dataUrl 通道） */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取视频数据失败'))
    reader.readAsDataURL(blob)
  })
}
