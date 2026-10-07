import { z } from 'zod'
import type { SessionReasoningEffort } from './ipc/index.js'

/**
 * AutoRouter 配置协议（重构版）。
 *
 * AutoRouter 是 `provider_profiles` 表中 `provider_type = 'auto-router'` 的真实落库行，
 * `config_json` 存本文件定义的 `AutoRouterConfig`。每个 router 由一个分流器模型
 * （dispatcher）分析任务强度，并派发给按强度（高/平衡/低）配置的执行模型。
 *
 * 旧实现（伪 provider + model_profiles 路由卡）已于 2026-09 重构下线，
 * 见 todo/2026-09-21-AutoRouter重构方案-多路由器与LLM分流分级执行.md。
 */

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** provider_profiles.provider_type 的 AutoRouter 取值。 */
export const AUTO_ROUTER_PROVIDER_TYPE = 'auto-router' as const

/**
 * 分流器决策超时默认值（2 分钟）。
 * 上限是故障兜底而非正常耗时：模型快返回时不产生等待，仅在真超时等满后才走规则降级；
 * 默认值需覆盖带思考时间模型的完整思考链路，30s 对此类模型几乎必然超时降级。
 */
export const AUTO_ROUTER_DISPATCHER_TIMEOUT_DEFAULT_MS = 120_000

/** 分流器决策超时上限（5 分钟），给长思考模型留配置空间。 */
export const AUTO_ROUTER_DISPATCHER_TIMEOUT_MAX_MS = 300_000

/**
 * 旧伪 provider 魔法 id（已废弃）。仅用于识别存量会话引用并回退默认渠道，
 * 不得再用于新建任何 Provider 行。
 */
export const LEGACY_CLAUDE_AUTO_ROUTER_PROVIDER_ID = 'claude-auto-router'
export const LEGACY_CODEX_AUTO_ROUTER_PROVIDER_ID = 'codex-auto-router'

const LEGACY_AUTO_ROUTER_PROVIDER_IDS: ReadonlySet<string> = new Set([
  LEGACY_CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  LEGACY_CODEX_AUTO_ROUTER_PROVIDER_ID,
])

/** 判断 provider id 是否为已废弃的旧 Auto Router 魔法 id。 */
export function isLegacyAutoRouterProviderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && LEGACY_AUTO_ROUTER_PROVIDER_IDS.has(id)
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** router 绑定的引擎：claude = anthropic 渠道，codex = openai 系渠道。 */
export type RouterAdapter = 'claude' | 'codex'

/** 任务执行强度：高 / 平衡 / 低。 */
export type RouterIntensity = 'high' | 'balanced' | 'low'

export const ROUTER_INTENSITIES: readonly RouterIntensity[] = ['high', 'balanced', 'low']

/** router 下按强度配置的执行模型条目。 */
export interface AutoRouterExecutorRef {
  /** 条目 id（单个 router 内唯一）。 */
  id: string
  providerProfileId: string
  modelId: string
  intensity: RouterIntensity
  enabled: boolean
  /**
   * 执行器显式推理强度（模型思考深度，与条目的"任务强度档位"无关）。
   * null/缺省 = 跟随会话/Agent 既有配置；显式配置后经该执行器执行的轮次以此为准。
   * 联合里显式含 undefined：与 zod .nullish() 推断对齐（exactOptionalPropertyTypes）。
   */
  reasoningEffort?: SessionReasoningEffort | null | undefined
}

/** 分流器模型配置。 */
export interface AutoRouterDispatcherConfig {
  providerProfileId: string
  modelId: string
  /** 分流决策超时毫秒数。上限是故障兜底而非正常耗时：模型快返回时不产生等待，
   * 仅在真超时等满后才走规则降级；默认值需覆盖带思考时间的模型。 */
  timeoutMs: number
}

/**
 * 执行器运行时健康快照（进程内注册表的只读投影）。
 *
 * 执行器以上游错误（429/5xx/超时/鉴权失败等）终态失败时会被短期"冻结"：
 * 冻结期间选执行器自动避让（同强度按声明顺序取下一条健康条目），到期自动
 * 解冻（半开恢复：解冻后第一笔成功即清零计数，失败则递进升级冻结时长）。
 * 状态仅存活于进程内存，重启即清零——分钟级临时态没有持久化价值。
 */
