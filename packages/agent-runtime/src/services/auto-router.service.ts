import { createLogger } from '@spark/shared'
import { z } from 'zod'
import type { ProviderProfileRow } from '@spark/storage'
import {
  RouterIntensitySchema,
  findExecutorByIntensity,
  type AutoRouterConfig,
  type AutoRouterExecutorRef,
  type RouterAdapter,
  type RouterIntensity,
  type SessionReasoningEffort,
} from '@spark/protocol'
import type { ModelService } from './model.service'

const log = createLogger('auto-router')

// ─── 分流决策协议 ─────────────────────────────────────────────────────────────

/** 分流器 LLM 输出的强制 JSON schema（zod 严格解析）。 */
export const AutoRouterDispatchDecisionSchema = z.object({
  intensity: RouterIntensitySchema,
  decompose: z.boolean().default(false),
  subtasks: z
    .array(
      z.object({
        summary: z.string().min(1).max(300),
        intensity: RouterIntensitySchema,
        parallelizable: z.boolean().default(false),
      }),
    )
    .max(10)
    .default([]),
  reason: z.string().max(300).default(''),
})

export type AutoRouterDispatchDecision = z.infer<typeof AutoRouterDispatchDecisionSchema>

// ─── 输入 / 输出 ─────────────────────────────────────────────────────────────

export interface AutoRouterRouteInput {
  sessionId: string
  turnId: string
  routerId: string
  routerName: string
  config: AutoRouterConfig
  /** 当轮用户消息全文（截断由本服务控制）。 */
  userMessage: string
  /** 会话已有事件数（会话状态信号）。 */
  eventCount: number
  /** 会话估算 token（消息精确值 + 历史粗估）。 */
  estimatedTokens: number
  /** 最近 2 轮用户消息摘要（解决"继续"误判；不含当轮）。 */
  recentUserMessages: string[]
  /** 会话当前引擎（adapterMismatch 判定）。 */
  sessionAdapter: RouterAdapter
  /** 轮次取消查询：返回 true 时中止分流 HTTP 并标记 cancelled。 */
  isTurnCancelled: () => boolean
}

export interface AutoRouterRouteResult {
  /** false = 无任何可用执行器（调用方回退/报错）。 */
  ok: boolean
  intensity: RouterIntensity
  resolvedProviderId: string
  resolvedModelId: string
  /** 渲染端直接显示的模型名（当前即 modelId 原值；无映射负担）。 */
  modelDisplayName: string
  reason: string
  fallbackUsed: boolean
  fallbackStage?: 'timeout' | 'http' | 'schema' | 'rule' | 'no_executor'
  /** router.adapter 与会话引擎不匹配，回退了匹配渠道。 */
  adapterMismatch?: boolean
  latencyMs: number
  prevIntensity: RouterIntensity | null
  /** 强度粘性命中（决策强度与上轮相同且执行器未变）。 */
  keptPrevIntensity: boolean
  /** 解析出的执行器显式推理强度；null/缺省 = 跟随会话/Agent 既有配置。 */
  reasoningEffort?: SessionReasoningEffort | null
  decompose: boolean
  subtasks: AutoRouterDispatchDecision['subtasks']
  /** 轮次在分流期间被取消。 */
  cancelled: boolean
  /** 有效性校验剔除的失效条目（日志用）。 */
  invalidEntries: Array<{ entryId: string; providerId: string; reason: string }>
}

/** 依赖注入（全部可 mock，服务自身无 IO 依赖）。 */
export interface AutoRouterServiceDeps {
  complete: ModelService['complete']
  getProviderRow: (providerId: string) => ProviderProfileRow | null
  /** 反查会话最近一条分流决策的强度（强度粘性）。 */
  getLatestDecisionIntensity: (sessionId: string) => RouterIntensity | null
}

// ─── 规则兜底分类器（精简版，仅 LLM 失败时降级） ─────────────────────────────

const RULE_HIGH_PATTERNS: RegExp[] = [
  /重构/,
  /架构/,
  /设计.{0,6}(方案|系统|实现)/,
  /多(文件|模块|步)/,
  /全链路/,
  /排查.{0,4}(问题|故障|根因)/,
  /性能(优化|调优)/,
  /implement|refactor|architect|redesign/i,
]

const RULE_LOW_PATTERNS: RegExp[] = [
  /^(好的|嗯|ok|OK|可以|行|继续|go on|continue)[。!！.\s]*$/,
  /翻译/,
  /错别字/,
  /改个?名/,
  /格式化/,
  /总结一句/,
]

