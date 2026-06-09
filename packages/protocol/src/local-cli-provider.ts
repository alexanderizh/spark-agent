/**
 * 本地 CLI Provider — 内置默认 provider。
 *
 * 与其他 provider 的差别：
 * - 无需配置 API Key、Endpoint、模型
 * - SDK 直接复用宿主机的 Claude Code 本地配置（OAuth credentials、ANTHROPIC_* 环境变量等）
 * - keystore_ref 为空，不会落 Keychain
 * - UI 上标记为内置、不可删除、不可改 Key
 *
 * 类比：ccswitch 工具默认提供一个 "system" 配置项，选中后不改变任何环境，直接走系统装好的 claude CLI。
 */

import type { ProviderProfile } from './ipc/index.js'

/** 固定 id，用于 ensure 时幂等检测；不要改 */
export const LOCAL_CLI_PROVIDER_ID = 'local-cli'

/** 列表/编辑面板里展示的名字 */
export const LOCAL_CLI_PROVIDER_NAME = '本地 CLI'

/**
 * 默认模型名 —— 仅作为 UI 上的占位/记账；运行时 SDK 在 useLocalConfig 模式下
 * 不会强制写 ANTHROPIC_MODEL，实际模型由宿主 claude CLI 决定。
 */
export const LOCAL_CLI_DEFAULT_MODEL = 'claude-sonnet-4-5'

/** 判断一个 provider profile 是不是本地 CLI 这条内置项 */
export function isLocalCliProvider(
  profile: Pick<ProviderProfile, 'id'> | { id: string } | null | undefined,
): boolean {
  return profile != null && profile.id === LOCAL_CLI_PROVIDER_ID
}
