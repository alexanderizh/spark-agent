import type { OptionalCapabilityId, OptionalCapabilityItem } from '@spark/protocol'

/**
 * 这些能力在「设置 → 完整性」页已有专属管理卡片（核心依赖 / FFmpeg / 语音输入），
 * 不进入「可选功能组件」列表与批量安装弹窗，避免同屏重复展示和双通道状态不一致。
 * 启动时的缺失/更新提醒不受此影响，仍覆盖全部能力。
 */
const DEDICATED_INTEGRITY_CARD_CAPABILITY_IDS: ReadonlySet<OptionalCapabilityId> = new Set([
  'codex-runtime',
  'ffmpeg',
  'voice-pack',
])

export function isDedicatedIntegrityCardCapability(id: OptionalCapabilityId): boolean {
  return DEDICATED_INTEGRITY_CARD_CAPABILITY_IDS.has(id)
}

/** 「可选功能组件」区域展示的能力列表：过滤掉由完整性页专属卡片管理的能力。 */
export function settingsCardCapabilities(
  items: readonly OptionalCapabilityItem[],
): OptionalCapabilityItem[] {
  return items.filter((item) => !isDedicatedIntegrityCardCapability(item.id))
}
