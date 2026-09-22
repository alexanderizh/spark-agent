/**
 * @module resource-monitor/collectors
 *
 * 轻量采集器（同步/低开销）+ 共享 exec 助手：
 *  - HostProcessCollector：process.memoryUsage() + getActiveResourcesInfo()（同步零开销）。
 *  - EventLoopDelayCollector：自有 monitorEventLoopDelay 直方图 + EMA(α=0.3) 平滑。
 *  - SystemMemoryCollector：macOS vm_stat / Linux /proc/meminfo / Windows PowerShell，
 *    10s 缓存（os.freemem 不含 purgeable，不采用——方案 §3.1）。
 *
 * 采集自身不能成为压力源（首要设计约束）：全部外部命令单次批量、带超时、
 * 失败由调用方做指数退避（上限 60s）。
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'
import type {
  EventLoopDelaySummary,
  HostProcessSummary,
  SystemMemorySummary,
} from '@spark/protocol'

/** 共享 exec 助手：utf8 文本输出，超时/失败返回 null（绝不抛出）。 */
export function execText(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        resolve(error == null && stdout.length > 0 ? stdout : null)
      },
    )
  })
}

// ─── 宿主主进程 ───────────────────────────────────────────────────────────────

export function collectHostProcessSummary(): HostProcessSummary {
  const usage = process.memoryUsage()
  const activeResources =
    typeof process.getActiveResourcesInfo === 'function'
      ? process.getActiveResourcesInfo().length
      : null
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    activeResources,
    // CPU 占用由服务层 process.cpuUsage 差分填充（采集器保持纯快照）。
    cpuPct: null,
    cpuPeakPct: null,
  }
}

// ─── 事件循环延迟（monitorLoop 风格 + EMA 平滑）───────────────────────────────

const EMA_ALPHA = 0.3

export class EventLoopDelayCollector {
  private histogram: IntervalHistogram | null = null
  private smoothedMaxMs: number | null = null

  start(): void {
    if (this.histogram != null) return
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 20 })
      this.histogram.enable()
    } catch {
      this.histogram = null
    }
  }

  stop(): void {
    if (this.histogram == null) return
    try {
      this.histogram.disable()
    } catch {
      // ignore
    }
    this.histogram = null
  }

  /**
   * 读取并复位直方图（每 tick 一次）。EMA(α=0.3) 平滑 max 防单毛刺误判。
   * 直方图不可用（受限运行时）时返回全 0（指标不参与定级由空值语义兜底——
   * 这里 0 表示测得无延迟，采集器缺失场景由 staleFields 标记）。
   */
  sample(): EventLoopDelaySummary {
    const histogram = this.histogram
    if (histogram == null) {
      return { maxDelayMs: 0, meanDelayMs: 0, smoothedMaxDelayMs: 0 }
    }
    const maxMs = histogram.max / 1e6
    const meanMs = histogram.mean / 1e6
    histogram.reset()
    this.smoothedMaxMs =
      this.smoothedMaxMs == null ? maxMs : EMA_ALPHA * maxMs + (1 - EMA_ALPHA) * this.smoothedMaxMs
    return {
      maxDelayMs: roundTo3(maxMs),
      meanDelayMs: roundTo3(meanMs),
      smoothedMaxDelayMs: roundTo3(this.smoothedMaxMs),
    }
  }

  /** 基线 resample / 休眠恢复后重新预热 EMA（方案 §3.3.1-2）。 */
  resetSmoothing(): void {
    this.smoothedMaxMs = null
  }
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000
}

// ─── 系统整体内存 ─────────────────────────────────────────────────────────────

/** 系统内存采集结果（totalBytes 用于基线漂移检测，available 为 vm_stat 口径）。 */
export interface SystemMemorySample {
  totalBytes: number
  availableBytes: number | null
  usedPct: number | null
}

export const SYSTEM_MEMORY_CACHE_MS = 10_000

/** 单次系统内存采集（不做缓存；缓存由服务层按 cadence 控制）。 */
export async function collectSystemMemoryOnce(): Promise<SystemMemorySample | null> {
  if (process.platform === 'darwin') return collectDarwinSystemMemory()
  if (process.platform === 'linux') return collectLinuxSystemMemory()
  if (process.platform === 'win32') return collectWindowsSystemMemory()
  return null
}

