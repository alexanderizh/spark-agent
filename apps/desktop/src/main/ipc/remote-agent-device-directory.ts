/**
 * 远程设备目录（本机持久化的「见过哪些设备」）。
 *
 * relay 只推送在线设备，机器一掉线就从设备列表里消失 —— 界面和 agent 都
 * 查不到「之前连过的那台离线机器」。本模块在 relay 每次推送设备列表时把
 * 最新状态写进本机设置（category `remote-agent` / key `device-directory`），
 * 设备列表的统一出口改为「relay 在线列表 ∪ 本地历史」合并：
 *   - 在线设备以 relay 为准（在线状态、版本、lastSeenAt 都覆盖历史记录）；
 *   - 仅存在于历史里的设备一律 `online:false`，保留最后一次见到的名称/版本；
 *   - 排序：在线在前，其余按 lastSeenAt 新→旧（都没有则按名称稳定排序）；
 *   - 容量封顶，超出按 updatedAt 淘汰最旧，防止无限膨胀。
 *
 * 与 {@link ./remote-agent-device-aliases} 一样是本机视角的纯数据：不上报、
 * 不同步，deviceId 为键，机器离线多久都不丢。列表出口统一走
 * {@link buildDeviceListResponse}（历史合并 + 备注名合并），界面 IPC 与
 * agent 的 `devices_list` 工具共用同一份数据口径。
 */
import type { SettingsService } from '@spark/agent-runtime'
import type { RemoteAgentDeviceListResponse, RemoteAgentDeviceSummary } from '@spark/protocol'
import {
  applyDeviceAliases,
  readDeviceAliases,
  type DeviceAliasMap,
} from './remote-agent-device-aliases.js'

const SETTINGS_CATEGORY = 'remote-agent'
const DIRECTORY_SETTINGS_KEY = 'device-directory'

/** 目录容量上限：个人账号场景远用不满，仅防脏数据/换账号导致无限膨胀 */
export const REMOTE_AGENT_DEVICE_DIRECTORY_MAX = 50

/** 单台设备的最后已知状态（落盘结构） */
export interface DeviceDirectoryEntry {
  /** 设备自报名（最后一次见到时的 `hostname()`） */
  name: string
  version: string | null
  /** 目标机最后一次活跃时间（relay 报告值；缺失时记本机见到它的时刻） */
  lastSeenAt: string | null
  /** 本机最后一次从 relay 见到这台设备的时刻（仅用于容量淘汰） */
  updatedAt: string
}

export type DeviceDirectoryMap = Record<string, DeviceDirectoryEntry>

function isFiniteDateString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * 读取目录；损坏/旧结构一律按空表处理，不让脏数据打断设备列表。
 * 与别名不同，目录条目容忍 `lastSeenAt/version` 缺失（旧版本写入的结构）。
 */
