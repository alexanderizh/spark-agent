/**
 * 本地 CLI Provider — 内置默认 provider。
 *
 * 与其他 provider 的差别：
 * - 无需配置 API Key、Endpoint、模型
 * - 直接复用宿主机本地 CLI 配置（OAuth credentials、环境变量等）
 * - keystore_ref 为空，不会落 Keychain
 * - UI 上标记为内置、不可删除、不可改 Key
 *
 * 类比：ccswitch 工具默认提供一个 "system" 配置项，选中后不改变任何环境，直接走系统装好的 claude CLI。
 */

import type { ProviderProfile } from './ipc/index.js'

/** 固定 id，用于 ensure 时幂等检测；不要改 */
export const LOCAL_CLAUDE_CLI_PROVIDER_ID = 'local-cli'
export const LOCAL_CODEX_CLI_PROVIDER_ID = 'local-codex-cli'

/** 列表/编辑面板里展示的名字 */
export const LOCAL_CLAUDE_CLI_PROVIDER_NAME = '本地 Claude CLI'
export const LOCAL_CODEX_CLI_PROVIDER_NAME = '本地 Codex CLI'

/**
 * 默认模型名 —— 仅作为 UI 上的占位/记账；运行时 SDK 在 useLocalConfig 模式下
 * 不会强制写 ANTHROPIC_MODEL，实际模型由宿主 claude CLI 决定。
 */
export const LOCAL_CLAUDE_CLI_DEFAULT_MODEL = 'claude cli'
export const LOCAL_CODEX_CLI_DEFAULT_MODEL = 'codex cli'

/** Backward-compatible aliases for the original Claude CLI built-in provider. */
export const LOCAL_CLI_PROVIDER_ID = LOCAL_CLAUDE_CLI_PROVIDER_ID
export const LOCAL_CLI_PROVIDER_NAME = LOCAL_CLAUDE_CLI_PROVIDER_NAME
export const LOCAL_CLI_DEFAULT_MODEL = LOCAL_CLAUDE_CLI_DEFAULT_MODEL

/** 判断一个 provider profile 是不是本地 CLI 这条内置项 */
export function isLocalCliProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | null | undefined,
): boolean {
  return profile != null && profile.id === LOCAL_CLI_PROVIDER_ID
}

export function isLocalClaudeCliProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | null | undefined,
): boolean {
  return profile != null && profile.id === LOCAL_CLAUDE_CLI_PROVIDER_ID
}

export function isLocalCodexCliProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | null | undefined,
): boolean {
  return profile != null && profile.id === LOCAL_CODEX_CLI_PROVIDER_ID
}

export function isBuiltInLocalCliProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | null | undefined,
): boolean {
  return isLocalClaudeCliProvider(profile) || isLocalCodexCliProvider(profile)
}
