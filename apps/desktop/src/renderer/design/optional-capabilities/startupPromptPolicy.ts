import type { OptionalCapabilityItem, OptionalCapabilitySnapshot } from '@spark/protocol'

/** 缺失/损坏组件的重复提醒冷却；更新类组件不走冷却，只按目标版本提醒。 */
export const OPTIONAL_CAPABILITY_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000

export interface OptionalCapabilityPromptPreference {
  manifestUpdatedAt: string | null
  dismissedAt: number
  disabled?: boolean
  /**
   * capabilityId → 上次提醒时该组件尚未安装/升级到的目标版本。
   * 更新类组件据此实现「下次不再提醒，除非下个版本更新」。
   */
  dismissedTargets?: Record<string, string>
}

/**
 * 值得在启动时提醒的组件：缺失、损坏，或有更新。
 * 更新类组件（例如故意不自动更新的 Codex runtime）此前不会进入启动提醒，
 * 用户只能自己翻「设置 → 完整性」才发现有新版本。
 */
export function isPromptWorthyCapability(item: OptionalCapabilityItem): boolean {
  if (item.targetVersion == null || item.downloadSize <= 0) return false
  return item.state === 'missing' || item.state === 'damaged' || item.state === 'update_available'
}

export function promptWorthyCapabilities(
  snapshot: OptionalCapabilitySnapshot,
): OptionalCapabilityItem[] {
  return snapshot.capabilities.filter(isPromptWorthyCapability)
}

export function shouldShowCapabilityPrompt(
  snapshot: OptionalCapabilitySnapshot,
  preference: OptionalCapabilityPromptPreference | null,
  now = Date.now(),
): boolean {
  if (!snapshot.remoteAvailable || !snapshot.manifestUpdatedAt) return false
  const pending = promptWorthyCapabilities(snapshot)
  if (pending.length === 0) return false
  if (preference == null) return true

  const dismissedTargets = preference.dismissedTargets ?? {}
  const hasUnannouncedTarget = pending.some(
    (item) => dismissedTargets[item.id] !== item.targetVersion,
  )

  // 「不再在启动时提醒」按版本静音，而不是永久静音：核心组件出现新目标版本时
  // 仍然提醒一次，否则用户会在不知情的情况下长期停在旧运行时上。
  if (preference.disabled) return hasUnannouncedTarget

  // 更新提醒：只在该目标版本还没提醒过时提示，下个版本才会再次提醒。
  const hasUnannouncedUpdate = pending.some(
    (item) => item.state === 'update_available' && dismissedTargets[item.id] !== item.targetVersion,
  )
  if (hasUnannouncedUpdate) return true

  // 缺失/损坏必须安装，沿用既有「manifest 变化或冷却到期」的提醒节奏。
  const hasMissingInstall = pending.some((item) => item.state !== 'update_available')
  if (!hasMissingInstall) return false
  if (preference.manifestUpdatedAt !== snapshot.manifestUpdatedAt) return true
  return now - preference.dismissedAt >= OPTIONAL_CAPABILITY_PROMPT_COOLDOWN_MS
}
