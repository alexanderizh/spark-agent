import type {
  ManagedAgent,
  ProviderProfile,
  SessionReasoningEffort,
  WorkflowNode,
} from '@spark/protocol'

/**
 * 执行节点「渠道（Provider）/ 模型」联动规则。
 *
 * 运行时按 node.config 覆盖成员（Agent）运行时：providerProfileId 为空时回落成员渠道、
 * modelId 为空时回落成员模型（见 session-workflow-helpers.applyWorkflowNodeOverrides）。
 * 两个字段各自独立，所以检查器必须保证「渠道一旦确定，模型候选只来自该渠道」，
 * 否则会保存出「渠道 A + 渠道 B 的模型」这种运行时必然解析失败或静默换模型的组合。
 *
 * 从 WorkflowView.tsx 拆出的纯函数：渠道 → 模型候选的推导与切换渠道后的清空判定都
 * 可以脱离 React 单测，覆盖「显式渠道 / 继承绑定 Agent 渠道 / 渠道未知」三种输入形态。
 */

/** 渠道可选模型：默认模型 + 已启用模型，去重保序并丢弃空值。 */
export function providerModelIds(provider: ProviderProfile): string[] {
  const seen = new Set<string>()
  const modelIds: string[] = []
  for (const candidate of [provider.defaultModel, ...provider.modelIds]) {
    const modelId = typeof candidate === 'string' ? candidate.trim() : ''
    if (modelId === '' || seen.has(modelId)) continue
    seen.add(modelId)
    modelIds.push(modelId)
  }
  return modelIds
}

/** providerId → 该渠道可选模型；检查器只需算一次，切节点时复用。 */
export function buildProviderModelIndex(
  providers: readonly ProviderProfile[],
): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const provider of providers) index.set(provider.id, providerModelIds(provider))
  return index
}

/** 全部渠道模型并集：渠道未知（继承宿主 Agent）时作为兜底候选。 */
export function collectModelIds(index: ReadonlyMap<string, readonly string[]>): string[] {
  const seen = new Set<string>()
  const modelIds: string[] = []
  for (const models of index.values()) {
    for (const modelId of models) {
      if (seen.has(modelId)) continue
      seen.add(modelId)
      modelIds.push(modelId)
    }
  }
  return modelIds
}

/**
 * 节点实际生效的渠道：显式渠道 > 绑定 Agent 的渠道 > 未知（空串）。
 * 未知代表运行时用宿主 Agent（当前会话）的渠道，编辑器无从查证，不做臆测。
 */
export function resolveNodeProviderId(
  configProviderProfileId: unknown,
  boundAgentProviderId?: string | null,
): string {
  const explicit = typeof configProviderProfileId === 'string' ? configProviderProfileId.trim() : ''
  if (explicit !== '') return explicit
  return typeof boundAgentProviderId === 'string' ? boundAgentProviderId.trim() : ''
}

export type NodeModelScope = 'provider' | 'all'

export interface NodeModelSelectState {
  /** provider = 候选已按渠道收窄；all = 渠道未知，候选为全渠道并集。 */
  scope: NodeModelScope
  /** 生效渠道 id；渠道未知时为空串。 */
  providerId: string
  /** 模型下拉候选（不含「继承 Agent」项）。 */
  modelIds: string[]
  /**
   * 已保存但不在候选内的模型（旧数据/导入包/手工改过渠道）。
   * 必须显式展示：直接丢掉会让下拉看着「已按渠道联动」，实际却跑在别的渠道模型上。
   */
  staleModelId: string | null
}

export function resolveNodeModelSelectState(input: {
  providerModelIndex: ReadonlyMap<string, readonly string[]>
  allModelIds: readonly string[]
  configProviderProfileId: unknown
  boundAgentProviderId?: string | null
  currentModelId: unknown
}): NodeModelSelectState {
  const providerId = resolveNodeProviderId(
    input.configProviderProfileId,
    input.boundAgentProviderId,
  )
  // 渠道为空或渠道已删除：无法确定归属，回落到全量候选。
  const scoped = providerId === '' ? undefined : input.providerModelIndex.get(providerId)
  if (scoped == null) {
    return { scope: 'all', providerId, modelIds: [...input.allModelIds], staleModelId: null }
  }
  const currentModelId = typeof input.currentModelId === 'string' ? input.currentModelId.trim() : ''
  return {
    scope: 'provider',
    providerId,
    modelIds: [...scoped],
    staleModelId: currentModelId !== '' && !scoped.includes(currentModelId) ? currentModelId : null,
  }
}

/**
 * 渠道变更后是否需要清空模型（清空 = 回落继承 Agent）。
 * 渠道未知时不臆测，保留用户已选模型。
 */
