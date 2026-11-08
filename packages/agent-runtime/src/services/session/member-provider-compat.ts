import type { ProviderProfileRow } from '@spark/storage'
import { AUTO_ROUTER_PROVIDER_TYPE } from '@spark/protocol'

/** 判定渠道能否承接文本对话 turn，排除多媒体生成渠道与向量渠道。 */
export function isConversationalProviderRow(
  row: Pick<ProviderProfileRow, 'config_json'>,
): boolean {
  try {
    const config = JSON.parse(row.config_json) as {
      modelType?: unknown
      codexApiKind?: unknown
    }
    if (
      config.modelType === 'image' ||
      config.modelType === 'voice' ||
      config.modelType === 'video'
    )
      return false
    return config.codexApiKind !== 'embedding'
  } catch {
    return true
  }
}

/** 引擎 × 渠道协议兼容谓词，与执行前硬校验保持同一规则。 */
export function isEngineProviderCompatible(args: {
  adapterKind: string
  providerType: string
}): boolean {
  if (args.adapterKind === 'codex') return args.providerType !== 'anthropic'
  if (args.adapterKind === 'claude' || args.adapterKind === 'claude-sdk') {
    return args.providerType === 'anthropic'
  }
  return true
}

/** Validate the final engine/provider pair before dispatch. */
export function assertEngineProviderCompatible(args: {
  adapterKind: string
  providerType: string
  providerName: string
}): void {
  if (isEngineProviderCompatible(args)) return
  const isClaudeKindAdapter =
    args.adapterKind === 'claude' || args.adapterKind === 'claude-sdk'
  const teamModeHint =
    '；团队模式下可在 Agent 管理中为该 Agent 配置模型，或暂时退出团队模式后再切换'
  if (isClaudeKindAdapter) {
    throw new Error(
      `当前会话引擎为 Claude（仅支持 Anthropic 协议渠道），但渠道「${args.providerName}」是 OpenAI 系协议接口，二者不兼容。请在会话中切换引擎（Codex）或改用 Anthropic 协议渠道${teamModeHint}。`,
    )
  }
  throw new Error(
    `当前会话引擎为 Codex（仅支持 OpenAI 协议渠道），但渠道「${args.providerName}」是 Anthropic 协议接口，二者不兼容。请在会话中切换引擎（Claude）或改用 OpenAI 协议渠道${teamModeHint}。`,
  )
}

/** 为团队成员挑选启用的文本渠道，默认渠道优先。 */
export function pickMemberProviderFallbackRow(
  rows: readonly ProviderProfileRow[],
  adapterKind: string,
): ProviderProfileRow | null {
  const candidates = rows.filter(
    (row) =>
      row.enabled === 1 &&
      row.provider_type !== AUTO_ROUTER_PROVIDER_TYPE &&
      isConversationalProviderRow(row) &&
      isEngineProviderCompatible({ adapterKind, providerType: row.provider_type }),
  )
  return candidates.find((row) => row.is_default === 1) ?? candidates[0] ?? null
}

/** Resolve an already-known incompatible inherited provider, or report the actionable gap. */
export function resolveIncompatibleMemberInheritedProviderRow(args: {
  inheritedProvider: ProviderProfileRow
  rows: readonly ProviderProfileRow[]
  adapterKind: string
  memberName: string
}): ProviderProfileRow {
  const fallbackRow = pickMemberProviderFallbackRow(args.rows, args.adapterKind)
  if (fallbackRow != null) return fallbackRow

  throw new Error(
    `成员「${args.memberName}」的引擎（${args.adapterKind}）与继承的会话渠道「${args.inheritedProvider.name}」协议不兼容，且没有可用的兼容渠道。请在 Agent 管理中为该成员配置模型，或先在渠道管理中添加对应协议的渠道。`,
  )
}
