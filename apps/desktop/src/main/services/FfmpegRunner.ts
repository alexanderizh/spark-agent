/**
 * FfmpegRunner — ffmpeg/ffprobe 命令执行层（裸 spawn 薄封装）
 *
 * 设计决策：不使用 fluent-ffmpeg（已于 2025 年被官方归档，Issue #1324），
 * 直接用 node:child_process spawn，自写进度解析与进程生命周期管理。
 *
 * 职责：
 *   1. spawn ffmpeg/ffprobe，参数走数组传递（避免命令注入）
 *   2. stderr 进度解析（time=/frame=/fps=）+ 超时 + 取消
 *   3. 并发上限控制（信号量，防资源争抢）
 *   4. 封装视频处理命令：probe / extractKeyframes / trim / concat / transcode / 画面处理
 *
 * 进度解析原理：
 *   ffmpeg 进度信息输出在 stderr，形如 `frame=  123 fps= 60 q=24.0 size=    1024kB time=00:00:05.12 ...`
 *   结合 probe 得到的总时长，换算 percent = currentTime / duration * 100。
 *
 * 并发控制：
 *   社区报告 Node 有约 5 并发 ffmpeg 硬限。本 runner 设上限 2，留余量。
 *
 * 产物存储：
 *   由调用方指定 outputPath（通常落在 `{userData}/.spark-artifacts/media/video-workbench/`）。
 */

import { spawn } from 'node:child_process'
import { createLogger } from '@spark/shared'
import { resolveFfmpegBin } from './FfmpegIntegrityService.js'

const log = createLogger('ffmpeg-runner')

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface FfmpegProgress {
  /** 0~100，基于 time/总时长换算；无总时长时为 -1 */
  percent: number
  frame: number
  fps: number
  /** 当前处理到的时间点（秒） */
  currentTimeSec: number
}

export interface RunOpts {
  /** 超时毫秒，默认 180_000（3 分钟） */
  timeoutMs?: number
  /** 进度回调（仅 ffmpeg 有意义；ffprobe 不触发） */
  onProgress?: (p: FfmpegProgress) => void
  /** 视频总时长（秒），用于换算 percent；不提供时 percent 为 -1 */
  totalDurationSec?: number
  /** 取消信号 */
  signal?: AbortSignal
}

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

// ─── 并发信号量 ──────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 2
let runningCount = 0
const waitQueue: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (runningCount < MAX_CONCURRENT) {
    runningCount++
    return
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve))
  runningCount++
}

function releaseSlot(): void {
  runningCount--
  const next = waitQueue.shift()
  if (next) next()
}

// ─── 核心执行器 ──────────────────────────────────────────────────────────────

const PROGRESS_REGEX = /frame=\s*(\d+).*?\bfps=\s*([\d.]+).*?\btime=\s*(\d+):(\d+):(\d+\.?\d*)/

/** 把 ffmpeg stderr 的 time=HH:MM:SS.SS 换算成秒 */
function parseTimeToSec(h: string, m: string, s: string): number {
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s)
}

/**
 * 执行一个 ffmpeg 命令（非 ffprobe）。
 *
 * @param args ffmpeg 参数数组
 * @param opts 运行选项
 */
async function runFfmpeg(args: string[], opts: RunOpts = {}): Promise<ExecResult> {
  const { ffmpeg } = await resolveFfmpegBin()
  const timeoutMs = opts.timeoutMs ?? 180_000
  log.info(`ffmpeg ${args.join(' ')}`)

  await acquireSlot()
  try {
    return await new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(ffmpeg, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let aborted = false

      const timer = setTimeout(() => {
        timedOut = true
        gracefulKill(child)
      }, timeoutMs)

      const onAbort = () => {
        aborted = true
        gracefulKill(child)
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout?.on('data', (b: Buffer) => {
        stdout += b.toString()
      })
      child.stderr?.on('data', (b: Buffer) => {
        const text = b.toString()
        stderr += text
        // 进度解析
        if (opts.onProgress) {
          const m = text.match(PROGRESS_REGEX)
          if (m) {
            const currentTimeSec = parseTimeToSec(m[1], m[2], m[3])
            const percent =
              opts.totalDurationSec && opts.totalDurationSec > 0
                ? Math.min(100, (currentTimeSec / opts.totalDurationSec) * 100)
                : -1
            opts.onProgress({
              percent,
              frame: parseInt(m[1], 10),
              fps: parseFloat(m[2]),
              currentTimeSec,
            })
          }
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        if (timedOut) {
          reject(new Error(`ffmpeg 执行超时（${timeoutMs}ms）`))
        } else if (aborted) {
          reject(new Error('ffmpeg 执行被取消'))
        } else {
          resolve({ code: code ?? -1, stdout, stderr })
        }
      })
    })
  } finally {
    releaseSlot()
  }
}

/**
 * 优雅终止子进程：SIGTERM → 3s 宽限 → SIGKILL。
 * 防止 ffmpeg 成为僵尸进程（社区常见问题）。
 */
function gracefulKill(child: { kill: (signal?: NodeJS.Signals) => boolean }): void {
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 3000)
}

