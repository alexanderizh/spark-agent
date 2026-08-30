/**
 * 资产 storageKey 归一 helper（步骤模式设计文档 §4.4 缺陷 3）。
 *
 * 历史语义不统一：`CanvasAsset.storageKey` 可能是项目目录内的绝对路径，也可能被
 * 调用方写入其它形态。P1 起统一为：
 *  - 新写入：位于 `project.rootPath` 下的文件一律存**相对 key**（posix 分隔符、无前导斜杠）；
 *  - 项目目录外的文件（全局画布媒体目录 / userData 产物 / 临时目录）无法相对化，
 *    保持原绝对路径；
 *  - 读取端：`resolveStorageKeyToAbsolutePath` 同时兼容绝对路径（历史数据）与
 *    相对 key（新数据），消费方（源文件清理 / 本地 ffmpeg 链路）统一经它取绝对路径。
 */

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/

/** 判断 storageKey / 磁盘路径是否为绝对路径（POSIX 与 Windows 两种形态） */
export function isAbsoluteStoragePath(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  return value.startsWith('/') || value.startsWith('\\') || WINDOWS_DRIVE_PATTERN.test(value)
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/[/\\]+$/, '')
}

function isPathInside(rootPosix: string, candidatePosix: string): boolean {
  if (candidatePosix === rootPosix) return false
  if (candidatePosix.startsWith(`${rootPosix}/`)) return true
  // Windows 盘符大小写不敏感（C:\ 与 c:\ 指向同一目录）
  if (WINDOWS_DRIVE_PATTERN.test(rootPosix)) {
    return candidatePosix.toLowerCase().startsWith(`${rootPosix.toLowerCase()}/`)
  }
  return false
}

/**
 * 把磁盘绝对路径归一为应写入 `asset.storageKey` 的存储 key。
 *
 * - 路径位于 `projectRootPath` 下 → 返回 posix 相对 key（如 `assets/images/a.png`）；
 * - 无 projectRootPath、路径为相对值或不在项目目录内 → 原样返回。
 */
export function toRelativeStorageKey(
  filePath: string,
  projectRootPath: string | null | undefined,
): string {
  const value = filePath.trim()
  if (!value || !projectRootPath?.trim()) return value
  if (!isAbsoluteStoragePath(value)) return value
  const rootPosix = stripTrailingSlashes(toPosix(projectRootPath.trim()))
  const valuePosix = toPosix(value)
  if (!rootPosix || !isPathInside(rootPosix, valuePosix)) return value
  return valuePosix.slice(rootPosix.length + 1)
}

/**
 * 读取端兼容层：把 storageKey 解析回可被主进程 / ffmpeg 使用的绝对路径。
 *
 * - 绝对路径（历史数据）→ 原样返回；
 * - 相对 key 且有 projectRootPath → 拼接项目根目录；
 * - 其余（相对 key 但无根目录可拼）→ 原样返回，由调用方按「无法定位」处理。
 */
export function resolveStorageKeyToAbsolutePath(
  storageKey: string | null | undefined,
  projectRootPath: string | null | undefined,
): string | null {
  const value = typeof storageKey === 'string' ? storageKey.trim() : ''
  if (!value) return null
  if (isAbsoluteStoragePath(value)) return value
  const root = projectRootPath?.trim()
  if (!root) return null
  // 根目录统一为 posix 分隔符再拼接；Node fs 在 Windows 上同样接受 / 分隔
  return `${stripTrailingSlashes(toPosix(root))}/${toPosix(value)}`
}
