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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
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
  onProgress?: ((p: FfmpegProgress) => void) | undefined
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
  // 等待槽位；releaseSlot 会调用 resolver 把槽位「让渡」给本调用方。
  // 关键：runningCount 在 release 时不递减，而是由被唤醒的 acquire 不再递增
  // （槽位已让渡）。这样避免了「resolve 后 runningCount++ 尚未执行」的竞态窗口，
  // 以及「await 期间被 abort 丢弃 → resolver 触发但没人 ++ → 永久泄漏」的问题。
  await new Promise<void>((resolve) => waitQueue.push(resolve))
}

function releaseSlot(): void {
  const next = waitQueue.shift()
  if (next) {
    // 槽位直接让渡给等待者，runningCount 不变
    next()
  } else {
    runningCount--
  }
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
      let settled = false
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
          const frameText = m?.[1]
          const fpsText = m?.[2]
          const hoursText = m?.[3]
          const minutesText = m?.[4]
          const secondsText = m?.[5]
          if (frameText && fpsText && hoursText && minutesText && secondsText) {
            const currentTimeSec = parseTimeToSec(hoursText, minutesText, secondsText)
            const percent =
              opts.totalDurationSec && opts.totalDurationSec > 0
                ? Math.min(100, (currentTimeSec / opts.totalDurationSec) * 100)
                : -1
            opts.onProgress({
              percent,
              frame: parseInt(frameText, 10),
              fps: parseFloat(fpsText),
              currentTimeSec,
            })
          }
        }
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
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
  await acquireSlot()
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(ffprobe, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let settled = false
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
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
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) resolve(stdout)
        else reject(new Error(`ffprobe 失败 (退出码 ${code}): ${stderr.trim()}`))
      })
    })
  } finally {
    releaseSlot()
  }
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

/**
 * 专供 subtitles 滤镜的路径转义。
 *
 * subtitles= 滤镜对路径有严格转义要求，比通用 filter 多一项冒号转义
 * （Windows 盘符 `C:\` 的冒号会被 libavfilter 误认为 filtergraph stream label）。
 * 转义顺序：先反斜杠，再冒号，最后单引号。
 */