export interface AutoRouterExecutorHealthSnapshot {
  providerId: string
  modelId: string
  /** frozen = 冻结中（选执行器时避让）；healthy = 可用。 */
  state: 'healthy' | 'frozen'
  /** 解冻时间戳（epoch ms）；healthy 时为 null。 */
  frozenUntil: number | null
  /** 距解冻剩余毫秒（快照生成时刻）；healthy 时为 null。 */
  frozenRemainingMs: number | null
  /** 连续失败次数（成功一次即清零；冻结到期不清零，下次失败递进升级）。 */
  consecutiveFailures: number
  /** 最近一次失败归类：retryable（瞬时）/ deterministic（鉴权/配额类，不会自愈）。 */
  lastFailureKind: 'retryable' | 'deterministic' | null
  /** 最近一次失败的人话摘要（截断）。 */
  lastErrorDetail: string | null
  /** 最近一次失败时间戳（epoch ms）。 */
  lastFailureAt: number | null
}

export interface AutoRouterConfig {
  kind: 'auto-router'
  version: 1
  adapter: RouterAdapter
  dispatcher: AutoRouterDispatcherConfig
  /** 1..n 个执行模型条目；同一强度可配多个（取第一个有效条目）。 */
  executors: AutoRouterExecutorRef[]
  /** 分流失败时的兜底强度。 */
  fallbackIntensity: RouterIntensity
  /** 是否允许分流器拆分子任务（decomposed 模式）。 */
  allowDecomposition: boolean
  /** 拆分子任务并发上限（受会话每轮派发预算约束）。 */
  maxConcurrentSubtasks: number
  /** 是否将强度档位映射注入引擎子代理环境变量（仅 claude 引擎生效）。 */
  subagentIntensityMapping: boolean
}

// ─── Zod Schema ──────────────────────────────────────────────────────────────

export const RouterAdapterSchema = z.enum(['claude', 'codex'])

export const RouterIntensitySchema = z.enum(['high', 'balanced', 'low'])

/**
 * 推理强度枚举（与 schemas 的 SessionReasoningEffortSchema 同值）。
 * 本地重复定义以避免与 schemas/index.ts 的值级循环依赖（后者 import 本模块）。
 */
export const RouterReasoningEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export const AutoRouterExecutorRefSchema = z.object({
  id: z.string().min(1),
  providerProfileId: z.string().min(1),
  modelId: z.string().min(1),
  intensity: RouterIntensitySchema,
  enabled: z.boolean().default(true),
  reasoningEffort: RouterReasoningEffortSchema.nullish(),
})

export const AutoRouterDispatcherConfigSchema = z.object({
  providerProfileId: z.string().min(1),
  modelId: z.string().min(1),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(AUTO_ROUTER_DISPATCHER_TIMEOUT_MAX_MS)
    .default(AUTO_ROUTER_DISPATCHER_TIMEOUT_DEFAULT_MS),
})

export const AutoRouterConfigSchema = z.object({
  kind: z.literal('auto-router'),
  version: z.literal(1).default(1),
  adapter: RouterAdapterSchema,
  dispatcher: AutoRouterDispatcherConfigSchema,
  executors: z.array(AutoRouterExecutorRefSchema).default([]),
  fallbackIntensity: RouterIntensitySchema.default('balanced'),
  allowDecomposition: z.boolean().default(true),
  maxConcurrentSubtasks: z.number().int().min(1).max(10).default(3),
  subagentIntensityMapping: z.boolean().default(true),
})

// ─── 解析与判定 ──────────────────────────────────────────────────────────────

/**
 * 判断一个 Provider profile 是否为 AutoRouter 行。
 * 兼容传入完整 ProviderProfile（含可选 providerType 字段）或数据库行（provider_type）。
 */
export function isAutoRouterProviderProfile(
  profile:
    | { providerType?: string | undefined }
    | { provider_type?: string | undefined }
    | string
    | null
    | undefined,
): boolean {
  if (profile == null) return false
  if (typeof profile === 'string') {
    return isLegacyAutoRouterProviderId(profile) || profile === AUTO_ROUTER_PROVIDER_TYPE
  }
  if ('providerType' in profile && typeof profile.providerType === 'string') {
    return profile.providerType === AUTO_ROUTER_PROVIDER_TYPE
  }
  if ('provider_type' in profile && typeof profile.provider_type === 'string') {
    return profile.provider_type === AUTO_ROUTER_PROVIDER_TYPE
  }
  return false
}