export function shouldResetModelForProvider(input: {
  providerModelIndex: ReadonlyMap<string, readonly string[]>
  nextProviderId: string
  currentModelId: unknown
}): boolean {
  const currentModelId = typeof input.currentModelId === 'string' ? input.currentModelId.trim() : ''
  if (currentModelId === '') return false
  const scoped =
    input.nextProviderId === '' ? undefined : input.providerModelIndex.get(input.nextProviderId)
  if (scoped == null) return false
  return !scoped.includes(currentModelId)
}

/** 渠道下拉变更的 config patch：同步清空不属于新渠道的模型。 */
export function buildProviderPatch(input: {
  providerModelIndex: ReadonlyMap<string, readonly string[]>
  configModelId: unknown
  nextProviderId: string
}): WorkflowNode['config'] {
  const patch: WorkflowNode['config'] = {
    providerProfileId: input.nextProviderId === '' ? null : input.nextProviderId,
  }
  if (
    shouldResetModelForProvider({
      providerModelIndex: input.providerModelIndex,
      nextProviderId: input.nextProviderId,
      currentModelId: input.configModelId,
    })
  ) {
    patch.modelId = null
  }
  return patch
}

/**
 * 绑定 Agent 变更的 config patch：渠道仍继承 Agent 时继承来源一起变，
 * 模型不再属于新渠道就同步清空，避免出现「继承渠道 B + 渠道 A 的模型」。
 */
export function buildAgentBindingPatch(input: {
  agents: readonly Pick<ManagedAgent, 'id' | 'providerProfileId'>[]
  providerModelIndex: ReadonlyMap<string, readonly string[]>
  configProviderProfileId: unknown
  configModelId: unknown
  nextAgentId: string
}): WorkflowNode['config'] {
  const patch: WorkflowNode['config'] = {
    agentId: input.nextAgentId === '' ? null : input.nextAgentId,
  }
  const nextAgentProviderId =
    input.agents.find((agent) => agent.id === input.nextAgentId)?.providerProfileId ?? null
  const nextProviderId = resolveNodeProviderId(input.configProviderProfileId, nextAgentProviderId)
  if (
    shouldResetModelForProvider({
      providerModelIndex: input.providerModelIndex,
      nextProviderId,
      currentModelId: input.configModelId,
    })
  ) {
    patch.modelId = null
  }
  return patch
}

// ─── 推理强度（reasoning effort）───────────────────────────────────────────

export interface NodeReasoningEffortOption {
  value: SessionReasoningEffort
  label: string
  description: string
}

/**
 * 推理强度档位，文案与会话输入栏（ComposerV2.getReasoningOptions）保持一致。
 * 推理强度与渠道/模型无联动关系：它是独立覆盖，换渠道/换 Agent 都不清理。
 */
export const NODE_REASONING_EFFORT_OPTIONS: readonly NodeReasoningEffortOption[] = [
  { value: 'minimal', label: '极低', description: '最低推理强度，优先缩短响应时间' },
  { value: 'low', label: '低', description: '减少推理开销，适合明确而简单的任务' },
  { value: 'medium', label: '平衡', description: '速度与质量均衡，适合大多数日常任务' },
  { value: 'high', label: '高', description: '加强分析，适合有一定复杂度的任务' },
  { value: 'xhigh', label: '超高', description: '进行更深入的推理，响应时间会更长' },
  { value: 'max', label: 'Max', description: '使用最高推理强度处理最复杂的任务' },
]

/**
 * 节点已保存的推理强度 → 有效枚举值；空/未配置 → null（= 继承 Agent）。
 * 无效值同样返回 null，但调用方要用 {@link rawNodeReasoningEffort} 区分
 * 「未配置」与「无效存量值」（schema 刻意用 string 不拦，导入包/手写 JSON 可带入）。
 */
export function normalizeNodeReasoningEffort(value: unknown): SessionReasoningEffort | null {
  for (const option of NODE_REASONING_EFFORT_OPTIONS) {
    if (option.value === value) return option.value
  }
  return null
}

/** 节点已保存的原始字符串：空串 = 未配置；非空但 normalize 为 null = 无效存量值。 */
export function rawNodeReasoningEffort(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function nodeReasoningEffortDescription(effort: SessionReasoningEffort): string {
  return (
    NODE_REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.description ?? effort
  )
}

export function nodeReasoningEffortLabel(effort: SessionReasoningEffort): string {
  return NODE_REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ?? effort
}

/**
 * 推理强度下拉变更的 config patch。
 * 「继承 Agent」存 undefined 而非 null：config schema（workflow-graph-schema）里
 * reasoningEffort 是 z.string().optional()，null 会被 strict 校验拒绝；undefined
 * 经 IPC/DB 的 JSON 序列化后 key 直接消失，等价于「未配置」。
 */
export function buildReasoningEffortPatch(next: string): WorkflowNode['config'] {
  const trimmed = next.trim()
  const effort = normalizeNodeReasoningEffort(trimmed)
  return { reasoningEffort: effort == null ? undefined : effort }
}