/** 规则兜底：token 阈值 + 收敛正则；仅作分流 LLM 失败的降级路径。 */
export function ruleClassifyIntensity(
  userMessage: string,
  estimatedTokens: number,
): RouterIntensity {
  if (estimatedTokens > 30_000) return 'high'
  const text = userMessage.trim()
  if (text.length > 0 && RULE_LOW_PATTERNS.some((pattern) => pattern.test(text))) return 'low'
  if (RULE_HIGH_PATTERNS.some((pattern) => pattern.test(text))) return 'high'
  return 'balanced'
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

const CLAUDE_SESSION_PROVIDER_TYPES: ReadonlySet<string> = new Set(['anthropic'])
const CODEX_SESSION_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  'openai',
  'openai-compatible',
  'deepseek',
  'ollama',
])

/** 渠道 provider_type 是否能承接该引擎的会话轮次。 */
export function providerRowMatchesAdapter(
  providerRow: ProviderProfileRow,
  adapter: RouterAdapter,
): boolean {
  if (adapter === 'claude') return CLAUDE_SESSION_PROVIDER_TYPES.has(providerRow.provider_type)
  return CODEX_SESSION_PROVIDER_TYPES.has(providerRow.provider_type)
}

/** 从 LLM 文本提取 JSON（容忍 ```json 围栏与前后噪声）。 */
function extractJsonText(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced != null && fenced[1] != null) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return null
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function buildDispatcherSystemPrompt(config: AutoRouterConfig): string {
  const enabledSlots = new Set(
    config.executors.filter((entry) => entry.enabled).map((entry) => entry.intensity),
  )
  const slotsText =
    (enabledSlots.has('high') ? 'high ' : '') +
    (enabledSlots.has('balanced') ? 'balanced ' : '') +
    (enabledSlots.has('low') ? 'low' : '')
  return [
    '你是模型路由分流器。分析用户当轮任务，决定执行强度并判断是否建议拆分子任务。只输出 JSON，不要任何其他文字。',
    '',
    '强度定义：',
    '- low：轻量任务——短问答、翻译、改错别字、格式调整、延续上一轮的简单输出',
    '- balanced：常规任务——普通代码修改、文档撰写、单文件分析',
    '- high：高强度任务——跨模块重构、复杂架构设计、多文件调试、长上下文深度推理',
    '',
    '决策规则：',
    '1. 当轮消息是"继续/好的/嗯"等延续性回复且提供了上一轮强度时，维持上一轮强度',
    '2. 估算 token 很大且任务依赖前文推理链时，倾向 high',
    `3. decompose 仅当任务明确包含多个可独立执行的子任务时为 true；子任务最多 ${config.maxConcurrentSubtasks} 条`,
    `4. 可用强度档位：${slotsText || '（未配置）'}；未配置的档位不要选`,
    '',
    '输出 JSON 格式：',
    '{"intensity":"high|balanced|low","decompose":false,"subtasks":[{"summary":"...","intensity":"low","parallelizable":true}],"reason":"一句话理由（30字内）"}',
  ].join('\n')
}

function buildDispatcherUserPayload(
  input: AutoRouterRouteInput,
  prevIntensity: RouterIntensity | null,
): string {
  const recent = input.recentUserMessages
    .slice(-2)
    .map((message, index) => `${index + 1}. ${truncate(message.replace(/\s+/g, ' ').trim(), 200)}`)
    .join('\n')
  return [
    '【当前任务】',
    truncate(input.userMessage, 4_000),
    '',
    '【会话状态】',
    `事件数: ${input.eventCount}`,
    `估算 token: ${input.estimatedTokens}`,
    `上一轮强度: ${prevIntensity ?? '无（首轮）'}`,
    '',
    '【最近用户消息】（不含当轮）',
    recent.length > 0 ? recent : '（无）',
  ].join('\n')
}

// ─── 服务 ─────────────────────────────────────────────────────────────────────

/**
 * AutoRouter 分流服务：加载配置 → 调分流 LLM → zod 严格解析 → 规则兜底 →
 * 强度粘性 → 选执行器。任何失败不抛异常，以 result.ok / fallback 字段降级。
 */
export class AutoRouterService {
  private readonly deps: AutoRouterServiceDeps

  constructor(deps: AutoRouterServiceDeps) {
    this.deps = deps
  }

