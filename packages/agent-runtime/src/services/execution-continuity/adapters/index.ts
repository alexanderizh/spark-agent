/**
 * @module execution-continuity-adapters
 *
 * Runtime Adapter 声明（方案 §5.1/§14）— 屏蔽 Claude / Codex / Spark Engine /
 * Workflow 等差异，声明引擎能保存和恢复到什么粒度。
 *
 * Phase 1：声明 + 原生 resume 判定；各 Adapter 的深度接入按 Phase 3 路线扩展。
 */

import type { RuntimeAdapterDeclaration } from '@spark/protocol'

export const ADAPTER_DECLARATIONS: Record<string, RuntimeAdapterDeclaration> = {
  claude: {
    kind: 'claude',
    capabilityCeiling: 2,
    // Claude SDK 原生 resume（sessionId 续接）可验证 → L2 基础。
    supportsNativeResume: true,
  },
  codex: {
    kind: 'codex',
    capabilityCeiling: 2,
    // Codex 原生 thread 续接（rollout 文件 + thread id）。
    supportsNativeResume: true,
  },
  'spark-engine': {
    kind: 'spark-engine',
    capabilityCeiling: 3,
    // Spark Engine ledger 提供精确事件水位 + 引擎内 write-ahead（tool.call
    // 完整参数先入账本、tool.intent 在派发前、tool.result 收口后），Host 侧
    // openSession 重放后按三态证据精确调和 Effect（confirmed/unknown/未派发），
    // 且引擎恢复时孤儿 intent 的非幂等工具从不自动重放 → L3 成立。
    supportsNativeResume: true,
  },
  workflow: {
    kind: 'workflow',
    // workflow_runs 已有节点快照；Phase 3A 冻结 graph version 后升至 L2。
    capabilityCeiling: 2,
    supportsNativeResume: true,
  },
  goal: {
    kind: 'goal',
    // Goal progress_log 提供迭代水位；Phase 3B 接入。
    capabilityCeiling: 1,
    supportsNativeResume: false,
  },
  'media-task': {
    kind: 'media-task',
    // provider task id 只轮询 → 副作用不重复 = L3 样板。
    capabilityCeiling: 3,
    supportsNativeResume: false,
  },
  'subapp-job': {
    kind: 'subapp-job',
    capabilityCeiling: 1,
    supportsNativeResume: false,
  },
}

/**
 * 判定 Run 的 runtime 是否可原生续接。
 * 优先看 runtime binding 里的原生锚点（nativeSessionId/nativeThreadId/ledger），
 * 其次回落 Adapter 声明。
 */
export function supportsNativeResumeFor(
  runtimeKind: string,
  runtimeBindingJson: unknown,
): boolean {
  const binding =
    runtimeBindingJson != null && typeof runtimeBindingJson === 'object'
      ? (runtimeBindingJson as Record<string, unknown>)
      : null
  const hasNativeAnchor =
    binding != null &&
    (typeof binding.nativeSessionId === 'string' ||
      typeof binding.nativeThreadId === 'string' ||
      binding.hasLedger === true)
  const declaration = ADAPTER_DECLARATIONS[runtimeKind]
  if (declaration == null) return hasNativeAnchor === true
  return declaration.supportsNativeResume || hasNativeAnchor === true
}
