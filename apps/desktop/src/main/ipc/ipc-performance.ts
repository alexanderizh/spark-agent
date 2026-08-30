export type IpcPerformanceOutcome = 'ok' | 'error'

export interface IpcPerformanceSummary {
  channel: string
  samples: number
  errors: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  budgetMs: number | null
}

export interface IpcPerformanceMeasurement {
  durationMs: number
  budgetMs: number | null
  slow: boolean
  report: IpcPerformanceSummary[] | null
}

type IpcPerformanceSample = {
  durationMs: number
  outcome: IpcPerformanceOutcome
}

type IpcPerformanceTrackerOptions = {
  maxSamplesPerChannel?: number
  reportEvery?: number
  maxReportedChannels?: number
  budgetsMs?: Readonly<Record<string, number>>
}

const INTERACTION_BUDGETS_MS: Readonly<Record<string, number>> = {
  'session:list': 50,
  'session:create': 100,
  'session:submit-turn': 100,
  'session:update': 100,
  'provider:create': 100,
  'provider:update': 100,
  'model:create': 100,
  'model:update': 100,
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.max(0, Math.ceil(sortedValues.length * ratio) - 1)
  return sortedValues[index] ?? 0
}

/**
 * 有界的 IPC 耗时采样器。
 *
 * 只保留通道名、耗时和成功/失败状态，不接触请求或响应载荷。统计位于内存中，
 * 每个通道最多保留固定数量样本，避免诊断能力反过来制造主进程压力。
 */
export class IpcPerformanceTracker {
  private readonly samplesByChannel = new Map<string, IpcPerformanceSample[]>()
  private readonly pendingReportChannels = new Set<string>()
  private readonly maxSamplesPerChannel: number
  private readonly reportEvery: number
  private readonly maxReportedChannels: number
  private readonly budgetsMs: Readonly<Record<string, number>>
  private invocationCount = 0

  constructor(options: IpcPerformanceTrackerOptions = {}) {
    this.maxSamplesPerChannel = Math.max(1, Math.floor(options.maxSamplesPerChannel ?? 200))
    this.reportEvery = Math.max(1, Math.floor(options.reportEvery ?? 50))
    this.maxReportedChannels = Math.max(1, Math.floor(options.maxReportedChannels ?? 10))
    this.budgetsMs = options.budgetsMs ?? INTERACTION_BUDGETS_MS
  }

  record(
    channel: string,
    durationMs: number,
    outcome: IpcPerformanceOutcome,
  ): IpcPerformanceMeasurement {
    const normalizedDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
    const samples = this.samplesByChannel.get(channel) ?? []
    samples.push({ durationMs: normalizedDuration, outcome })
    if (samples.length > this.maxSamplesPerChannel) {
      samples.splice(0, samples.length - this.maxSamplesPerChannel)
    }
    this.samplesByChannel.set(channel, samples)
    this.pendingReportChannels.add(channel)
    this.invocationCount += 1

    const budgetMs = this.budgetsMs[channel] ?? null
    const report = this.invocationCount % this.reportEvery === 0 ? this.takePendingReport() : null

    return {
      durationMs: roundMs(normalizedDuration),
      budgetMs,
      slow: budgetMs != null && normalizedDuration > budgetMs,
      report,
    }
  }

  snapshot(): IpcPerformanceSummary[] {
    return [...this.samplesByChannel.keys()]
      .map((channel) => this.summarize(channel))
      .filter((summary): summary is IpcPerformanceSummary => summary != null)
      .sort((left, right) => right.p95Ms - left.p95Ms || left.channel.localeCompare(right.channel))
  }

  private takePendingReport(): IpcPerformanceSummary[] {
    const report = [...this.pendingReportChannels]
      .map((channel) => this.summarize(channel))
      .filter((summary): summary is IpcPerformanceSummary => summary != null)
      .sort((left, right) => right.p95Ms - left.p95Ms || left.channel.localeCompare(right.channel))
      .slice(0, this.maxReportedChannels)
    this.pendingReportChannels.clear()
    return report
  }

  private summarize(channel: string): IpcPerformanceSummary | null {
    const samples = this.samplesByChannel.get(channel)
    if (samples == null || samples.length === 0) return null
    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b)
    return {
      channel,
      samples: samples.length,
      errors: samples.filter((sample) => sample.outcome === 'error').length,
      p50Ms: roundMs(percentile(durations, 0.5)),
      p95Ms: roundMs(percentile(durations, 0.95)),
      maxMs: roundMs(durations[durations.length - 1] ?? 0),
      budgetMs: this.budgetsMs[channel] ?? null,
    }
  }
}

export const ipcPerformanceTracker = new IpcPerformanceTracker()