  async routeTurn(input: AutoRouterRouteInput): Promise<AutoRouterRouteResult> {
    const t0 = Date.now()
    const prevIntensity = this.deps.getLatestDecisionIntensity(input.sessionId)

    // 1. 执行器有效性校验（剔除失效条目，warn 日志）
    const { validExecutors, invalidEntries } = this.validateExecutors(input.config)
    if (invalidEntries.length > 0) {
      log.warn('router executor validation dropped invalid entries', {
        routerId: input.routerId,
        invalidEntries,
      })
    }
    if (validExecutors.length === 0) {
      log.error('router has no usable executor', {
        routerId: input.routerId,
        routerName: input.routerName,
      })
      return this.buildResult({
        input,
        prevIntensity,
        latencyMs: Date.now() - t0,
        intensity: input.config.fallbackIntensity,
        resolved: null,
        reason: '路由器没有可用执行模型',
        fallbackUsed: true,
        fallbackStage: 'no_executor',
        invalidEntries,
      })
    }

    // 2. adapterMismatch 运行时兜底：router 引擎与会话引擎不一致时不抛错，
    //    按兜底强度找匹配会话引擎的渠道，无则回退默认渠道。
    if (input.config.adapter !== input.sessionAdapter) {
      const mismatched = this.resolveAdapterMismatchExecutor(
        input.config,
        validExecutors,
        input.sessionAdapter,
      )
      log.warn('router adapter mismatch fell back', {
        turnId: input.turnId,
        routerAdapter: input.config.adapter,
        sessionAdapter: input.sessionAdapter,
        resolvedExecutor: mismatched
          ? { providerId: mismatched.providerProfileId, modelId: mismatched.modelId }
          : null,
      })
      return this.buildResult({
        input,
        prevIntensity,
        latencyMs: Date.now() - t0,
        intensity: input.config.fallbackIntensity,
        resolved: mismatched,
        reason: '引擎不匹配，已回退兼容执行模型',
        fallbackUsed: true,
        fallbackStage: 'rule',
        adapterMismatch: true,
        invalidEntries,
      })
    }

    // 3. 分流 LLM 调用（取消联动：100ms 轮询轮次取消状态中止 HTTP）
    const decision = await this.callDispatcher(input, prevIntensity)
    const latencyMs = Date.now() - t0

    if (decision.cancelled) {
      log.info('routing aborted by turn cancellation', {
        turnId: input.turnId,
        aborted: true,
        elapsedMs: latencyMs,
      })
      return this.buildResult({
        input,
        prevIntensity,
        latencyMs,
        intensity: input.config.fallbackIntensity,
        resolved: null,
        reason: '轮次已取消',
        fallbackUsed: true,
        fallbackStage: 'rule',
        cancelled: true,
        invalidEntries,
      })
    }

    // 4. 决策落定：LLM 成功 → 按强度；失败 → 规则兜底；执行器缺失 → fallbackIntensity
    let intensity: RouterIntensity
    let reason: string
    let fallbackUsed = false
    let fallbackStage: AutoRouterRouteResult['fallbackStage']
    let decompose = false
    let subtasks: AutoRouterDispatchDecision['subtasks'] = []

    if (decision.decision != null) {
      intensity = decision.decision.intensity
      reason = decision.decision.reason
      decompose = input.config.allowDecomposition && decision.decision.decompose
      subtasks = decompose ? decision.decision.subtasks : []
      log.info('routing decision settled', {
        turnId: input.turnId,
        decision: {
          intensity,
          decompose,
          subtaskCount: subtasks.length,
        },
        fallbackUsed: false,
        reason,
      })
    } else {
      intensity = ruleClassifyIntensity(input.userMessage, input.estimatedTokens)
      reason =
        decision.failureDetail != null
          ? `分流降级（${decision.failureStage}｜${decision.failureDetail}），规则判定为${intensity}`
          : `分流降级（${decision.failureStage}），规则判定为${intensity}`
      fallbackUsed = true
      fallbackStage = decision.failureStage === 'timeout' ? 'timeout' : decision.failureStage
      log.warn('routing degraded to rule classifier', {
        turnId: input.turnId,
        failureStage: decision.failureStage,
        failureDetail: decision.failureDetail ?? null,
        attemptCount: decision.attemptCount,
        degradedTo: 'rule',
        ruleIntensity: intensity,
      })
    }

    // 5. 选执行器：该强度第一个有效条目 → fallbackIntensity → 任意第一个
    let executor: AutoRouterExecutorRef | null | undefined =
      findExecutorByIntensity({ ...input.config, executors: validExecutors }, intensity) ??
      findExecutorByIntensity({ ...input.config, executors: validExecutors }, input.config.fallbackIntensity) ??
      validExecutors[0]
    if (executor != null && executor.intensity !== intensity) {
      // 强度档位未配置执行器 → 回落兜底强度（或任意第一条），必须把强度一起改成
      // 实际执行条目的强度：标签是渲染端"这轮谁在干活"的唯一依据，若保留请求强度
      // 会出现「提示条显示●低、实际跑的是高强度模型」的错误标注（规则兜底 + 该强度
      // 档未配置时最易触发，因为 fallbackUsed 已为 true）。
      reason = `${reason}（${intensity} 档未配置，回落 ${executor.intensity}）`.slice(0, 300)
      intensity = executor.intensity
      fallbackUsed = true
      fallbackStage = fallbackStage ?? 'rule'
    }
    executor = executor ?? null

    // 6. 强度粘性标记：决策强度与上轮相同且执行器一致 → kept（减少 resume 断裂）
    let keptPrevIntensity = false
    if (executor != null && prevIntensity != null) {
      const prevExecutor = findExecutorByIntensity(
        { ...input.config, executors: validExecutors },
        prevIntensity,
      )
      keptPrevIntensity =
        intensity === prevIntensity &&
        prevExecutor != null &&
        prevExecutor.providerProfileId === executor.providerProfileId &&
        prevExecutor.modelId === executor.modelId
      if (keptPrevIntensity) {
        log.info('routing intensity sticky hit', {
          turnId: input.turnId,
          prevIntensity,
          kept: true,
        })
      }
    }

    return this.buildResult({
      input,
      prevIntensity,
      latencyMs,
      intensity,
      resolved: executor,
      reason,
      fallbackUsed,
      fallbackStage,
      decompose,
      subtasks,
      keptPrevIntensity,
      invalidEntries,
    })
  }

