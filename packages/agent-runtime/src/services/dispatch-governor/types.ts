/**
 * @module dispatch-governor/types
 *
 * 全局成员派发并发闸门（M0「物理闸门」）的类型契约。
 *
 * 命名说明：本目录（dispatch-governor）是性能监控与并发控制体系里的
 * DispatchGovernor；与既有的 team-dispatch-governance.ts（SteeringGate /
 * EvidenceCost 讨论域钩子）同名不同物，二者互不依赖。
 */

/** 调度闸门配置。全部字段都有默认值，normalizeGovernanceConfig 负责钳制。 */
export interface DispatchGovernanceConfig {
  /** 总开关。false 时 acquire 立即放行（行为等同未挂闸门）。 */
  enabled: boolean
  /**
   * 全局 agent 子进程预算（唯一权威）。主池容量 = 预算 − 宿主会话有效计数。
   * 一个 permit = 一次成员执行 = 至多一个 claude/codex CLI 子进程。
   */
  totalAgentProcessBudget: number
  /**
   * 宿主占用封顶（hostBudgetCap）：宿主 inflight 会话计数以 min(inflight, cap)
   * 计入主池，保证 6 会话满载时成员槽不被压穿。范围 3-6，默认 5。
   */
  hostInflightCap: number
  /** 成员槽下限保证：宿主计数最多压到 budget − minMemberSlots，成员槽恒 ≥ 该值。 */
  minMemberSlots: number
  /**
   * 成员侧并发硬顶（maxMemberDispatches，双旋钮的成员侧）。
   * 实际主池准入容量 = min(totalAgentProcessBudget − 宿主有效占用, maxMemberDispatches)。
   */
  maxMemberDispatches: number
  /** 嵌套池（depth>0 派发 + 同步 peer call）独立配额，与主池隔离防死锁。 */
  nestedDispatchSlots: number
  /** 嵌套池排队兜底放行时限：到时仍未获得 permit 则强制授予（防死锁等死）。 */
  deadlockEscapeAfterMs: number
  /** 主池 FIFO 排队超时：到时拒绝，错误消息含可行动建议。 */
  gateWaitTimeoutMs: number
}

/** 闸门拒绝/退出的原因分类（调用方据此映射到 dispatch 终态）。 */
export type DispatchGateRejectionKind = 'timeout' | 'canceled' | 'shutdown'

/** 闸门 acquire 抛出的错误。message 已是可直接回传给模型的可行动文案。 */
export class DispatchGateError extends Error {
  constructor(
    readonly kind: DispatchGateRejectionKind,
    message: string,
  ) {
    super(message)
    this.name = 'DispatchGateError'
  }
}

/** permit 归属池：main = 宿主首层派发；nested = 嵌套派发 / 同步 peer call。 */
export type DispatchGatePool = 'main' | 'nested'

/**
 * 派发来源显式标记（run ctx 的 additive 字段，缺省 unspecified 不影响闸门行为，
 * M2 压力降级矩阵按来源分级时消费；不靠 currentDepth/discussionId 等启发式推断）。
 */
export type DispatchSource = 'host' | 'member' | 'peer-call' | 'workflow' | 'unspecified'

/** 一次成员执行的准入许可。release 幂等。 */
export interface DispatchGatePermit {
  readonly dispatchId: string
  readonly pool: DispatchGatePool
  /** true = 嵌套池 15s 兜底放行（超出标称配额，诊断可观测）。 */
  readonly escaped: boolean
  /** 归还 permit。重复调用无副作用。 */
  release(): void
  /**
   * M2 预留：压力熔断受害者选择经此回调联动现有 AbortController 链。
   * M0 只存储回调，不主动调用。
   */
  bindInterrupt(callback: () => void): void
}

/** 闸门诊断快照（waitingCount 可观测，IPC `dispatch-governor:get-diagnostics` 消费）。 */
export interface DispatchGovernorDiagnostics {
  enabled: boolean
  config: DispatchGovernanceConfig
  /** 宿主 inflight 会话数（turnRegistry.inflightSessionCount() 只读采样）。 */
  hostInflightCount: number
  /** 计入主池占用的宿主计数（min(inflight, cap, budget − minMemberSlots)）。 */
  hostEffectiveCount: number
  /** 主池当前容量（budget − hostEffective）。容量收缩只影响新准入，不撤销在逃 permit。 */
  mainCapacity: number
  mainInUse: number
  mainWaiting: number
  nestedSlots: number
  nestedInUse: number
  nestedWaiting: number
  /** 当前在逃的 15s 兜底放行 permit 数（上限 2）。 */
  escapeInFlight: number
  /** 生命周期累计计数（自实例创建起）。 */
  counters: {
    acquisitions: number
    releases: number
    gateTimeouts: number
    canceledWhileWaiting: number
    escapeGrants: number
  }
}