export function readDeviceDirectory(settings: SettingsService): DeviceDirectoryMap {
  const raw = settings.get(SETTINGS_CATEGORY, DIRECTORY_SETTINGS_KEY)
  if (raw == null || typeof raw !== 'object') return {}
  const directory: DeviceDirectoryMap = {}
  for (const [deviceId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!deviceId || value == null || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    if (typeof entry.name !== 'string' || entry.name.length === 0) continue
    let updatedAt = new Date(0).toISOString()
    if (isFiniteDateString(entry.updatedAt)) updatedAt = entry.updatedAt
    else if (isFiniteDateString(entry.lastSeenAt)) updatedAt = entry.lastSeenAt
    directory[deviceId] = {
      name: entry.name,
      version: typeof entry.version === 'string' ? entry.version : null,
      lastSeenAt: isFiniteDateString(entry.lastSeenAt) ? entry.lastSeenAt : null,
      updatedAt,
    }
  }
  return directory
}

/**
 * 把 relay 刚推送的设备快照合并进目录（整体写回一次 settings）。
 * 输入就是 relay 的原始列表（可能含本机），写入不排除本机 —— 本机也是
 * 账号下的设备，只是出口处再过滤。单台写入失败不应拖垮整次更新，
 * 因此在最外层由调用方兜底（见 registerRemoteAgentIpc）。
 */
export function upsertDeviceDirectory(
  settings: SettingsService,
  devices: readonly RemoteAgentDeviceSummary[],
): DeviceDirectoryMap {
  const directory = readDeviceDirectory(settings)
  const now = new Date().toISOString()
  for (const device of devices) {
    if (typeof device.deviceId !== 'string' || device.deviceId.length === 0) continue
    const existing = directory[device.deviceId]
    directory[device.deviceId] = {
      name:
        typeof device.name === 'string' && device.name.length > 0
          ? device.name
          : (existing?.name ?? '桌面端'),
      version: typeof device.version === 'string' ? device.version : (existing?.version ?? null),
      lastSeenAt: isFiniteDateString(device.lastSeenAt)
        ? device.lastSeenAt
        : device.online
          ? now
          : (existing?.lastSeenAt ?? null),
      updatedAt: now,
    }
  }
  // 容量封顶：按 updatedAt 新→旧保留前 N 台
  const entries = Object.entries(directory).sort((a, b) =>
    (b[1]?.updatedAt ?? '').localeCompare(a[1]?.updatedAt ?? ''),
  )
  const pruned = entries.slice(0, REMOTE_AGENT_DEVICE_DIRECTORY_MAX)
  const next: DeviceDirectoryMap = {}
  for (const [deviceId, entry] of pruned) {
    if (entry != null) next[deviceId] = entry
  }
  settings.set(SETTINGS_CATEGORY, DIRECTORY_SETTINGS_KEY, next)
  return next
}

function lastSeenSortKey(device: RemoteAgentDeviceSummary): string {
  return isFiniteDateString(device.lastSeenAt) ? device.lastSeenAt : ''
}

/**
 * 合并「relay 在线列表 ∪ 本地历史目录」：
 *   - 在线设备原样保留（relay 是在线状态的唯一权威）；
 *   - 仅存于历史中的设备补成 `online:false`；
 *   - 排除本机；排序：在线在前，其余 lastSeenAt 新→旧。
 * 不读取、不合并备注名 —— 那是出口层（{@link buildDeviceListResponse}）的事。
 */
export function mergeKnownDevices(
  liveDevices: readonly RemoteAgentDeviceSummary[],
  directory: DeviceDirectoryMap,
  localDeviceId: string | null,
): RemoteAgentDeviceSummary[] {
  const merged = new Map<string, RemoteAgentDeviceSummary>()
  for (const device of liveDevices) {
    if (localDeviceId != null && device.deviceId === localDeviceId) continue
    merged.set(device.deviceId, { ...device })
  }
  for (const [deviceId, entry] of Object.entries(directory)) {
    if (merged.has(deviceId)) continue
    if (localDeviceId != null && deviceId === localDeviceId) continue
    merged.set(deviceId, {
      deviceId,
      name: entry.name,
      version: entry.version,
      online: false,
      lastSeenAt: entry.lastSeenAt,
    })
  }
  return [...merged.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    const bySeen = lastSeenSortKey(b).localeCompare(lastSeenSortKey(a))
    if (bySeen !== 0) return bySeen
    const byName = a.name.localeCompare(b.name)
    return byName !== 0 ? byName : a.deviceId.localeCompare(b.deviceId)
  })
}

/**
 * 设备列表的统一出口：历史合并 + 备注名合并。界面 IPC
 * （`remote-agent:relay:list-devices` / stream 事件）与 agent 的
 * `devices_list` 工具都从这里拿数据，保证两边口径一致。
 * settings 读取失败向上抛，由调用方按各自场景兜底降级。
 */
export function buildDeviceListResponse(
  settings: SettingsService,
  liveDevices: readonly RemoteAgentDeviceSummary[],
  getLocalDeviceId: () => string,
): RemoteAgentDeviceListResponse {
  let localDeviceId: string | null
  try {
    localDeviceId = getLocalDeviceId()
  } catch {
    localDeviceId = null
  }
  const directory = readDeviceDirectory(settings)
  const merged = mergeKnownDevices(liveDevices, directory, localDeviceId)
  let aliases: DeviceAliasMap
  try {
    aliases = readDeviceAliases(settings)
  } catch {
    aliases = {}
  }
  return { devices: applyDeviceAliases(merged, aliases) }
}