  /**
   * 分流器连通性探测（管理弹层「测试分流器」按钮用）：
   * 用 dispatcher 渠道发一个 maxTokens=16 的最小请求，区分「渠道/模型可用」与
   * 「鉴权/权限/模型名错误」。不解析决策 JSON——只验证调用链路，结果原样带回。
   */
  async testDispatcher(config: {
    dispatcher: AutoRouterConfig['dispatcher']
  }): Promise<{ ok: true; latencyMs: number } | { ok: false; latencyMs: number; error: string }> {
    const t0 = Date.now()
    const provider = this.deps.getProviderRow(config.dispatcher.providerProfileId)
    if (provider == null) {
      return { ok: false, latencyMs: 0, error: `分流器渠道不存在（${config.dispatcher.providerProfileId}）` }
    }
    if (provider.enabled === 0) {
      return { ok: false, latencyMs: 0, error: `分流器渠道「${provider.name}」已禁用` }
    }
    log.info('dispatcher connectivity test dispatched', {
      dispatcherModel: `${config.dispatcher.providerProfileId}:${config.dispatcher.modelId}`,
    })
    const result = await this.deps.complete('连通性测试：请原样回复 ok', {
      providerId: config.dispatcher.providerProfileId,
      model: config.dispatcher.modelId,
      maxTokens: 16,
      timeoutMs: config.dispatcher.timeoutMs,
    })
    const latencyMs = Date.now() - t0
    if (result.available) {
      log.info('dispatcher connectivity test ok', { latencyMs, textPreview: result.text.slice(0, 20) })
      return { ok: true, latencyMs }
    }
    const error = extractDispatchFailureDetail(result.reason)
    log.warn('dispatcher connectivity test failed', { latencyMs, error })
    return { ok: false, latencyMs, error }
  }

  // ─── 内部 ───────────────────────────────────────────────────────────────

  private validateExecutors(config: AutoRouterConfig): {
    validExecutors: AutoRouterExecutorRef[]
    invalidEntries: Array<{ entryId: string; providerId: string; reason: string }>
  } {
    const validExecutors: AutoRouterExecutorRef[] = []
    const invalidEntries: Array<{ entryId: string; providerId: string; reason: string }> = []
    for (const entry of config.executors) {
      if (!entry.enabled) continue
      const providerRow = this.deps.getProviderRow(entry.providerProfileId)
      if (providerRow == null) {
        invalidEntries.push({ entryId: entry.id, providerId: entry.providerProfileId, reason: 'provider_missing' })
        continue
      }
      if (providerRow.enabled === 0) {
        invalidEntries.push({ entryId: entry.id, providerId: entry.providerProfileId, reason: 'provider_disabled' })
        continue
      }
      if (entry.modelId.length === 0) {
        invalidEntries.push({ entryId: entry.id, providerId: entry.providerProfileId, reason: 'model_missing' })
        continue
      }
      validExecutors.push(entry)
    }
    return { validExecutors, invalidEntries }
  }

