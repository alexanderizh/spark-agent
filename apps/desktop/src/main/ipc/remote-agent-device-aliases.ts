/**
 * 远程设备备注名（本机本地命名）。
 *
 * 设备展示名来自目标机自报（`hostname()`），两台同型号机器很容易撞名 ——
 * 「Windows 工作站」×2 时无法分辨谁是谁。备注名是**本机视角**的别名：
 *   - 只存在本机设置里（category `remote-agent` / key `device-aliases`），
 *     不上报、不同步、不影响目标机自己看到的名称；
 *   - 以 deviceId 为键，设备掉线/重连、改名都不丢；
 *   - 清空即删除该键，界面回落目标机自报名。
 */
import type { SettingsService } from '@spark/agent-runtime'
import {
  REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH,
  type RemoteAgentDeviceSummary,
} from '@spark/protocol'

const SETTINGS_CATEGORY = 'remote-agent'
const ALIAS_SETTINGS_KEY = 'device-aliases'

export type DeviceAliasMap = Record<string, string>

/**
 * 规范化用户输入：折叠空白、去首尾、按字符（非 UTF-16 码元）截断。
 * 空串 / 纯空白 / 非字符串一律视为「没有备注名」。
 */
export function normalizeDeviceAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return null
  const characters = [...collapsed]
  if (characters.length <= REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH) return collapsed
  return characters.slice(0, REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH).join('').trim()
}

/** 读取全部备注名；损坏/旧结构一律按空表处理，不让脏数据打断设备列表 */
export function readDeviceAliases(settings: SettingsService): DeviceAliasMap {
  const raw = settings.get(SETTINGS_CATEGORY, ALIAS_SETTINGS_KEY)
  if (raw == null || typeof raw !== 'object') return {}
  const aliases: DeviceAliasMap = {}
  for (const [deviceId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!deviceId) continue
    const normalized = normalizeDeviceAlias(value)
    if (normalized != null) aliases[deviceId] = normalized
  }
  return aliases
}

/** 写入 / 清除单台设备的备注名，返回写入后的全量映射 */
export function writeDeviceAlias(
  settings: SettingsService,
  deviceId: string,
  alias: string | null,
): DeviceAliasMap {
  const key = deviceId.trim()
  if (!key) throw new Error('deviceId 不能为空')
  const aliases = readDeviceAliases(settings)
  const normalized = normalizeDeviceAlias(alias)
  if (normalized == null) delete aliases[key]
  else aliases[key] = normalized
  settings.set(SETTINGS_CATEGORY, ALIAS_SETTINGS_KEY, aliases)
  return aliases
}

/** 把备注名合并进设备列表（不改入参；没有备注的设备不额外加字段） */
export function applyDeviceAliases(
  devices: readonly RemoteAgentDeviceSummary[],
  aliases: DeviceAliasMap,
): RemoteAgentDeviceSummary[] {
  return devices.map((device) => {
    const alias = aliases[device.deviceId]
    if (alias == null) return device
    return { ...device, alias }
  })
}
