import { createLogger } from '@spark/shared'
import type { AutoRouterExecutorHealthSnapshot } from '@spark/protocol'

const log = createLogger('auto-router-health')

// ─── 冻结策略常量 ─────────────────────────────────────────────────────────────

/**
 * 可重试失败（429/5xx/超时/网络抖动）的递进冻结时长：1min → 5min → 10min 封顶。
 * 首次失败只短冻，避免单次抖动就把执行器长期闲置；连续失败说明上游真出问题，
 * 递进拉长冷却窗口，同时始终保留自动解冻（半开恢复），不会"禁后无法恢复"。
 */
const RETRYABLE_FREEZE_STEPS_MS: readonly number[] = [60_000, 300_000, 600_000]

/**
 * 确定性失败（鉴权错误/模型不存在/套餐配额未开放等 4xx）的冻结时长：30 分钟。
 * 这类错误不会自愈，短冻没有意义；但渠道可能是共享 key 的临时欠费，仍不永久禁用，
 * 由用户在管理界面看到健康提示后修复配置。
 */
const DETERMINISTIC_FREEZE_MS = 30 * 60_000

/** 追踪条目上限（防 Map 无限增长；超出时淘汰最久未失败的条目）。 */
const MAX_TRACKED_ENTRIES = 512

// ─── 失败归类 ─────────────────────────────────────────────────────────────────

/** 执行器失败的归类结果。 */
export type AutoRouterFailureKind = 'retryable' | 'deterministic' | 'environment'

/**
 * 从轮次终态失败的错误文本归类失败原因。
 *
 * - deterministic：鉴权/权限/模型不存在/套餐配额类——换渠道才能解决，冻结 30min；
 * - retryable：429/5xx/超时/网络/过载——可能自愈，递进短冻；
 * - environment：工作区不可用/SDK 缺失/渠道配置问题/引擎不匹配等**非执行模型**
 *   的环境失败——不冻结（冻结执行器毫无意义）、也不触发故障切换重派发
 *   （换一个执行器只会以同样方式失败）。
 */
export function classifyExecutorFailureText(
  rawText: string | null | undefined,
): AutoRouterFailureKind {
  const text = (rawText ?? '').trim()
  if (text.length === 0) return 'environment'

  // 环境类：session.service / 启动守卫写出的已知文案（先判，优先级最高）。
  if (ENVIRONMENT_FAILURE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'environment'
  }
  if (DETERMINISTIC_FAILURE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'deterministic'
  }
  if (RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'retryable'
  }
  // 未识别文本默认按可重试短冻：冻结 1 分钟代价极低，漏冻会让下一轮继续撞同一堵墙。
  return 'retryable'
}

/**
 * 是否值得自动故障切换（重派发一次）：仅限能确认是「执行模型上游」的失败。
 * environment 类失败换执行器同样会失败；未识别文本保守起见不自动重跑
 * （避免对本地 bug 类崩溃反复空跑一轮）。
 */
export function isFailoverWorthyFailure(kind: AutoRouterFailureKind, errorText: string): boolean {
  if (kind === 'environment') return false
  if (kind === 'deterministic') return true
  return FAILOVER_RETRYABLE_PATTERNS.some((pattern) => pattern.test(errorText))
}

/** 环境类失败（与执行模型上游无关；不冻结、不重派发）。 */
const ENVIRONMENT_FAILURE_PATTERNS: readonly RegExp[] = [
  /WORKSPACE_UNAVAILABLE|Workspace path is not available/i,
  /SDK_REQUIRED|Claude Agent SDK is (required|not available)/i,
  /SPARK_ENGINE_UNAVAILABLE|Spark engine SDK/i,
  /会话绑定的渠道已不存在/,
  /已被停用/,
  /没有可用执行模型/,
  /has no default model configured/i,
  /has no keystore ref/i,
  /API key not found for provider/i,
  /is not compatible with local CLI/i,
  /引擎.*不匹配|不匹配.*渠道|协议.*不支持/,
  /已到定时禁用时段|定时禁用/i,
  /TURN_START_FAILED/,
  /Reached maximum turns/i,
  /PLAN_MODE|maintenance/i,
]

