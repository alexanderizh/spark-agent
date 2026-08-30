export type ComputerUseMetricName =
  | 'native_host_capability_ms'
  | 'permission_request_ms'
  | 'observation_ms'
  | 'action_ms'
  | 'action_execute_ms'
  | 'action_post_observation_ms'
  | 'takeover_stop_ms'
  | 'four_step_task_ms'

export interface ComputerUseMetricDimensions {
  readonly platform: string
  readonly architecture: string
  readonly appVersion: string
  readonly hostVersion: string
  readonly trustMode: string
}

/**
 * Execution transport outcome counters, complementing the duration buckets: the share
 * of actions the native host executed in the background over AX vs the foreground HID
 * path, and each channel's success rate. 'unset' covers hosts that predate channel
 * reporting and failures that happen before a channel is chosen.
 */
export type ComputerUseExecutionChannel = 'background_ax' | 'foreground_cg' | 'unset'

export interface ComputerUseChannelOutcomeSnapshot {
  readonly channel: ComputerUseExecutionChannel
  readonly count: number
  readonly failures: number
  readonly successRate: number
  readonly share: number
}

export interface ComputerUseChannelMetricsSnapshot {
  readonly total: number
  readonly backgroundShare: number
  readonly channels: ComputerUseChannelOutcomeSnapshot[]
}

export interface ComputerUseMetricSnapshot {
  readonly name: ComputerUseMetricName
  readonly dimensions: ComputerUseMetricDimensions
  readonly count: number
  readonly failures: number
  readonly minMs: number
  readonly maxMs: number
  readonly averageMs: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
}

interface MetricBucket {
  readonly name: ComputerUseMetricName
  readonly dimensions: ComputerUseMetricDimensions
  readonly samples: Array<{ durationMs: number; failed: boolean }>
  failures: number
}

const MAX_SAMPLES_PER_BUCKET = 2_048

/**
 * Content-free, process-local Computer Use metrics. It records only durations, outcomes,
 * and coarse runtime dimensions; screenshots, input text, targets, and user content never
 * enter this collector.
 */
export class ComputerUseMetricsCollector {
  private readonly buckets = new Map<string, MetricBucket>()
  private readonly channelOutcomes = new Map<
    ComputerUseExecutionChannel,
    { count: number; failures: number }
  >()

  record(
    name: ComputerUseMetricName,
    durationMs: number,
    dimensions: ComputerUseMetricDimensions,
    succeeded = true,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return
    const key = metricBucketKey(name, dimensions)
    const bucket = this.buckets.get(key) ?? {
      name,
      dimensions: { ...dimensions },
      samples: [],
      failures: 0,
    }
    bucket.samples.push({ durationMs, failed: !succeeded })
    if (bucket.samples.length > MAX_SAMPLES_PER_BUCKET) {
      const removed = bucket.samples.shift()
      if (removed?.failed === true) bucket.failures -= 1
    }
    if (!succeeded) bucket.failures += 1
    this.buckets.set(key, bucket)
  }

  recordExecutionOutcome(channel: ComputerUseExecutionChannel, succeeded: boolean): void {
    const outcome = this.channelOutcomes.get(channel) ?? { count: 0, failures: 0 }
    outcome.count += 1
    if (!succeeded) outcome.failures += 1
    this.channelOutcomes.set(channel, outcome)
  }

  executionChannelSnapshot(): ComputerUseChannelMetricsSnapshot {
    let total = 0
    let backgroundCount = 0
    for (const [channel, outcome] of this.channelOutcomes) {
      total += outcome.count
      if (channel === 'background_ax') backgroundCount = outcome.count
    }
    const channels: ComputerUseChannelOutcomeSnapshot[] = []
    for (const channel of ['background_ax', 'foreground_cg', 'unset'] as const) {
      const outcome = this.channelOutcomes.get(channel)
      if (outcome == null) continue
      channels.push({
        channel,
        count: outcome.count,
        failures: outcome.failures,
        successRate: outcome.count === 0 ? 0 : (outcome.count - outcome.failures) / outcome.count,
        share: total === 0 ? 0 : outcome.count / total,
      })
    }
    return {
      total,
      backgroundShare: total === 0 ? 0 : backgroundCount / total,
      channels,
    }
  }

  snapshot(): ComputerUseMetricSnapshot[] {
    return [...this.buckets.values()].map((bucket) => summarizeBucket(bucket))
  }

  clear(): void {
    this.buckets.clear()
    this.channelOutcomes.clear()
  }
}

function metricBucketKey(
  name: ComputerUseMetricName,
  dimensions: ComputerUseMetricDimensions,
): string {
  return [
    name,
    dimensions.platform,
    dimensions.architecture,
    dimensions.appVersion,
    dimensions.hostVersion,
    dimensions.trustMode,
  ].join('|')
}

function summarizeBucket(bucket: MetricBucket): ComputerUseMetricSnapshot {
  const sorted = bucket.samples
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    name: bucket.name,
    dimensions: { ...bucket.dimensions },
    count: sorted.length,
    failures: bucket.failures,
    minMs: sorted[0] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    averageMs: sorted.length === 0 ? 0 : total / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  }
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)
  return sorted[index] ?? 0
}
