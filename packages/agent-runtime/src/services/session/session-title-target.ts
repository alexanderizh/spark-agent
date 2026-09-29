/**
 * 会话标题模型解析（2026-09-29 智能路由支持）。
 *
 * 三处标题链路共用同一套「会话 → 可直连渠道 + 模型」解析：
 *  - 重命名弹窗「提取标题」（session-title-extraction）
 *  - 命令会话首轮标题精炼（session-command-title-refinement）
 *  - goal 会话标题精炼（session.service#refineGoalSessionTitleAsync）
 *
 * 普通渠道：session.model_id → provider defaultModel，与历史行为一致。
 * 智能路由（provider_type='auto-router'）：router 行只是配置容器，
 * keystore_ref 恒为空、会话 model_id 按协议恒为空，不能直连；改为从
 * router 配置里挑一个「标题模型」候选：
 *   1. 分流器（dispatcher）——router 自己的轻量语义分析模型，与生成标题
 *      同类任务，成本低；
 *   2. fallbackIntensity 档第一个启用执行器；
 *   3. 任意第一个启用执行器。
 * 逐个校验（渠道存在、启用、已配 key、modelId 非空），取第一个通过的；
 * 全部不可用返回 router_unavailable，由调用方决定提示文案。
 *
 * 默认渠道借道（2026-09-30）：普通渠道不可直连（provider_no_api_key，
 * 典型为本地 CLI 渠道走宿主 OAuth、无直发 key）时，回退尝试平台默认渠道
 * （is_default=1）出标题——否则本地 CLI 会话永远只有本地派生截断标题。
 * 借道会消耗默认渠道 token，成功时打 info 日志留痕。
 */
import {
  AUTO_ROUTER_PROVIDER_TYPE,
  findExecutorByIntensity,
  parseAutoRouterConfig,
} from '@spark/protocol'
import {
  ProviderProfileRepository,
  type ProviderProfileRow,
  type SparkDatabase,
} from '@spark/storage'
import { createLogger } from '@spark/shared'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'

const log = createLogger('session-title-target')

/** 标题链路失败码：provider_missing / provider_no_api_key / model_missing 与历史一致。 */
export type SessionTitleTargetFailureCode =
  | 'provider_missing'
  | 'provider_no_api_key'
  | 'model_missing'
  | 'router_unavailable'

/** 解析出的可直连标题模型（含已取出的 apiKey）。 */
export interface SessionTitleTarget {
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
  /** 渠道声明的 apiEndpoint 是完整请求地址：原样请求，不做自动拼裁。 */
  apiEndpointFullUrl?: boolean | undefined
  model: string
}

export type SessionTitleTargetResolution =
  | { ok: true; target: SessionTitleTarget }
  | { ok: false; code: SessionTitleTargetFailureCode }

/** 只依赖会话行的两个字段，避免调用方被 SessionRow 全量结构耦合。 */
export interface SessionTitleTargetSession {
  provider_profile_id: string | null
  model_id: string | null
}

/**
 * 普通渠道保持历史语义：provider 行缺失或未配 key → provider_no_api_key
 * （含本地 CLI Provider，它没有可直连的 HTTP 端点）；模型缺省 → model_missing。
 *
 * keystore_ref 非空但 Keychain 里取不到 secret（条目被清 / 托管恢复失败）时同样按
 * provider_no_api_key 处理——与改造前两处调用点的 `if (apiKey.length === 0) return`
 * 守卫等价，避免带着空 key 去打一场必然 401 的请求。
 */
export async function resolveSessionTitleTarget(params: {
  db: SparkDatabase
  session: SessionTitleTargetSession
}): Promise<SessionTitleTargetResolution> {
  if (params.session.provider_profile_id == null) return { ok: false, code: 'provider_missing' }
  const providerRepo = new ProviderProfileRepository(params.db)
  const provider = providerRepo.get(params.session.provider_profile_id)
  // provider 行缺失按 provider_no_api_key 处理：与改造前 extractSessionTitle 的
  // 映射逐字一致（旧代码 `provider == null || keystoreRef.length === 0` 同码）。
  if (provider == null) return { ok: false, code: 'provider_no_api_key' }

  if (provider.provider_type === AUTO_ROUTER_PROVIDER_TYPE) {
    return resolveAutoRouterTitleTarget(providerRepo, provider)
  }
  const direct = await resolveDirectTitleTarget(provider, params.session.model_id)
  if (direct.ok || direct.code !== 'provider_no_api_key') return direct
  // 渠道不可直连（本地 CLI 走宿主 OAuth / 凭据取不到）：借默认渠道出标题。
  return resolveDefaultProviderTitleTarget(providerRepo, provider)
}

/**
 * 默认渠道借道：仅当默认渠道存在、启用、可直连且不是原渠道自身时生效。
 * 默认渠道若是智能路由，按 router 候选链解析（dispatcher → fallback → 任意启用执行器）。
 * 借道消耗的是默认渠道的 token，成功时 info 留痕（渠道切换是成本相关决策）。
 */