/** macOS：vm_stat（page_size × 页数；available ≈ free + inactive + speculative + purgeable）。 */
async function collectDarwinSystemMemory(): Promise<SystemMemorySample | null> {
  const output = await execText('vm_stat', [], 2_000)
  if (output == null) return null
  const pageSizeMatch = /page size of (\d+) bytes/.exec(output)
  const pageSize = pageSizeMatch != null ? Number(pageSizeMatch[1]) : 4096
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null
  const pageCount = (label: string): number | null => {
    const match = new RegExp(`${label}[^:]*:\\s+(\\d+)\\.`, 'i').exec(output)
    if (match == null) return null
    const value = Number(match[1])
    return Number.isFinite(value) ? value : null
  }
  const free = pageCount('Pages free')
  const inactive = pageCount('Pages inactive')
  const speculative = pageCount('Pages speculative')
  const purgeable = pageCount('Pages purgeable')
  const wired = pageCount('Pages wired down')
  const active = pageCount('Pages active')
  const compressed = pageCount('Pages occupied by compressor')
  const filedAnonymous = pageCount('Pages filed')
  if (
    free == null ||
    inactive == null ||
    speculative == null ||
    wired == null ||
    active == null ||
    compressed == null
  ) {
    return null
  }
  const total = free + inactive + speculative + wired + active + compressed + (filedAnonymous ?? 0)
  if (total <= 0) return null
  const available =
    free + inactive + speculative + (purgeable != null && purgeable > 0 ? purgeable : 0)
  const usedPct = pct(total - available, total)
  return {
    totalBytes: total * pageSize,
    availableBytes: available * pageSize,
    usedPct,
  }
}

/** Linux：/proc/meminfo（MemTotal / MemAvailable，kB）。 */
async function collectLinuxSystemMemory(): Promise<SystemMemorySample | null> {
  let content: string
  try {
    content = await readFile('/proc/meminfo', 'utf8')
  } catch {
    return null
  }
  const valueKb = (label: string): number | null => {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\s*kB`, 'm').exec(content)
    if (match == null) return null
    const value = Number(match[1])
    return Number.isFinite(value) ? value : null
  }
  const totalKb = valueKb('MemTotal')
  if (totalKb == null || totalKb <= 0) return null
  const availableKb = valueKb('MemAvailable')
  const availableBytes = availableKb != null ? availableKb * 1024 : null
  return {
    totalBytes: totalKb * 1024,
    availableBytes,
    usedPct: availableKb != null ? pct(totalKb - availableKb, totalKb) : null,
  }
}

/** Windows：PowerShell Get-CimInstance（Win11 24H2 已移除 wmic，方案 §3.1）。 */
async function collectWindowsSystemMemory(): Promise<SystemMemorySample | null> {
  const output = await execText(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance Win32_OperatingSystem) | ' +
        'ForEach-Object { "{0} {1}" -f $_.TotalVisibleMemorySize, $_.FreePhysicalMemory }',
    ],
    4_000,
  )
  if (output == null) return null
  const match = /^(\d+)\s+(\d+)$/.exec(output.trim())
  if (match == null) return null
  const totalBytes = Number(match[1]) * 1024
  const freeBytes = Number(match[2]) * 1024
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null
  return {
    totalBytes,
    availableBytes: Number.isFinite(freeBytes) ? freeBytes : null,
    usedPct: pct(totalBytes - freeBytes, totalBytes),
  }
}

function pct(used: number, total: number): number {
  return Math.round((used / total) * 1000) / 10
}

/** 把原始采集结果包装为契约 SystemMemorySummary（stale 由服务层维护）。 */
export function toSystemMemorySummary(
  sample: SystemMemorySample,
  stale: boolean,
): SystemMemorySummary {
  return {
    totalBytes: sample.totalBytes,
    availableBytes: sample.availableBytes,
    usedPct: sample.usedPct,
    platform: process.platform,
    stale,
  }
}