function escapeSubtitlePath(p: string): string {
  return p
    .replace(/\\/g, '\\\\')  // 反斜杠先转义（后续转义产生的 \ 不会再被处理）
    .replace(/:/g, '\\:')     // 冒号转义（Windows 盘符关键）
    .replace(/'/g, "\\'")     // 单引号转义
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
    if (num !== undefined && den && !Number.isNaN(num)) {
      fps = Math.round((num / den) * 100) / 100
    }
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
  threshold?: number | undefined
  /** uniform 模式采样间隔（秒），如 10 表示每 10 秒一帧 */
  intervalSec?: number | undefined
  /** 上限保护：超过此数退化均匀采样。默认 20 */
  maxFrames?: number | undefined
  /** 输出目录（绝对路径） */
  outputDir: string
  /** 输出格式 */
  format?: 'jpg' | 'png' | undefined
  /** 质量 -q:v，2~31，默认 2（高质量） */
  quality?: number | undefined
  /** 进度回调 */
  onProgress?: ((p: FfmpegProgress) => void) | undefined
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
    const timestamp = m[1]
    if (timestamp !== undefined) timestamps.push(parseFloat(timestamp))
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
        await unlink(f)
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
    onProgress?: ((prog: FfmpegProgress) => void) | undefined
  },
): Promise<{ timestamps: number[]; outputFiles: string[] }> {

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
    '-fps_mode', 'vfr', // ffmpeg 5.1+ 语法（替代已移除的 -vsync vfr）
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
    const path = files[i]
    const timestampSec = timestamps[i]
    if (path === undefined || timestampSec === undefined) continue
    result.push({
      path,
      timestampSec,
      index: i,
    })
  }
  // 文件数多于时间戳时（罕见），补 0 时间戳
  for (let i = len; i < files.length; i++) {
    const path = files[i]
    if (path !== undefined) result.push({ path, timestampSec: 0, index: i })
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
  opts: {
    format?: 'jpg' | 'png' | undefined
    quality?: number | undefined
    onProgress?: ((p: FfmpegProgress) => void) | undefined
  } = {},
): Promise<ExtractedKeyframe[]> {

  mkdirSync(outputDir, { recursive: true })
  const format = opts.format ?? 'jpg'
  const quality = opts.quality ?? 2
  const sessionId = randomUUID().slice(0, 8)
  const probe = await probeVideo(input)

  const results: ExtractedKeyframe[] = []
  for (let i = 0; i < timesSec.length; i++) {
    const t = timesSec[i]
    if (t === undefined) continue
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
    // 校验产物文件确实存在（seek 模式下可能 exit 0 但未生成文件）
    if (!existsSync(outPath)) {
      log.warn(`时间点 ${t}s 提取后文件不存在: ${outPath}`)
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
  opts: { atSec?: number | undefined; width?: number | undefined } = {},
): Promise<{ path: string }> {
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
// 4. 视频剪辑
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 裁剪视频片段。
 *
 * @param opts.startSec 起始秒
 * @param opts.endSec   结束秒
 * @param opts.copy     true=流拷贝(无损快切，-c copy)；false=重编码(精确切，默认 true)
 *
 * copy 模式用 `-ss` 在 `-i` 前(seek 模式，快)；精确切用 `-ss` 在 `-i` 后。
 */
export async function trimVideo(
  input: string,
  outputPath: string,
  opts: {
    startSec: number
    endSec: number
    copy?: boolean | undefined
    onProgress?: ((p: FfmpegProgress) => void) | undefined
  },
): Promise<{ path: string }> {
  const { startSec, endSec, copy = true } = opts
  const duration = endSec - startSec
  if (duration <= 0) throw new Error(`无效的裁剪区间: ${startSec}~${endSec}`)

  const args: string[] = []
  if (copy) {
    // seek 模式：-ss 在 -i 前，快
    args.push('-ss', String(startSec), '-i', input, '-t', String(duration), '-c', 'copy')
  } else {
    // 精确模式：-ss 在 -i 后，重编码
    args.push('-ss', String(startSec), '-i', input, '-t', String(duration), '-c:v', 'libx264', '-c:a', 'aac')
  }
  args.push('-y', outputPath)

  const result = await runFfmpeg(args, {
    totalDurationSec: duration,
    onProgress: opts.onProgress,
  })
  if (result.code !== 0) {
    throw new Error(`视频裁剪失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/**
 * 合并多个视频。
 *
 * 先 probe 各段编码是否一致：
 *   - 一致 → concat demuxer（无损快，-c copy）
 *   - 不一致 → concat filter（重编码）
 *
 * concat demuxer 需要一个 list.txt 文件（file '路径' 每行一个）。
 */
export async function concatVideos(
  inputs: string[],
  outputPath: string,
  opts: { onProgress?: ((p: FfmpegProgress) => void) | undefined } = {},
): Promise<{ path: string }> {
  if (inputs.length < 2) throw new Error('合并至少需要 2 个视频')

  // 检查编码一致性
  const probes = await Promise.all(inputs.map((f) => probeVideo(f)))
  const firstCodec = probes[0]!.videoCodec
  const allSameCodec = probes.every((p) => p.videoCodec === firstCodec)
  const totalDuration = probes.reduce((sum, p) => sum + p.durationSec, 0)

  if (allSameCodec) {
    // concat demuxer（无损快）
    const listPath = join(tmpdir(), `concat-${randomUUID()}.txt`)
    // 路径里的单引号需转义
    const listContent = inputs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
    writeFileSync(listPath, listContent)

    try {
      const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outputPath]
      const result = await runFfmpeg(args, { totalDurationSec: totalDuration, onProgress: opts.onProgress })
      if (result.code !== 0) {
        throw new Error(`视频合并失败(demuxer): ${result.stderr.slice(-300)}`)
      }
      return { path: outputPath }
    } finally {
      try {
        await unlink(listPath)
      } catch {
        /* ignore */
      }
    }
  }

  // concat filter（重编码，异源）
  // 根据是否所有输入都有音频，决定 concat 是否带音频流
  const allHaveAudio = probes.every((p) => p.hasAudio)
  const inputLabels = inputs
    .map((_, i) => `[${i}:v:0]${allHaveAudio ? `[${i}:a:0]` : ''}`)
    .join('')
  const args = [
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex',
    allHaveAudio
      ? `${inputLabels}concat=n=${inputs.length}:v=1:a=1[outv][outa]`
      : `${inputLabels}concat=n=${inputs.length}:v=1:a=0[outv]`,
    '-map', '[outv]',
    ...(allHaveAudio ? ['-map', '[outa]'] : []),
    '-c:v', 'libx264',
    ...(allHaveAudio ? ['-c:a', 'aac'] : ['-an']),
    '-y',
    outputPath,
  ]
  const result = await runFfmpeg(args, { totalDurationSec: totalDuration, onProgress: opts.onProgress })
  if (result.code !== 0) {
    throw new Error(`视频合并失败(filter): ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/**
 * 按固定时长分割视频。
 *
 * @param opts.segmentSec 每段时长（秒）
 * @returns 各段文件路径列表
 */
export async function segmentVideo(
  input: string,
  outputPattern: string,
  opts: { segmentSec: number; onProgress?: ((p: FfmpegProgress) => void) | undefined },
): Promise<{ paths: string[] }> {
  const probe = await probeVideo(input)
  const args = [
    '-i', input,
    '-f', 'segment',
    '-segment_time', String(opts.segmentSec),
    '-reset_timestamps', '1',
    '-c', 'copy',
    '-y',
    outputPattern, // 如 seg_%03d.mp4
  ]
  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress: opts.onProgress })
  if (result.code !== 0) {
    throw new Error(`视频分割失败: ${result.stderr.slice(-300)}`)
  }
  // 收集产物（按 pattern 的目录扫描 seg_*.mp4）
  const dir = dirname(outputPattern)
  const base = basename(outputPattern).replace(/%0?\d?d/g, '\\d+')
  const regex = new RegExp(`^${base}$`)
  const paths = readdirSync(dir)
    .filter((f) => regex.test(f))
    .sort()
    .map((f) => join(dir, f))
  return { paths }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 转码与格式转换
// ═══════════════════════════════════════════════════════════════════════════

export interface TranscodeOpts {
  format?: 'mp4' | 'webm' | 'mov' | 'gif' | undefined
  videoCodec?: 'libx264' | 'libx265' | 'libvpx-vp9' | 'copy' | undefined
  audioCodec?: 'aac' | 'libopus' | 'none' | undefined
  resolution?: { w: number; h: number } | undefined
  bitrate?: string | undefined // 如 '2M'
  crf?: number | undefined // 18~28
  fps?: number | undefined
}

/**
 * 转码/格式转换。
 *
 * GIF 特殊处理：两 pass（palettegen + paletteuse）以获得高质量调色板。
 */
export async function transcodeVideo(
  input: string,
  outputPath: string,
  opts: TranscodeOpts,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<{ path: string }> {
  const probe = await probeVideo(input)

  // GIF 两 pass
  if (opts.format === 'gif' || outputPath.toLowerCase().endsWith('.gif')) {
    return transcodeToGif(input, outputPath, opts, probe.durationSec, onProgress)
  }

  const args: string[] = ['-i', input]
  if (opts.resolution) {
    args.push('-vf', `scale=${opts.resolution.w}:${opts.resolution.h}`)
  }
  if (opts.fps) {
    args.push('-r', String(opts.fps))
  }
  if (opts.videoCodec && opts.videoCodec !== 'copy') {
    args.push('-c:v', opts.videoCodec)
    if (opts.crf != null) args.push('-crf', String(opts.crf))
  } else if (opts.videoCodec === 'copy') {
    args.push('-c:v', 'copy')
  } else {
    args.push('-c:v', 'libx264')
    if (opts.crf != null) args.push('-crf', String(opts.crf))
  }
  if (opts.audioCodec === 'none') {
    args.push('-an')
  } else if (opts.audioCodec) {
    args.push('-c:a', opts.audioCodec)
  } else {
    args.push('-c:a', 'aac')
  }
  if (opts.bitrate) args.push('-b:v', opts.bitrate)
  args.push('-y', outputPath)

  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress })
  if (result.code !== 0) {
    throw new Error(`转码失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/** GIF 两 pass 转码（palettegen + paletteuse） */
async function transcodeToGif(
  input: string,
  outputPath: string,
  opts: TranscodeOpts,
  duration: number,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<{ path: string }> {

  mkdirSync(dirname(outputPath), { recursive: true })
  const palettePath = join(tmpdir(), `palette-${randomUUID()}.png`)
  const width = opts.resolution?.w ?? 480
  const fps = opts.fps ?? 15

  // pass 1: 生成调色板
  const pass1Args = [
    '-i', input,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`,
    '-y', palettePath,
  ]
  const pass1 = await runFfmpeg(pass1Args, { totalDurationSec: duration })
  if (pass1.code !== 0) {
    throw new Error(`GIF 调色板生成失败: ${pass1.stderr.slice(-200)}`)
  }

  // pass 2: 应用调色板
  try {
    const pass2Args = [
      '-i', input,
      '-i', palettePath,
      '-filter_complex', `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
      '-y', outputPath,
    ]
    const pass2 = await runFfmpeg(pass2Args, { totalDurationSec: duration, onProgress })
    if (pass2.code !== 0) {
      throw new Error(`GIF 生成失败: ${pass2.stderr.slice(-300)}`)
    }
    return { path: outputPath }
  } finally {
    try {
      await unlink(palettePath)
    } catch {
      /* ignore */
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 画面处理
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 调整播放速度。
 *
 * 视频: setpts=1/{factor}*PTS（factor>1 加速，<1 减速）
 * 音频: atempo={factor}（范围 0.5~2，超出则串接，如 3x → atempo=2,atempo=1.5）
 */
export async function adjustSpeed(
  input: string,
  outputPath: string,
  factor: number,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<{ path: string }> {
  if (factor <= 0) throw new Error(`无效的速度倍率: ${factor}`)
  const probe = await probeVideo(input)
  const videoFilter = `setpts=${(1 / factor).toFixed(4)}*PTS`
  // atempo 链：0.5~2 一个单元，超出串接
  const atempoChain = buildAtempoChain(factor)
  const hasAudio = probe.hasAudio
  const args = hasAudio
    ? ['-i', input, '-filter_complex', `[0:v]${videoFilter}[v];[0:a]${atempoChain}[a]`, '-map', '[v]', '-map', '[a]']
    : ['-i', input, '-vf', videoFilter]
  args.push('-c:v', 'libx264', ...(hasAudio ? ['-c:a', 'aac'] : ['-an']), '-y', outputPath)

  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress })
  if (result.code !== 0) {
    throw new Error(`变速失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/** 构造 atempo 滤镜链，处理超出 0.5~2 范围的倍率 */
function buildAtempoChain(factor: number): string {
  const parts: string[] = []
  let remaining = factor
  while (remaining > 2) {
    parts.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5')
    remaining /= 0.5
  }
  parts.push(`atempo=${remaining.toFixed(4)}`)
  return parts.join(',')
}

/**
 * 视频倒放（画面 + 可选音频）。
 */
export async function reverseVideo(
  input: string,
  outputPath: string,
  opts: {
    reverseAudio?: boolean | undefined
    onProgress?: ((p: FfmpegProgress) => void) | undefined
  } = {},
): Promise<{ path: string }> {
  const probe = await probeVideo(input)
  const audioPart = opts.reverseAudio && probe.hasAudio ? ';[0:a]areverse[a]' : ''
  const args = audioPart
    ? ['-i', input, '-filter_complex', `[0:v]reverse[v]${audioPart}`, '-map', '[v]', '-map', '[a]']
    : ['-i', input, '-vf', 'reverse']
  args.push('-c:v', 'libx264', ...(audioPart ? ['-c:a', 'aac'] : ['-an']), '-y', outputPath)

  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress: opts.onProgress })
  if (result.code !== 0) {
    throw new Error(`倒放失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/**
 * 画面裁剪（指定区域）。
 */
export async function cropVideo(
  input: string,
  outputPath: string,
  opts: {
    w: number
    h: number
    x: number
    y: number
    onProgress?: ((p: FfmpegProgress) => void) | undefined
  },
): Promise<{ path: string }> {
  const probe = await probeVideo(input)
  const args = [
    '-i', input,
    '-vf', `crop=${opts.w}:${opts.h}:${opts.x}:${opts.y}`,
    '-c:v', 'libx264', '-c:a', 'aac',
    '-y', outputPath,
  ]
  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress: opts.onProgress })
  if (result.code !== 0) {
    throw new Error(`画面裁剪失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/**
 * 添加图片水印。
 *
 * @param opts.position 九宫格位置
 * @param opts.scale 水印相对视频宽度的比例（如 0.2 = 水印宽度为视频的 20%）
 */
export async function addWatermark(
  input: string,
  logoPath: string,
  outputPath: string,
  opts: {
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
    scale?: number | undefined
    onProgress?: ((p: FfmpegProgress) => void) | undefined
  },
): Promise<{ path: string }> {
  const probe = await probeVideo(input)
  const scale = opts.scale ?? 0.2
  const overlayExpr = {
    'top-left': '10:10',
    'top-right': 'W-w-10:10',
    'bottom-left': '10:H-h-10',
    'bottom-right': 'W-w-10:H-h-10',
    center: '(W-w)/2:(H-h)/2',
  }[opts.position]

  const args = [
    '-i', input,
    '-i', logoPath,
    '-filter_complex', `[1:v]scale=iw*${scale}:-1[wm];[0:v][wm]overlay=${overlayExpr}`,
    '-c:v', 'libx264', '-c:a', 'copy',
    '-y', outputPath,
  ]
  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress: opts.onProgress })
  if (result.code !== 0) {
    throw new Error(`添加水印失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

/**
 * 烧录字幕（硬字幕，字幕嵌入画面）。
 *
 * subtitles 滤镜的路径转义要求严格（ffmpeg 文档）：
 *   - 反斜杠 `\` → `\\`
 *   - 单引号 `'` → `\'`
 *   - 冒号 `:` → `\:` （Windows 盘符 C:\ 必须转义，否则被当 filtergraph stream label）
 *   - 整个表达式用单引号包裹
 *
 * @param srtPath .srt 字幕文件路径
 */
export async function burnSubtitle(
  input: string,
  srtPath: string,
  outputPath: string,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<{ path: string }> {
  const probe = await probeVideo(input)
  const escapedSrt = escapeSubtitlePath(srtPath)
  const args = [
    '-i', input,
    '-vf', `subtitles='${escapedSrt}'`,
    '-c:v', 'libx264', '-c:a', 'copy',
    '-y', outputPath,
  ]
  const result = await runFfmpeg(args, { totalDurationSec: probe.durationSec, onProgress })
  if (result.code !== 0) {
    throw new Error(`烧录字幕失败: ${result.stderr.slice(-300)}`)
  }
  return { path: outputPath }
}

// ═══════════════════════════════════════════════════════════════════════════
// 导出 escapeFilterValue（供 burnSubtitle 等内部使用，也供未来扩展）
// ═══════════════════════════════════════════════════════════════════════════

export { escapeFilterValue }