/** 确定性失败（重试/等待都不会自愈；冻结 30min）。 */
const DETERMINISTIC_FAILURE_PATTERNS: readonly RegExp[] = [
  /HTTP 40[134]/,
  /\b(401|403|404)\b/,
  /invalid.?api.?key|authentication|unauthorized|forbidden/i,
  /model not found|invalid.?model|does not exist|not_found/i,
  /套餐|配额|额度|insufficient|quota|balance|余额/i,
  /无权限|没有.*权限|access denied/i,
]

/** 可重试失败（可能自愈；递进冻结）。 */
const RETRYABLE_FAILURE_PATTERNS: readonly RegExp[] = [
  /HTTP (429|5\d\d)/,
  /\b(429|500|502|503|504)\b/,
  /api error/i,
  /overloaded|rate.?limit|too many requests/i,
  /timeout|timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
  /ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|fetch failed|network/i,
  /exceeded retry limit/i,
  /service unavailable|internal server error|bad gateway/i,
  /stream (error|closed|aborted|ended prematurely)/i,
]

/**
 * retryable 归类中「值得自动重派发」的子集：必须是明确的模型上游失败信号。
 * 纯超时类（可能执行了很久才断）不重跑，避免重复计费；网络类由用户网络环境
 * 决定，重跑大概率同样失败，也交回用户。
 */
const FAILOVER_RETRYABLE_PATTERNS: readonly RegExp[] = [
  /HTTP (429|5\d\d)/,
  /\b(429|500|502|503|504)\b/,
  /api error/i,
  /overloaded|rate.?limit|too many requests/i,
  /exceeded retry limit/i,
  /service unavailable|internal server error|bad gateway/i,
]

// ─── 注册表 ───────────────────────────────────────────────────────────────────

interface HealthEntry {
  providerId: string
  modelId: string
  frozenUntil: number | null
  consecutiveFailures: number
  lastFailureKind: AutoRouterFailureKind | null
  lastErrorDetail: string | null
  lastFailureAt: number | null
}

/** 统一 `providerId::modelId` 追踪键（同渠道不同模型独立计数）。 */
function healthKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

/** 冻结时长（毫秒）：递进档位越界取最后一档。 */
function retryableFreezeMs(consecutiveFailures: number): number {
  const index = Math.min(consecutiveFailures, RETRYABLE_FREEZE_STEPS_MS.length) - 1
  return RETRYABLE_FREEZE_STEPS_MS[Math.max(index, 0)] ?? RETRYABLE_FREEZE_STEPS_MS[RETRYABLE_FREEZE_STEPS_MS.length - 1]!
}

/**
 * AutoRouter 执行器健康注册表（进程内单例语义，不落库）。
 *
 * 职责边界：
 * - 记录执行器连续失败并按策略冻结（递进短冻 / 确定性长冻）；
 * - 提供选执行器时的健康判定（`firstHealthy` / `soonestUnfreeze`）；
 * - 半开恢复：冻结到期自然解冻，成功一次即清零计数，失败则继续递进；
 * - 对外只读快照（IPC/渲染端展示），不参与持久化。
 *
 * 线程模型：仅主进程同步访问（SessionService 与 IPC handler 同进程），无锁。
 */
export class AutoRouterHealthRegistry {
  private readonly entries = new Map<string, HealthEntry>()

  /** 该执行器当前是否处于冻结期。 */
  isFrozen(providerId: string, modelId: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(healthKey(providerId, modelId))
    return entry != null && entry.frozenUntil != null && entry.frozenUntil > now
  }

  /** 距解冻剩余毫秒；未冻结或未追踪返回 null。 */
  frozenRemainingMs(
    providerId: string,
    modelId: string,
    now: number = Date.now(),
  ): number | null {
    const entry = this.entries.get(healthKey(providerId, modelId))
    if (entry?.frozenUntil == null) return null
    return Math.max(entry.frozenUntil - now, 0)
  }

  /**
   * 按声明顺序取第一条健康（未冻结）条目；全部冻结返回 null。
   * 半开语义内建于 `isFrozen`：到期条目视为健康，可作恢复探针。
   */
  firstHealthy<T extends { providerProfileId: string; modelId: string }>(
    candidates: readonly T[],
    now: number = Date.now(),
  ): T | null {
    return (
      candidates.find(
        (entry) => !this.isFrozen(entry.providerProfileId, entry.modelId, now),
      ) ?? null
    )
  }