  private resolveAdapterMismatchExecutor(
    config: AutoRouterConfig,
    validExecutors: AutoRouterExecutorRef[],
    sessionAdapter: RouterAdapter,
  ): AutoRouterExecutorRef | null {
    // 优先兜底强度、再按声明顺序找第一条匹配会话引擎的渠道
    const candidates = [
      ...validExecutors.filter((entry) => entry.intensity === config.fallbackIntensity),
      ...validExecutors.filter((entry) => entry.intensity !== config.fallbackIntensity),
    ]
    for (const entry of candidates) {
      const providerRow = this.deps.getProviderRow(entry.providerProfileId)
      if (providerRow != null && providerRowMatchesAdapter(providerRow, sessionAdapter)) {
        return entry
      }
    }
    return null
  }

  private async callDispatcher(
    input: AutoRouterRouteInput,
    prevIntensity: RouterIntensity | null,
  ): Promise<
    | { decision: AutoRouterDispatchDecision; cancelled: false; attemptCount: number; failureStage?: undefined; failureDetail?: undefined }
    | { decision: null; cancelled: true; attemptCount: number; failureStage?: undefined; failureDetail?: undefined }
    | {
        decision: null
        cancelled: false
        attemptCount: number
        failureStage: 'timeout' | 'http' | 'schema'
        /** 人话失败摘要（HTTP 状态 + 业务 message），透出到降级 reason/日志/事件。 */
        failureDetail?: string
      }
  > {
    const abortController = new AbortController()
    const cancelPoll = setInterval(() => {
      if (input.isTurnCancelled()) abortController.abort()
    }, 100)
    const inputDigest = {
      msgLen: input.userMessage.length,
      estTokens: input.estimatedTokens,
      eventCount: input.eventCount,
      prevIntensity,
    }
    try {
      // 前置检查：调用前轮次已取消则不发请求（interval 轮询覆盖在途取消）
      if (input.isTurnCancelled()) {
        return { decision: null, cancelled: true, attemptCount: 0 }
      }
      let attemptCount = 0
      let lastFailureStage: 'timeout' | 'http' | 'schema' = 'http'
      let lastFailureDetail: string | undefined
      // 最多 2 次尝试（1 次重试），schema 失败重试时强调输出格式
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        attemptCount = attempt
        // 在途取消（interval 轮询已 abort 上一次请求）后不得再补发下一次尝试：
        // 重试耗尽会走到函数末尾带 cancelled=false 返回，调用方按"规则兜底降级"
        // 继续执行这条已被用户取消的轮次（claude/codex 路径仅靠下游 isTurnCancelled
        // 闸门兜住，spark 执行器路径没有该闸门，会真的把轮次跑起来）。
        if (attempt > 1 && input.isTurnCancelled()) {
          return { decision: null, cancelled: true, attemptCount: attempt - 1 }
        }
        log.info('dispatcher request dispatched', {
          turnId: input.turnId,
          dispatcherModel: `${input.config.dispatcher.providerProfileId}:${input.config.dispatcher.modelId}`,
          attempt,
          inputDigest,
        })
        const result = await this.deps.complete(buildDispatcherUserPayload(input, prevIntensity), {
          providerId: input.config.dispatcher.providerProfileId,
          model: input.config.dispatcher.modelId,
          systemPrompt: buildDispatcherSystemPrompt(input.config),
          maxTokens: 512,
          timeoutMs: input.config.dispatcher.timeoutMs,
          abortSignal: abortController.signal,
        })
        if (!result.available) {
          lastFailureStage = classifyDispatchFailure(result.reason)
          lastFailureDetail = extractDispatchFailureDetail(result.reason)
          // 确定性 4xx（鉴权/权限/模型不存在/请求非法）：重试必然同样失败，立即收口，
          // 不为每轮白付一次额外调用与等待（如"套餐未开放模型权限"会陪伴每一轮）。
          if (lastFailureStage === 'http' && isDeterministicHttpFailure(result.reason)) {
            log.warn('dispatcher failed with deterministic http error; skip retry', {
              turnId: input.turnId,
              failureStage: lastFailureStage,
              failureDetail: lastFailureDetail,
              attempt,
            })
            break
          }
          continue
        }
        const jsonText = extractJsonText(result.text)
        if (jsonText == null) {
          lastFailureStage = 'schema'
          lastFailureDetail = `分流器响应中未找到 JSON（返回 ${(result.text ?? '').slice(0, 80)}…）`
          continue
        }
        const parsed = AutoRouterDispatchDecisionSchema.safeParse(safeJsonParse(jsonText))
        if (parsed.success) {
          return { decision: parsed.data, cancelled: false, attemptCount }
        }
        lastFailureStage = 'schema'
        lastFailureDetail = `分流器 JSON 不符合决策 schema：${jsonText.slice(0, 120)}`
      }
      // 兜底：两次尝试都以"被取消"告终（如两次都在取消瞬间失败）时同样按取消收口，
      // 不让取消伪装成超时降级。
      if (input.isTurnCancelled()) {
        return { decision: null, cancelled: true, attemptCount }
      }
      return {
        decision: null,
        cancelled: false,
        attemptCount,
        failureStage: lastFailureStage,
        ...(lastFailureDetail != null ? { failureDetail: lastFailureDetail } : {}),
      }
    } finally {
      clearInterval(cancelPoll)
    }
  }

  private buildResult(args: {
    input: AutoRouterRouteInput
    prevIntensity: RouterIntensity | null
    latencyMs: number
    intensity: RouterIntensity
    resolved: AutoRouterExecutorRef | null
    reason: string
    fallbackUsed: boolean
    fallbackStage?: AutoRouterRouteResult['fallbackStage']
    adapterMismatch?: boolean
    cancelled?: boolean
    decompose?: boolean
    subtasks?: AutoRouterDispatchDecision['subtasks']
    keptPrevIntensity?: boolean
    invalidEntries: Array<{ entryId: string; providerId: string; reason: string }>
  }): AutoRouterRouteResult {
    return {
      ok: args.resolved != null,
      intensity: args.intensity,
      resolvedProviderId: args.resolved?.providerProfileId ?? '',
      resolvedModelId: args.resolved?.modelId ?? '',
      modelDisplayName: args.resolved?.modelId ?? '',
      reason: args.reason,
      fallbackUsed: args.fallbackUsed,
      ...(args.fallbackStage != null ? { fallbackStage: args.fallbackStage } : {}),
      ...(args.adapterMismatch === true ? { adapterMismatch: true } : {}),
      latencyMs: args.latencyMs,
      prevIntensity: args.prevIntensity,
      ...(args.resolved?.reasoningEffort != null
        ? { reasoningEffort: args.resolved.reasoningEffort }
        : {}),
      keptPrevIntensity: args.keptPrevIntensity === true,
      decompose: args.decompose === true,
      subtasks: args.subtasks ?? [],
      cancelled: args.cancelled === true,
      invalidEntries: args.invalidEntries,
    }
  }
}

