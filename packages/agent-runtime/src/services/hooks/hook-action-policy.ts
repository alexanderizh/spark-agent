import type { HookBindingV1, HookDefinitionV1, HookErrorCodeV1 } from '@spark/protocol'

/**
 * Hook 动作信任与风险策略（设计方案 §10）。
 *
 * - 观察型 MVP 不弹审批：授权缺失/工具停用/版本变化/风险提高一律记 blocked 并跳过，
 *   不阻塞会话。
 * - destructive 禁止；high-write 默认不开放（产品策略可通过 allowHighWrite 打开）。
 */

export interface ToolGovernanceInfo {
  risk: 'read' | 'low-write' | 'high-write' | 'destructive'
  effect: string
  enabled: boolean
  idempotency: 'safe' | 'keyed' | 'unsafe'
  version?: string
}

export interface PolicyCheckContext {
  definition: HookDefinitionV1
  binding: HookBindingV1
  tool?: ToolGovernanceInfo | null
  /** 产品策略开关：是否允许 high-write（默认 false）。 */
  allowHighWrite?: boolean
}

export interface PolicyCheckResult {
  allowed: boolean
  errorCode?: HookErrorCodeV1
  message?: string
}

/** Worker 领取后、真正调用动作前的最终复核（强制兜底，设计方案 §10.1）。 */
export function checkExecutionPolicy(context: PolicyCheckContext): PolicyCheckResult {
  const { definition, binding } = context

  if (definition.enabled === false) {
    return { allowed: false, errorCode: 'binding_disabled', message: 'Hook 定义已停用' }
  }
  if (binding.enabled === false || binding.state === 'disabled') {
    return { allowed: false, errorCode: 'binding_disabled', message: 'Hook 绑定已停用' }
  }
  if (binding.state === 'needs_review') {
    return {
      allowed: false,
      errorCode: 'trust_required',
      message: '定义或工具执行属性变化后授权失效，需重新确认',
    }
  }
  if (binding.trustedExecutionHash !== definition.executionHash) {
    return {
      allowed: false,
      errorCode: 'trust_required',
      message: '绑定授权哈希与当前定义执行哈希不一致',
    }
  }

  if (definition.action.type === 'tool.invoke') {
    const tool = context.tool
    if (tool == null) {
      return {
        allowed: false,
        errorCode: 'tool_not_found',
        message: '统一工具目录中找不到目标工具',
      }
    }
    if (tool.enabled === false) {
      return { allowed: false, errorCode: 'tool_disabled', message: '目标工具已停用' }
    }
    const targetVersion = definition.action.target.version
    if (targetVersion != null && tool.version != null && tool.version !== targetVersion) {
      return {
        allowed: false,
        errorCode: 'tool_version_changed',
        message: `工具版本漂移：授权时 ${targetVersion}，当前 ${tool.version}`,
      }
    }
    if (tool.risk === 'destructive') {
      return {
        allowed: false,
        errorCode: 'policy_blocked',
        message: '观察型 Hook 禁止 destructive 工具',
      }
    }
    if (tool.risk === 'high-write' && context.allowHighWrite !== true) {
      return {
        allowed: false,
        errorCode: 'policy_blocked',
        message: 'high-write 工具默认不开放给 Hook 自动调用',
      }
    }
  }

  return { allowed: true }
}

/**
 * 重试分类（设计方案 §12.2）：认证失败、Schema 失败、权限变化、工具不存在和
 * 确定性 4xx 不自动重试。
 */
export function isTransientErrorCode(errorCode: HookErrorCodeV1): boolean {
  return errorCode === 'transient_failure' || errorCode === 'timeout'
}
