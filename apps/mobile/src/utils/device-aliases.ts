/**
 * 设备备注名（只存本机）。
 *
 * 设备自报名经常重名（两台都叫「Windows 工作站」），只靠 deviceId 分不清是哪台。
 * 桌面端的备注名存在桌面本机 settings（category `remote-agent`，key `device-aliases`），
 * 小程序是独立客户端、只经中继拿设备发现数据，读不到那份配置，因此在 wx.storage
 * 维护自己的 deviceId → 备注名映射：
 *   - 只影响本机展示，不写到目标机、不参与设备发现、不同步云端；
 *   - 备注名留空 = 恢复自报名；
 *   - 与桌面端同一套规则：trim 后按**字符**（码点）截断，脏数据整条忽略而不抛错。
 */

import { getItem, setItem, StorageKeys } from './storage'

export const DEVICE_ALIAS_MAX_LENGTH = 40

/** deviceId → 备注名（值恒为非空字符串，空备注名的项不入表） */
export type DeviceAliasMap = Record<string, string>

/** trim + 按字符截断；空串/纯空白 → null（表示「没有备注名」） */
export function normalizeDeviceAlias(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Array.from 按码点切分，避免把 emoji / 代理对截成半个字符
  const chars = Array.from(trimmed)
  return chars.length > DEVICE_ALIAS_MAX_LENGTH
    ? chars.slice(0, DEVICE_ALIAS_MAX_LENGTH).join('')
    : trimmed
}

/**
 * 读取全部备注名。
 * wx.getStorageSync 对不存在的键返回 ''、对历史脏值可能返回任意类型，
 * 这里整条校验：非对象/非字符串的项直接丢弃，不阻断页面渲染。
 */
export function readDeviceAliases(): DeviceAliasMap {
  const stored: unknown = getItem<unknown>(StorageKeys.deviceAliases)
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const result: DeviceAliasMap = {}
  for (const [deviceId, value] of Object.entries(stored as Record<string, unknown>)) {
    if (deviceId === '' || typeof value !== 'string') continue
    const alias = normalizeDeviceAlias(value)
    if (alias != null) result[deviceId] = alias
  }
  return result
}

/** 单台设备的备注名；没有则 null */
export function getDeviceAlias(deviceId: string, aliases?: DeviceAliasMap): string | null {
  if (deviceId === '') return null
  const map = aliases ?? readDeviceAliases()
  return map[deviceId] ?? null
}

/**
 * 写入/清除单台设备的备注名，返回写入后的整张表。
 * alias 传 null 或纯空白 = 删除该条（恢复自报名）。
 */
export function writeDeviceAlias(deviceId: string, alias: string | null): DeviceAliasMap {
  const next = readDeviceAliases()
  const normalized = normalizeDeviceAlias(alias)
  if (normalized == null) delete next[deviceId]
  else if (deviceId !== '') next[deviceId] = normalized
  setItem(StorageKeys.deviceAliases, next)
  return next
}

/** 展示名：备注名优先，否则回落自报名，再兜底「桌面端」 */
export function deviceDisplayName(
  deviceId: string,
  fallbackName: string,
  aliases?: DeviceAliasMap,
): string {
  const alias = getDeviceAlias(deviceId, aliases)
  if (alias != null) return alias
  return fallbackName.trim() === '' ? '桌面端' : fallbackName
}

/**
 * 自报名（仅当与备注名不同才返回，用于副标题/菜单小字）。
 * 没有备注名时返回 null——此时展示名本身就是自报名，不需要重复一行。
 */
export function deviceRealName(
  deviceId: string,
  fallbackName: string,
  aliases?: DeviceAliasMap,
): string | null {
  const alias = getDeviceAlias(deviceId, aliases)
  if (alias == null) return null
  const real = fallbackName.trim()
  if (real === '' || real === alias) return null
  return real
}