function classifyDispatchFailure(reason: string): 'timeout' | 'http' {
  if (/timeout|timed?\s*out|aborted|ETIMEDOUT/i.test(reason)) return 'timeout'
  return 'http'
}

/**
 * 确定性失败（重试也不会成功）：鉴权/权限/模型不存在/请求非法等 4xx。
 * 429 视为可能瞬时限流，保留一次重试（套餐权限类 429 重试虽白费，但通用上无法区分）。
 */
function isDeterministicHttpFailure(reason: string): boolean {
  const m = /HTTP (4\d\d)/.exec(reason)
  if (m == null) return false
  const status = Number(m[1])
  return status !== 429
}

/**
 * 从 complete 失败 reason 提取人话摘要：优先取响应体 JSON 里的 message 字段
 * （如智谱 "[1311][当前订阅套餐暂未开放GLM-5.3-FlashX权限]"），否则截断原文。
 * 仅用于日志/决策事件 reason 展示，不参与控制流。
 */
export function extractDispatchFailureDetail(reason: string): string {
  const httpStatus = /HTTP (\d+)/.exec(reason)?.[1]
  const messageMatch =
    /"message"\s*:\s*"([^"]{1,200})"/.exec(reason)?.[1] ??
    /HTTP \d+: ([^"{][^}]{1,160})/.exec(reason)?.[1]
  const detail = (messageMatch ?? reason).replace(/\s+/g, ' ').trim().slice(0, 160)
  return httpStatus != null ? `HTTP ${httpStatus}：${detail}` : detail
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