  /**
   * 全部冻结时的 best-effort：取冻结剩余时间最短（最快解冻）的条目。
   * 语义：比直接报错好——冻结中的模型可能已恢复，而报错则肯定不可用。
   */
  soonestUnfreeze<T extends { providerProfileId: string; modelId: string }>(
    candidates: readonly T[],
    now: number = Date.now(),
  ): T | null {
    let best: T | null = null
    let bestRemaining = Number.POSITIVE_INFINITY
    for (const entry of candidates) {
      const remaining = this.frozenRemainingMs(entry.providerProfileId, entry.modelId, now)
      if (remaining != null && remaining < bestRemaining) {
        best = entry
        bestRemaining = remaining
      }
    }
    return best
  }

  /**
   * 记录一次终态失败并（重新）冻结。返回本次冻结时长毫秒（environment 类
   * 不该进来——调用方先归类；防御性容错为不冻结）。
   */
  reportFailure(
    providerId: string,
    modelId: string,
    kind: AutoRouterFailureKind,
    detail: string,
    now: number = Date.now(),
  ): number {
    if (kind === 'environment') return 0
    const key = healthKey(providerId, modelId)
    const existing = this.entries.get(key)
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1
    const freezeMs =
      kind === 'deterministic' ? DETERMINISTIC_FREEZE_MS : retryableFreezeMs(consecutiveFailures)
    const frozenUntil = now + freezeMs
    this.entries.set(key, {
      providerId,
      modelId,
      frozenUntil,
      consecutiveFailures,
      lastFailureKind: kind,
      lastErrorDetail: detail.slice(0, 200),
      lastFailureAt: now,
    })
    this.pruneIfNeeded()
    log.warn('executor frozen after terminal failure', {
      providerId,
      modelId,
      kind,
      consecutiveFailures,
      freezeMs,
      detail: detail.slice(0, 120),
    })
    return freezeMs
  }

  /** 记录一次成功：清零该执行器的失败计数（半开恢复的"探针通过"）。 */
  reportSuccess(providerId: string, modelId: string): void {
    const key = healthKey(providerId, modelId)
    const entry = this.entries.get(key)
    if (entry == null) return
    this.entries.delete(key)
    log.info('executor recovered; failure counters cleared', { providerId, modelId })
  }

  /** 只读快照（IPC/渲染端）。可按 router 配置引用的执行器集合过滤。 */
  snapshot(now: number = Date.now()): AutoRouterExecutorHealthSnapshot[] {
    return [...this.entries.values()].map((entry) => {
      const frozen =
        entry.frozenUntil != null && entry.frozenUntil > now
      return {
        providerId: entry.providerId,
        modelId: entry.modelId,
        state: frozen ? 'frozen' : 'healthy',
        frozenUntil: frozen ? entry.frozenUntil : null,
        frozenRemainingMs: frozen && entry.frozenUntil != null ? entry.frozenUntil - now : null,
        consecutiveFailures: entry.consecutiveFailures,
        lastFailureKind:
          entry.lastFailureKind === 'retryable' || entry.lastFailureKind === 'deterministic'
            ? entry.lastFailureKind
            : null,
        lastErrorDetail: entry.lastErrorDetail,
        lastFailureAt: entry.lastFailureAt,
      }
    })
  }

  /** 测试隔离用：清空全部状态。 */
  clear(): void {
    this.entries.clear()
  }

  /** 超出上限时淘汰最久未失败的条目（冻结中的条目保留，保证避让语义）。 */
  private pruneIfNeeded(): void {
    if (this.entries.size <= MAX_TRACKED_ENTRIES) return
    let oldestKey: string | null = null
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, entry] of this.entries) {
      if (entry.frozenUntil != null && entry.frozenUntil > Date.now()) continue
      if ((entry.lastFailureAt ?? 0) < oldestAt) {
        oldestAt = entry.lastFailureAt ?? 0
        oldestKey = key
      }
    }
    if (oldestKey != null) this.entries.delete(oldestKey)
  }
}

/**
 * 进程内默认注册表：SessionService（失败上报/选执行器避让）与主进程 IPC
 * （健康查询）共用同一实例。测试请自行 new 或 clear，避免交叉污染。
 */
export const autoRouterHealthRegistry = new AutoRouterHealthRegistry()