/**
 * 安全解析 config_json 为 AutoRouterConfig。
 * 任何结构不合法都返回 null（由调用方决定降级行为），不抛异常。
 */
export function parseAutoRouterConfig(value: unknown): AutoRouterConfig | null {
  const result = AutoRouterConfigSchema.safeParse(value)
  return result.success ? result.data : null
}

/** 生成带默认值的新 router 配置（管理页新建表单用）。 */
export function createDefaultAutoRouterConfig(adapter: RouterAdapter): AutoRouterConfig {
  return {
    kind: 'auto-router',
    version: 1,
    adapter,
    dispatcher: {
      providerProfileId: '',
      modelId: '',
      timeoutMs: AUTO_ROUTER_DISPATCHER_TIMEOUT_DEFAULT_MS,
    },
    executors: [],
    fallbackIntensity: 'balanced',
    allowDecomposition: true,
    maxConcurrentSubtasks: 3,
    subagentIntensityMapping: true,
  }
}

/** 按强度取第一个启用条目。 */
export function findExecutorByIntensity(
  config: AutoRouterConfig,
  intensity: RouterIntensity,
): AutoRouterExecutorRef | null {
  return config.executors.find((entry) => entry.enabled && entry.intensity === intensity) ?? null
}

// ─── 执行器资格校验（收敛多媒体 / 向量渠道过滤）──────────────────────────────

/** 与渲染端 provider-model-kind.ts 收敛共享的"文本对话渠道"判定输入。 */
export interface ProviderEligibilityInput {
  /** 渠道协议类型（anthropic / openai / openai-compatible / deepseek / ollama…）。 */
  provider: string
  /** 模型能力类型；image / voice / video 为多媒体生成渠道。 */
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video' | undefined
  /** Embeddings 向量渠道标记。 */
  codexApiKind?: 'chat' | 'responses' | 'embedding' | undefined
  mediaProvider?: string | null | undefined
  mediaCapabilities?: readonly string[] | undefined
}

const NON_TEXT_MODEL_TYPES: ReadonlySet<string> = new Set(['image', 'voice', 'video'])

/** 多媒体生成渠道（图像/语音/视频）与向量渠道不能承接文本 turn。 */
export function isConversationalProviderCandidate(provider: ProviderEligibilityInput): boolean {
  if (provider.modelType != null && NON_TEXT_MODEL_TYPES.has(provider.modelType)) {
    return false
  }
  if (provider.codexApiKind === 'embedding') return false
  if (provider.mediaProvider != null) return false
  if ((provider.mediaCapabilities ?? []).length > 0) return false
  return true
}

/**
 * 渠道是否有资格持有全局「默认 Provider」位（默认仅限对话渠道）。
 *
 * 与 isConversationalProviderCandidate 的口径差异：对话 + 媒体生成的混合渠道
 * （modelType 为 text/multimodal 且挂媒体能力）仍能承接文本 turn，保留默认资格；
 * 仅整条渠道为多媒体生成（modelType image/voice/video）或向量（embedding）时排除。
 */
export function canProviderHoldChatDefault(provider: ProviderEligibilityInput): boolean {
  if (provider.modelType != null && NON_TEXT_MODEL_TYPES.has(provider.modelType)) {
    return false
  }
  return provider.codexApiKind !== 'embedding'
}

const CODEX_TEXT_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  'openai',
  'openai-compatible',
  'deepseek',
  'ollama',
])

/**
 * 渠道是否可作为 router 的执行器 / 分流器候选。
 * claude 引擎仅认 anthropic 渠道；codex 引擎认 openai 系渠道。
 */
export function isProviderAllowedForAutoRouter(
  adapter: RouterAdapter,
  provider: ProviderEligibilityInput,
): boolean {
  if (!isConversationalProviderCandidate(provider)) return false
  if (adapter === 'claude') return provider.provider === 'anthropic'
  return CODEX_TEXT_PROVIDER_TYPES.has(provider.provider)
}

/**
 * 执行器健康追踪键（`providerId::modelId`，同渠道不同模型独立计数）。
 * 主进程写入（健康注册表）与渲染端查询（悬浮卡/管理弹窗）必须逐字节一致，
 * 统一由此函数生成——两侧任何一侧手拼出偏差都会让健康展示静默消失。
 */
export function executorHealthKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}
