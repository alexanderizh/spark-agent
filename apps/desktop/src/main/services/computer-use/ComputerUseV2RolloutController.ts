import type { ComputerUseV2FlagName } from './computerUseV2Flags.js'
import { getComputerUseV2FlagStore, type ComputerUseV2FlagStore } from './computerUseV2Flags.js'

export interface ComputerUseV2RollbackEvent {
  readonly flag: ComputerUseV2FlagName
  readonly reason: string
  readonly observedValue: number
  readonly threshold: number
}

interface RolloutThresholds {
  readonly minimumHostSessionSamples: number
  readonly minimumInstalledArtifactSamples: number
  readonly minimumActionSamples: number
  readonly minimumPersistentCaptureSamples: number
  readonly minimumLatencySamples: number
  readonly hostCrashRate: number
  readonly installedArtifactFailureRate: number
  readonly actionErrorRate: number
  readonly takeoverP99Ms: number
  readonly persistentCaptureBudgetFailureRate: number
}

const DEFAULT_THRESHOLDS: RolloutThresholds = {
  minimumHostSessionSamples: 200,
  minimumInstalledArtifactSamples: 1_000,
  minimumActionSamples: 500,
  minimumPersistentCaptureSamples: 200,
  minimumLatencySamples: 100,
  hostCrashRate: 0.005,
  installedArtifactFailureRate: 0.001,
  actionErrorRate: 0.01,
  takeoverP99Ms: 500,
  persistentCaptureBudgetFailureRate: 0.01,
}

const MAX_ROLLOUT_SAMPLES = 2_048

/**
 * Process-local rollback evaluator. It can disable only the implicated V2 feature;
 * baseline governed Computer Use remains available. Runtime rollbacks are visible in
 * the unified flag snapshot and reset naturally on the next app launch.
 */
export class ComputerUseV2RolloutController {
  private readonly flags: ComputerUseV2FlagStore
  private readonly thresholds: RolloutThresholds
  private readonly hostSessions = new BooleanWindow()
  private readonly installedArtifactChecks = new BooleanWindow()
  private readonly actions = new BooleanWindow()
  private readonly takeoverDurations = new NumberWindow()
  private readonly persistentCaptureBudgets = new BooleanWindow()
  private readonly listeners = new Set<(event: ComputerUseV2RollbackEvent) => void>()

  constructor(
    options: {
      flags?: ComputerUseV2FlagStore
      thresholds?: Partial<RolloutThresholds>
    } = {},
  ) {
    this.flags = options.flags ?? getComputerUseV2FlagStore()
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds }
  }

  subscribe(listener: (event: ComputerUseV2RollbackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  recordHostSession(crashed: boolean): void {
    this.hostSessions.push(crashed)
    this.evaluateRate(
      'hostSupervisor',
      'host_crash_rate_exceeded',
      this.hostSessions,
      this.thresholds.hostCrashRate,
      this.thresholds.minimumHostSessionSamples,
    )
  }

  recordInstalledArtifactCheck(failed: boolean): void {
    this.installedArtifactChecks.push(failed)
    this.evaluateRate(
      'hostSupervisor',
      'installed_artifact_failure_rate_exceeded',
      this.installedArtifactChecks,
      this.thresholds.installedArtifactFailureRate,
      this.thresholds.minimumInstalledArtifactSamples,
    )
  }

  recordAction(erroneous: boolean): void {
    this.actions.push(erroneous)
    this.evaluateRate(
      'actionBatch',
      'action_error_rate_exceeded',
      this.actions,
      this.thresholds.actionErrorRate,
      this.thresholds.minimumActionSamples,
    )
  }

  recordTakeoverStop(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return
    this.takeoverDurations.push(durationMs)
    if (this.takeoverDurations.size < this.thresholds.minimumLatencySamples) return
    const p99 = this.takeoverDurations.percentile(0.99)
    if (p99 > this.thresholds.takeoverP99Ms) {
      this.rollback('actionBatch', 'takeover_stop_p99_exceeded', p99, this.thresholds.takeoverP99Ms)
    }
  }

  recordPersistentCaptureBudget(exceeded: boolean): void {
    this.persistentCaptureBudgets.push(exceeded)
    this.evaluateRate(
      'persistentCapture',
      'persistent_capture_budget_exceeded',
      this.persistentCaptureBudgets,
      this.thresholds.persistentCaptureBudgetFailureRate,
      this.thresholds.minimumPersistentCaptureSamples,
    )
  }

  private evaluateRate(
    flag: ComputerUseV2FlagName,
    reason: string,
    window: BooleanWindow,
    threshold: number,
    minimumSamples: number,
  ): void {
    if (window.size < minimumSamples) return
    const rate = window.failureRate
    if (rate > threshold) this.rollback(flag, reason, rate, threshold)
  }

  private rollback(
    flag: ComputerUseV2FlagName,
    reason: string,
    observedValue: number,
    threshold: number,
  ): void {
    if (!this.flags.disableForRuntime(flag, reason)) return
    const event = { flag, reason, observedValue, threshold }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Observability must never change rollback behavior.
      }
    }
  }
}

class BooleanWindow {
  private readonly values: boolean[] = []
  private failures = 0

  get size(): number {
    return this.values.length
  }

  get failureRate(): number {
    return this.values.length === 0 ? 0 : this.failures / this.values.length
  }

  push(failed: boolean): void {
    this.values.push(failed)
    if (failed) this.failures += 1
    if (this.values.length <= MAX_ROLLOUT_SAMPLES) return
    if (this.values.shift() === true) this.failures -= 1
  }
}

class NumberWindow {
  private readonly values: number[] = []

  get size(): number {
    return this.values.length
  }

  push(value: number): void {
    this.values.push(value)
    if (this.values.length > MAX_ROLLOUT_SAMPLES) this.values.shift()
  }

  percentile(value: number): number {
    const sorted = [...this.values].sort((left, right) => left - right)
    if (sorted.length === 0) return 0
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? 0
  }
}

export const computerUseV2RolloutController = new ComputerUseV2RolloutController()
