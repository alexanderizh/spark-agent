/**
 * 远程设备的展示名口径。
 *
 * 设备自报名来自目标机的 `hostname()`，两台同型号机器很容易撞名；
 * 备注名只在本机生效（主进程存 settings），所以界面上：
 *   - 主名称恒为「备注名 or 自报名」；
 *   - 有备注名时，把自报名降级成副标题显示，避免用户忘了自己改的是哪台；
 *   - 离线设备照样能改名（deviceId 稳定，机器回来还是这个名字）。
 */
import type { RemoteAgentDeviceSummary } from '@spark/protocol'

type DeviceLike = Pick<RemoteAgentDeviceSummary, 'name'> & { alias?: string }

/** 主展示名：备注名优先，其次设备自报名，最后兜底「未命名设备」 */
export function deviceLabel(device: DeviceLike | null | undefined): string {
  if (device == null) return '未命名设备'
  const alias = device.alias?.trim()
  if (alias != null && alias.length > 0) return alias
  const name = device.name?.trim()
  return name != null && name.length > 0 ? name : '未命名设备'
}

/** 设备自报名（只在有备注名、且与备注不同的时候作为副标题展示） */
export function deviceRealName(device: DeviceLike | null | undefined): string | null {
  if (device == null) return null
  const alias = device.alias?.trim()
  if (alias == null || alias.length === 0) return null
  const name = device.name?.trim()
  if (name == null || name.length === 0) return null
  return name === alias ? null : name
}

/** 提示文案：把「备注名 / 自报名」一起说清楚，避免 hover 时信息丢失 */
export function deviceTooltip(device: DeviceLike | null | undefined): string {
  const label = deviceLabel(device)
  const real = deviceRealName(device)
  return real == null ? label : `${label}（原设备名：${real}）`
}
