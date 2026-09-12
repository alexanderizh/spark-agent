import type {
  HookBindingV1,
  HookDefinitionV1,
  HookEffectiveBindingV1,
  HookEventEnvelopeV1,
  HookScopeKindV1,
} from '@spark/protocol'

/**
 * 作用域解析（设计方案 §9）：application/workspace/agent/session 四者是当前执行
 * 上下文的匹配集合，不是继承树；确定性优先级 session > agent > workspace > application。
 */

const SCOPE_PRIORITY: Record<HookScopeKindV1, number> = {
  session: 3,
  agent: 2,
  workspace: 1,
  application: 0,
}

export interface ResolveBindingsParams {
  envelope: HookEventEnvelopeV1
  definitions: HookDefinitionV1[]
  bindings: HookBindingV1[]
}

export interface ResolveBindingsResult {
  /** 每个命中的 Hook 一个最终生效条目（含停用/待复核原因）。 */
  items: HookEffectiveBindingV1[]
  /** 违反唯一约束的历史脏数据：该 Hook 拒绝解析并标记 ambiguous_binding。 */
  ambiguousHookIds: string[]
}

function matchScope(binding: HookBindingV1, envelope: HookEventEnvelopeV1): boolean {
  switch (binding.scopeKind) {
    case 'application':
      return binding.scopeId === ''
    case 'workspace':
      return envelope.primaryWorkspaceId != null && binding.scopeId === envelope.primaryWorkspaceId
    case 'agent':
      return envelope.agent != null && binding.scopeId === envelope.agent.id
    case 'session':
      return binding.scopeId === envelope.session.id
    default:
      return false
  }
}

export function resolveEffectiveBindings(params: ResolveBindingsParams): ResolveBindingsResult {
  const { envelope, definitions, bindings } = params
  const definitionsById = new Map<string, HookDefinitionV1>()
  for (const definition of definitions) {
    definitionsById.set(definition.id, definition)
  }

  // 同一 Hook 在同一作用域最多一个绑定；历史脏数据（唯一约束之外）必须显式拒绝。
  const seenPerScope = new Map<string, HookBindingV1[]>()
  for (const binding of bindings) {
    if (!matchScope(binding, envelope)) continue
    const key = `${binding.hookId}::${binding.scopeKind}`
    const list = seenPerScope.get(key) ?? []
    list.push(binding)
    seenPerScope.set(key, list)
  }

  const byHook = new Map<string, HookBindingV1[]>()
  const ambiguousHookIds: string[] = []
  for (const [key, list] of seenPerScope) {
    const hookId = key.split('::')[0] ?? ''
    if (list.length > 1) {
      if (!ambiguousHookIds.includes(hookId)) ambiguousHookIds.push(hookId)
      continue
    }
    const bucket = byHook.get(hookId) ?? []
    bucket.push(list[0]!) // eslint-disable-line @typescript-eslint/no-non-null-assertion
    byHook.set(hookId, bucket)
  }

  const items: HookEffectiveBindingV1[] = []
  for (const [hookId, matched] of byHook) {
    const definition = definitionsById.get(hookId)
    if (definition == null) continue
    const ordered = [...matched].sort(
      (a, b) => SCOPE_PRIORITY[b.scopeKind] - SCOPE_PRIORITY[a.scopeKind],
    )
    const finalBinding = ordered[0]! // eslint-disable-line @typescript-eslint/no-non-null-assertion
    items.push({
      hook: definition,
      binding: finalBinding,
      sourceScope: finalBinding.scopeKind,
      disabled: definition.enabled === false || finalBinding.enabled === false,
      ...(definition.enabled === false
        ? { disabledReason: 'definition_disabled' as const }
        : finalBinding.enabled === false
          ? { disabledReason: 'overridden_disabled' as const }
          : finalBinding.state === 'needs_review'
            ? { disabledReason: 'needs_review' as const }
            : {}),
      shadowedBy: ordered.slice(1).map((binding) => ({
        scopeKind: binding.scopeKind,
        bindingId: binding.id,
      })),
    })
  }

  items.sort((a, b) => (a.hook.name < b.hook.name ? -1 : a.hook.name > b.hook.name ? 1 : 0))
  return { items, ambiguousHookIds }
}

/**
 * 派发入口使用：返回未停用的生效绑定（含 needs_review）。
 * 授权状态（needs_review/trust_required）由 Worker 调用前最终复核判定并落
 * blocked 运行记录，保证授权缺失在审计里可见（设计方案 §10.2）。
 */
export function executableBindings(items: HookEffectiveBindingV1[]): HookEffectiveBindingV1[] {
  return items.filter((item) => !item.disabled && item.binding.state !== 'disabled')
}