/**
 * 执行 ffprobe（拿 JSON 输出）。不解析进度。
 */
async function runFfprobe(args: string[]): Promise<string> {
  const { ffprobe } = await resolveFfmpegBin()
  log.info(`ffprobe ${args.join(' ')}`)
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobe, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      gracefulKill(child)
      reject(new Error('ffprobe 执行超时（15s）'))
    }, 15_000)
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString()
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`ffprobe 失败 (退出码 ${code}): ${stderr.trim()}`))
    })
  })
}

// ─── 转义辅助（filter 表达式内的特殊字符）────────────────────────────────────

/**
 * 转义 filter 里的单引号。ffmpeg filter 表达式用单引号包裹，
 * 内部单引号需用 \' 转义，反斜杠需先转义。
 * 仅用于我们构造的已知参数（不接受用户自由文本，防注入）。
 */
function escapeFilterValue(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 探测 (probe)
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoProbeInfo {
  durationSec: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  bitrate: number
  hasAudio: boolean
  fileSize: number
}

/**
 * 探测视频元数据。用 ffprobe -show_format -show_streams 拿 JSON。
 */
export async function probeVideo(input: string): Promise<VideoProbeInfo> {
  const out = await runFfprobe([
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    input,
  ])
  const data = JSON.parse(out) as {
    format?: {
      duration?: string
      bit_rate?: string
      size?: string
    }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      r_frame_rate?: string
      avg_frame_rate?: string
    }>
  }

  const videoStream = data.streams?.find((s) => s.codec_type === 'video')
  const audioStream = data.streams?.find((s) => s.codec_type === 'audio')

  // r_frame_rate 形如 "30/1" 或 "2997/100"
  let fps = 0
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number)
    if (den && !Number.isNaN(num)) fps = Math.round((num / den) * 100) / 100
  }

  return {
    durationSec: parseFloat(data.format?.duration ?? '0') || 0,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps,
    videoCodec: videoStream?.codec_name ?? 'unknown',
    audioCodec: audioStream?.codec_name ?? null,
    hasAudio: audioStream != null,
    bitrate: parseInt(data.format?.bit_rate ?? '0', 10) || 0,
    fileSize: parseInt(data.format?.size ?? '0', 10) || 0,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 关键帧提取 (extractKeyframes)
// ═══════════════════════════════════════════════════════════════════════════

export type KeyframeStrategy = 'scene' | 'iframe' | 'uniform'

export interface ExtractKeyframesOpts {
  /** 提取策略 */
  strategy: KeyframeStrategy
  /** scene 模式阈值 0~1，默认 0.3（越小越敏感） */
  threshold?: number
  /** uniform 模式采样间隔（秒），如 10 表示每 10 秒一帧 */
  intervalSec?: number
  /** 上限保护：超过此数退化均匀采样。默认 20 */
  maxFrames?: number
  /** 输出目录（绝对路径） */
  outputDir: string
  /** 输出格式 */
  format?: 'jpg' | 'png'
  /** 质量 -q:v，2~31，默认 2（高质量） */
  quality?: number
  /** 进度回调 */
  onProgress?: (p: FfmpegProgress) => void
}

export interface ExtractedKeyframe {
  /** 产物绝对路径 */
  path: string
  /** 在视频中的时间戳（秒） */
  timestampSec: number
  /** 序号（0-based） */
  index: number
}

export interface ExtractKeyframesResult {
  frames: ExtractedKeyframe[]
  /** 实际使用的策略（上限保护可能从 scene/iframe 退化到 uniform） */
  effectiveStrategy: KeyframeStrategy
}

/** showinfo 输出里的 pts_time 解析正则 */
const PTS_TIME_REGEX = /pts_time:(\d+\.?\d*)/g

/**
 * 解析 ffmpeg stderr 中 showinfo 输出的时间戳列表。
 * showinfo 每个被选中的帧会输出一行含 `pts_time:X`。
 */
function parseShowinfoTimestamps(stderr: string): number[] {
  const timestamps: number[] = []
  let m: RegExpExecArray | null
  PTS_TIME_REGEX.lastIndex = 0
  while ((m = PTS_TIME_REGEX.exec(stderr)) !== null) {
    timestamps.push(parseFloat(m[1]))
  }
  return timestamps
}

/**
 * 提取视频关键帧。三种策略 + 上限保护。
 *
 * 策略说明：
 *   - scene:  `select='gt(scene,THRESHOLD)',showinfo` —— 场景突变检测
 *   - iframe: `select='eq(pict_type,I)',showinfo` —— 提取编码关键帧(I帧)
 *   - uniform:`fps=1/INTERVAL` —— 均匀采样
 *
 * 上限保护：scene/iframe 结果若 > maxFrames，退化成 uniform（interval = duration / maxFrames）。
 * 时间戳从 showinfo 的 pts_time 解析。
 */
export async function extractKeyframes(
  input: string,
  opts: ExtractKeyframesOpts,
): Promise<ExtractKeyframesResult> {
  const { existsSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { randomUUID } = await import('node:crypto')

  const probe = await probeVideo(input)
  const duration = probe.durationSec
  if (duration <= 0) {
    throw new Error('无法探测视频时长，关键帧提取中止')
  }

  mkdirSync(opts.outputDir, { recursive: true })
  const format = opts.format ?? 'jpg'
  const quality = opts.quality ?? 2
  const maxFrames = opts.maxFrames ?? 20

  // 产物文件名前缀（用 uuid 避免多次提取冲突）
  const sessionId = randomUUID().slice(0, 8)
  const pattern = join(opts.outputDir, `kf_${sessionId}_%04d.${format}`)

  // 第一次尝试：按指定策略
  const firstPass = await runKeyframePass(input, {
    strategy: opts.strategy,
    threshold: opts.threshold ?? 0.3,
    intervalSec: opts.intervalSec ?? Math.max(1, Math.floor(duration / 10)),
    pattern,
    format,
    quality,
    duration,
    onProgress: opts.onProgress,
  })

  // 上限保护：超过 maxFrames 退化均匀采样
  if (firstPass.timestamps.length > maxFrames && opts.strategy !== 'uniform') {
    log.info(
      `关键帧数 ${firstPass.timestamps.length} 超过上限 ${maxFrames}，退化为均匀采样`,
    )
    // 清理第一次的产物
    for (const f of firstPass.outputFiles) {
      try {
        await (await import('node:fs/promises')).unlink(f)
      } catch {
        /* ignore */
      }
    }
    const intervalSec = duration / maxFrames
    const secondPass = await runKeyframePass(input, {
      strategy: 'uniform',
      threshold: opts.threshold ?? 0.3,
      intervalSec,
      pattern,
      format,
      quality,
      duration,
      onProgress: opts.onProgress,
    })
    return {
      frames: buildKeyframeList(secondPass.timestamps, secondPass.outputFiles),
      effectiveStrategy: 'uniform',
    }
  }

  return {
    frames: buildKeyframeList(firstPass.timestamps, firstPass.outputFiles),
    effectiveStrategy: opts.strategy,
  }
}

/** 单次 ffmpeg 抽帧执行 */
async function runKeyframePass(
  input: string,
  p: {
    strategy: KeyframeStrategy
    threshold: number
    intervalSec: number
    pattern: string
    format: 'jpg' | 'png'
    quality: number
    duration: number
    onProgress?: (prog: FfmpegProgress) => void
  },
): Promise<{ timestamps: number[]; outputFiles: string[] }> {
  const { readdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')

  let filter: string
  switch (p.strategy) {
    case 'scene':
      filter = `select='gt(scene,${p.threshold})',showinfo`
      break
    case 'iframe':
      filter = "select='eq(pict_type,I)',showinfo"
      break
    case 'uniform':
      filter = `fps=1/${p.intervalSec}`
      break
  }

  const args = [
    '-i', input,
    '-vf', filter,
    '-vsync', 'vfr',
    '-q:v', String(p.quality),
    '-an', // 丢弃音频（抽帧不需要）
    p.pattern,
  ]

  const result = await runFfmpeg(args, {
    totalDurationSec: p.duration,
    onProgress: p.onProgress,
  })

  if (result.code !== 0) {
    throw new Error(`关键帧提取失败 (退出码 ${result.code}): ${result.stderr.slice(-500)}`)
  }

  const timestamps = parseShowinfoTimestamps(result.stderr)
  // showinfo 只在 scene/iframe 模式输出；uniform 模式从产物文件数推断时间戳
  let effectiveTimestamps = timestamps
  if (timestamps.length === 0 && p.strategy === 'uniform') {
    const files = readdirSync(dirname(p.pattern)).filter((f) =>
      new RegExp(`kf_[\\w-]+_\\d{4}\\.${p.format}$`).test(f),
    )
    effectiveTimestamps = files.map((_, i) => i * p.intervalSec)
  }

  const outputFiles = readdirSync(dirname(p.pattern))
    .filter((f) => new RegExp(`kf_[\\w-]+_\\d{4}\\.${p.format}$`).test(f))
    .sort()
    .map((f) => join(dirname(p.pattern), f))

  return { timestamps: effectiveTimestamps, outputFiles }
}

/** 把时间戳和文件列表组装成 ExtractedKeyframe[] */
function buildKeyframeList(
  timestamps: number[],
  files: string[],
): ExtractedKeyframe[] {
  const len = Math.min(timestamps.length, files.length)
  const result: ExtractedKeyframe[] = []
  for (let i = 0; i < len; i++) {
    result.push({
      path: files[i],
      timestampSec: timestamps[i],
      index: i,
    })
  }
  // 文件数多于时间戳时（罕见），补 0 时间戳
  for (let i = len; i < files.length; i++) {
    result.push({ path: files[i], timestampSec: 0, index: i })
  }
  return result
}

/**
 * 提取指定时间点的帧（手动标记提取）。
 * 每个时间点抽一帧，用于工作台「手动标记时间点 → 批量提取」。
 */
export async function extractFramesAtTimes(
  input: string,
  timesSec: number[],
  outputDir: string,
  opts: { format?: 'jpg' | 'png'; quality?: number; onProgress?: (p: FfmpegProgress) => void } = {},
): Promise<ExtractedKeyframe[]> {
  const { mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { randomUUID } = await import('node:crypto')

  mkdirSync(outputDir, { recursive: true })
  const format = opts.format ?? 'jpg'
  const quality = opts.quality ?? 2
  const sessionId = randomUUID().slice(0, 8)
  const probe = await probeVideo(input)

  const results: ExtractedKeyframe[] = []
  for (let i = 0; i < timesSec.length; i++) {
    const t = timesSec[i]
    const outPath = join(outputDir, `manual_${sessionId}_${String(i).padStart(4, '0')}.${format}`)
    // -ss 在 -i 前是 seek 模式（快），单帧提取用此
    const args = [
      '-ss', String(Math.max(0, t)),
      '-i', input,
      '-frames:v', '1',
      '-q:v', String(quality),
      '-an',
      outPath,
    ]
    const result = await runFfmpeg(args, {
      totalDurationSec: probe.durationSec,
      onProgress: opts.onProgress
        ? (prog) => opts.onProgress!({ ...prog, percent: ((i + prog.currentTimeSec / Math.max(t, 0.1)) / timesSec.length) * 100 })
        : undefined,
    })
    if (result.code !== 0) {
      log.warn(`时间点 ${t}s 提取失败: ${result.stderr.slice(-200)}`)
      continue
    }
    results.push({ path: outPath, timestampSec: t, index: i })
  }
  return results
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 缩略图生成（修复视频资产 thumbnailUrl 缺口）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 从视频提取一帧作为缩略图（默认取第 1 秒）。
 * 用于修复画布视频资产 thumbnailUrl 缺失。
 */
export async function generateThumbnail(
  input: string,
  outputPath: string,
  opts: { atSec?: number; width?: number } = {},
): Promise<{ path: string }> {
  const { dirname } = await import('node:path')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dirname(outputPath), { recursive: true })

  const atSec = opts.atSec ?? 1
  const vf = opts.width ? `scale=${opts.width}:-2` : null
  const args = [
    '-ss', String(atSec),
    '-i', input,
    '-frames:v', '1',
    ...(vf ? ['-vf', vf] : []),
    '-q:v', '3',
    '-an',
    '-y', // 覆盖
    outputPath,
  ]
  const result = await runFfmpeg(args, { timeoutMs: 30_000 })
  if (result.code !== 0) {
    throw new Error(`缩略图生成失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

// ═══════════════════════════════════════════════════════════════════════════
// 导出 escapeFilterValue 供 P3/P4 复用（拼接 filter_complex 时用到）
// ═══════════════════════════════════════════════════════════════════════════

export { escapeFilterValue }