async function resolveDefaultProviderTitleTarget(
  providerRepo: ProviderProfileRepository,
  originalProvider: ProviderProfileRow,
): Promise<SessionTitleTargetResolution> {
  const fallbackRow = providerRepo.getDefault()
  if (fallbackRow == null || fallbackRow.id === originalProvider.id) {
    return { ok: false, code: 'provider_no_api_key' }
  }
  if (fallbackRow.provider_type === AUTO_ROUTER_PROVIDER_TYPE) {
    const routed = await resolveAutoRouterTitleTarget(providerRepo, fallbackRow)
    if (routed.ok) {
      log.info(
        'title target borrowed from default auto-router provider (original provider has no direct credentials)',
        { originalProviderId: originalProvider.id, routerId: fallbackRow.id },
      )
    }
    return routed
  }
  if (fallbackRow.enabled !== 1) return { ok: false, code: 'provider_no_api_key' }
  if ((fallbackRow.keystore_ref?.trim() ?? '').length === 0) {
    return { ok: false, code: 'provider_no_api_key' }
  }
  const fallbackConfig = parseProviderConfig(fallbackRow.config_json)
  const fallbackModel = fallbackConfig.defaultModel?.trim() ?? ''
  if (fallbackModel.length === 0) return { ok: false, code: 'model_missing' }
  const target = await buildTitleTarget(fallbackRow, fallbackModel)
  if (target == null) return { ok: false, code: 'provider_no_api_key' }
  log.info(
    'title target borrowed from default provider (original provider has no direct credentials)',
    { originalProviderId: originalProvider.id, fallbackProviderId: fallbackRow.id },
  )
  return { ok: true, target }
}

async function resolveDirectTitleTarget(
  provider: ProviderProfileRow,
  sessionModelId: string | null,
): Promise<SessionTitleTargetResolution> {
  const keystoreRef = provider.keystore_ref?.trim() ?? ''
  if (keystoreRef.length === 0) return { ok: false, code: 'provider_no_api_key' }
  const config = parseProviderConfig(provider.config_json)
  const model = sessionModelId?.trim() || config.defaultModel?.trim() || ''
  if (model.length === 0) return { ok: false, code: 'model_missing' }
  const target = await buildTitleTarget(provider, model)
  if (target == null) return { ok: false, code: 'provider_no_api_key' }
  return { ok: true, target }
}

/**
 * 智能路由标题模型候选解析。候选构造是纯数据操作，逐个落库校验，
 * 任一候选可用即返回；路由配置整体失效时 candidates 为空 → router_unavailable。
 */
async function resolveAutoRouterTitleTarget(
  providerRepo: ProviderProfileRepository,
  routerRow: ProviderProfileRow,
): Promise<SessionTitleTargetResolution> {
  const config = parseAutoRouterConfig(parseJsonLoose(routerRow.config_json))
  const candidates: Array<{ providerProfileId: string; modelId: string }> = []
  if (config != null) {
    const dispatcherModelId = config.dispatcher.modelId.trim()
    if (dispatcherModelId.length > 0) {
      candidates.push({
        providerProfileId: config.dispatcher.providerProfileId,
        modelId: dispatcherModelId,
      })
    }
    const fallbackExecutor = findExecutorByIntensity(config, config.fallbackIntensity)
    if (fallbackExecutor != null) {
      candidates.push({
        providerProfileId: fallbackExecutor.providerProfileId,
        modelId: fallbackExecutor.modelId,
      })
    }
    for (const entry of config.executors) {
      if (!entry.enabled) continue
      candidates.push({ providerProfileId: entry.providerProfileId, modelId: entry.modelId })
    }
  }

  for (const candidate of candidates) {
    const modelId = candidate.modelId.trim()
    if (modelId.length === 0) continue
    const row = providerRepo.get(candidate.providerProfileId)
    // 渠道被删/停用、未配 key（本地 CLI 执行器）都跳过，继续找下一个候选。
    if (row == null || row.enabled !== 1) continue
    if ((row.keystore_ref?.trim() ?? '').length === 0) continue
    const target = await buildTitleTarget(row, modelId)
    // keystore_ref 有值但 secret 取不到：该候选同样不可用，继续往下找。
    if (target == null) continue
    return { ok: true, target }
  }

  log.warn('auto-router title target unavailable', {
    routerId: routerRow.id,
    routerName: routerRow.name,
    candidateCount: candidates.length,
    configValid: config != null,
  })
  return { ok: false, code: 'router_unavailable' }
}

/**
 * 构造可直连标题目标。secret 取不到（keystore_ref 有值但 Keychain 无条目 /
 * 托管恢复失败）时返回 null，由调用方按不可用处理。
 */
async function buildTitleTarget(
  provider: ProviderProfileRow,
  model: string,
): Promise<SessionTitleTarget | null> {
  const config = parseProviderConfig(provider.config_json)
  const apiKey = await resolveProviderApiKey(provider)
  if (apiKey.length === 0) return null
  return {
    providerType: provider.provider_type,
    apiKey,
    ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
    ...(config.apiEndpointFullUrl === true ? { apiEndpointFullUrl: true } : {}),
    model,
  }
}

interface ProviderTitleConfig {
  apiEndpoint?: string
  apiEndpointFullUrl?: boolean
  defaultModel?: string
}

function parseProviderConfig(configJson: string): ProviderTitleConfig {
  const parsed = parseJsonLoose(configJson)
  if (parsed == null || typeof parsed !== 'object') return {}
  const record = parsed as Record<string, unknown>
  return {
    ...(typeof record.apiEndpoint === 'string' ? { apiEndpoint: record.apiEndpoint } : {}),
    ...(record.apiEndpointFullUrl === true ? { apiEndpointFullUrl: true } : {}),
    ...(typeof record.defaultModel === 'string' ? { defaultModel: record.defaultModel } : {}),
  }
}

function parseJsonLoose(text: string | null | undefined): unknown {
  if (typeof text !== 'string' || text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
