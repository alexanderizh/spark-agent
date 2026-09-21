import {
  ROUTER_INTENSITIES,
  findExecutorByIntensity,
  type AutoRouterConfig,
  type ProviderProfile,
  type RouterAdapter,
  type RouterIntensity,
} from '@spark/protocol'
import { routerIntensityColor, routerIntensityLabel } from '../../utils/auto-router-display'

/**
 * 会话模型选择器「智能路由」行悬浮卡片的视图模型（纯函数，可单测）。
 *
 * 数据全部来自 ProviderProfile.autoRouterConfig（与运行时读的是同一份配置）；
 * 执行模型行展示"运行时真正会用到的那一条"（findExecutorByIntensity 与
 * auto-router.service 选执行器同源），备用 / 停用条目只在行尾以计数提示，
 * 卡片本身不引入任何新的数据来源或协议字段。
 */

const ADAPTER_LABELS: Record<RouterAdapter, string> = {
  claude: 'Claude 引擎',
  codex: 'Codex 引擎',
}

const UNCONFIGURED_MODEL = '未配置'

/** 悬浮卡片的一行：分流器行或某个强度档位行。 */
export interface AutoRouterHoverCardRow {
  /** 行标识（'dispatcher' 或 `intensity:${RouterIntensity}`），仅用于 React key。 */
  key: string
  /** 行首标签：「分流器」/「高」/「平衡」/「低」。 */
  label: string
  /** 强度色点颜色；分流器行没有色点（null）。 */
  dotColor: string | null
  /** 主文案：执行/分流模型名；未配置时为「未配置」。 */
  modelLabel: string
  /** 渠道名；渠道已删除或解析不到时为 null（不渲染占位）。 */
  providerLabel: string | null
  /** 行尾 meta；无内容时为 null。 */
  meta: string | null
  /**
   * 该档位没有启用条目：色点转空心，模型名让位给「未配置」，
   * 兜底说明放在 meta（与运行时「该强度 → fallbackIntensity → 首个有效条目」一致）。
   */
  isFallback: boolean
}

export interface AutoRouterHoverCardModel {
  /** 路由器名称（卡片标题）。 */
  name: string
  /** 绑定引擎标签：「Claude 引擎」/「Codex 引擎」。 */
  adapterLabel: string
  /** 分流器行 + 三强度行，顺序固定。 */
  rows: AutoRouterHoverCardRow[]
  /** 底部一行摘要（兜底强度 / 拆分 / 子代理映射）。 */
  footer: string
  /** 配置解析失败时的单行说明；非 null 时只渲染这一行。 */
  error: string | null
}

/** 分流决策超时展示：≥1s 用秒（8s / 8.5s），否则毫秒（800ms）。 */
export function formatAutoRouterTimeout(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return '未配置超时'
  if (timeoutMs >= 1000) return `${Number((timeoutMs / 1000).toFixed(1))}s`
  return `${Math.round(timeoutMs)}ms`
}

function resolveProviderLabel(
  providerNames: ReadonlyMap<string, string>,
  providerId: string,
): string | null {
  const name = providerNames.get(providerId)?.trim() ?? ''
  return name.length > 0 ? name : null
}

function executorMeta(
  config: AutoRouterConfig,
  reasoningEffort: string | null,
  intensity: RouterIntensity,
): string[] {
  const parts: string[] = []
  if (reasoningEffort != null) parts.push(`推理 ${reasoningEffort}`)
  // 同档位的其余条目：启用的是备用，停用的单独计数（不展开成多行，避免卡片过高）。
  const tiers = config.executors.filter((entry) => entry.intensity === intensity)
  const spareCount = tiers.filter((entry) => entry.enabled).length - 1
  const disabledCount = tiers.filter((entry) => !entry.enabled).length
  if (spareCount > 0) parts.push(`+${spareCount} 备用`)
  if (disabledCount > 0) parts.push(`+${disabledCount} 停用`)
  return parts
}

/** 该档位未配置执行器时的兜底说明（对齐 auto-router.service 的选执行器链路）。 */
function fallbackHint(config: AutoRouterConfig, intensity: RouterIntensity): string {
  if (!config.executors.some((entry) => entry.enabled)) return '无启用执行模型'
  if (intensity === config.fallbackIntensity) return '走首个启用条目'
  if (findExecutorByIntensity(config, config.fallbackIntensity) != null) {
    return `走兜底「${routerIntensityLabel(config.fallbackIntensity)}」`
  }
  return '走首个启用条目'
}

export function buildAutoRouterHoverCardModel(input: {
  name: string
  config: AutoRouterConfig | null
  /** 全量渠道（含 router 行自身之外的普通渠道），用于把 providerProfileId 解析成渠道名。 */
  providers: readonly ProviderProfile[]
}): AutoRouterHoverCardModel {
  const { name, config, providers } = input
  const providerNames = new Map<string, string>()
  for (const provider of providers) {
    if (!providerNames.has(provider.id)) providerNames.set(provider.id, provider.name)
  }
  if (config == null) {
    return {
      name,
      adapterLabel: '',
      rows: [],
      footer: '',
      error: '路由器配置无效，无法展示分流配置',
    }
  }

  const dispatcherModelId = config.dispatcher.modelId.trim()
  const rows: AutoRouterHoverCardRow[] = [
    {
      key: 'dispatcher',
      label: '分流器',
      dotColor: null,
      modelLabel: dispatcherModelId.length > 0 ? dispatcherModelId : UNCONFIGURED_MODEL,
      providerLabel: resolveProviderLabel(providerNames, config.dispatcher.providerProfileId),
      meta: formatAutoRouterTimeout(config.dispatcher.timeoutMs),
      isFallback: false,
    },
  ]

  for (const intensity of ROUTER_INTENSITIES) {
    const executor = findExecutorByIntensity(config, intensity)
    const modelId = executor?.modelId.trim() ?? ''
    const metaParts =
      executor != null
        ? executorMeta(config, executor.reasoningEffort ?? null, intensity)
        : [fallbackHint(config, intensity)]
    rows.push({
      key: `intensity:${intensity}`,
      label: routerIntensityLabel(intensity),
      dotColor: routerIntensityColor(intensity),
      modelLabel: executor == null ? UNCONFIGURED_MODEL : modelId || UNCONFIGURED_MODEL,
      providerLabel:
        executor != null
          ? resolveProviderLabel(providerNames, executor.providerProfileId)
          : null,
      meta: metaParts.length > 0 ? metaParts.join(' · ') : null,
      isFallback: executor == null,
    })
  }

  const decompositionLabel = config.allowDecomposition
    ? `拆分 ≤${config.maxConcurrentSubtasks}`
    : '不拆分'
  const mappingLabel = config.subagentIntensityMapping ? '子代理映射 开' : '子代理映射 关'

  return {
    name,
    adapterLabel: ADAPTER_LABELS[config.adapter],
    rows,
    footer: `兜底 ${routerIntensityLabel(config.fallbackIntensity)} · ${decompositionLabel} · ${mappingLabel}`,
    error: null,
  }
}
