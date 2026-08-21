export interface CodexRuntimeLatencySummary {
  count: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface CodexRuntimeSupervisorDiagnostics {
  disposed: boolean
  activeRuntimeCount: number
  leasedRuntimeCount: number
  processCount: number
  totalRssBytes: number | null
  totalHandleCount: number | null
  counters: {
    acquireCount: number
    coldStartCount: number
    warmHitCount: number
    warmHitRate: number
    fingerprintRotationCount: number
    crashReplacementCount: number
    invalidationCount: number
    startFailureCount: number
    ttlEvictionCount: number
    lruEvictionCount: number
    manualRestartCount: number
    threadLoadedCount: number
    threadResumeCount: number
    threadStartCount: number
    threadResumeFallbackCount: number
  }
  latency: {
    coldAcquire: CodexRuntimeLatencySummary
    warmAcquire: CodexRuntimeLatencySummary
    coldTurnStart: CodexRuntimeLatencySummary
    warmTurnStart: CodexRuntimeLatencySummary
  }
  runtimes: Array<{
    leaseId: string
    state: 'starting' | 'running' | 'idle' | 'exited'
    lastUsedAt: string
    resourceCount: number
    pid: number | null
    rssBytes: number | null
    handleCount: number | null
    loadedThreadCount: number | null
  }>
}

export interface CodexRuntimeRestartResult {
  restartedLeaseIds: string[]
  busyLeaseIds: string[]
}

export interface CodexRuntimeDiagnosticsRequest {}

export interface CodexRuntimeDiagnosticsResponse {
  enabled: boolean
  source: 'default' | 'environment'
  diagnostics: CodexRuntimeSupervisorDiagnostics | null
}

export interface CodexRuntimeRestartIdleRequest {}

export interface CodexRuntimeRestartIdleResponse {
  enabled: boolean
  result: CodexRuntimeRestartResult | null
}
