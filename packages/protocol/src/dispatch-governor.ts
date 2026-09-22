/**
 * @module dispatch-governor
 *
 * 全局成员派发并发闸门（DispatchGovernor，M0）的 IPC 诊断契约。
 * 运行时类型在 @spark/agent-runtime（dispatch-governor/dispatch-governor.ts），
 * 此处只定义跨进程传输形态（JSON 可序列化快照）。
 */

export interface DispatchGovernorCountersSnapshot {
  acquisitions: number
  releases: number
  gateTimeouts: number
  canceledWhileWaiting: number
  escapeGrants: number
}

export interface DispatchGovernorDiagnosticsSnapshot {
  enabled: boolean
  config: {
    enabled: boolean
    totalAgentProcessBudget: number
    hostInflightCap: number
    minMemberSlots: number
    maxMemberDispatches: number
    nestedDispatchSlots: number
    deadlockEscapeAfterMs: number
    gateWaitTimeoutMs: number
  }
  hostInflightCount: number
  hostEffectiveCount: number
  mainCapacity: number
  mainInUse: number
  mainWaiting: number
  nestedSlots: number
  nestedInUse: number
  nestedWaiting: number
  escapeInFlight: number
  counters: DispatchGovernorCountersSnapshot
}

export interface DispatchGovernorGetDiagnosticsRequest {}

export interface DispatchGovernorGetDiagnosticsResponse {
  available: boolean
  diagnostics: DispatchGovernorDiagnosticsSnapshot | null
}
