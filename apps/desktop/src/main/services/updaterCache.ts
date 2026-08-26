/**
 * 更新器缓存目录清理。
 *
 * UpdateService 按版本把完整安装包下载到 `<userData>/<updaterCacheDirName>/<version>/`，
 * 历史行为是只增不删，缓存会随版本线性膨胀（实测 38 个版本 ≈ 11G）。
 * 这里保留最近 keep 个版本目录（覆盖"当前版本 + 最近一次待安装下载"），
 * 其余在应用启动时回收。
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 缓存中最多保留的版本目录数：当前运行版本 + 最近一次待安装的下载 */
export const MAX_CACHED_RELEASE_DIRS = 2

export interface PrunedUpdaterCacheEntry {
  directory: string
  mtimeMs: number
}

/**
 * 删除 cacheRoot 下超出保留数量的版本目录，按目录 mtime 从新到旧保留前 keep 个。
 * 目录不匹配版本形态（不以数字开头）时跳过，避免误删未知文件。
 *
 * @returns 被删除的目录列表；目录不存在时返回空列表且不报错。
 */
export async function pruneUpdaterCacheDirs(
  cacheRoot: string,
  keep: number = MAX_CACHED_RELEASE_DIRS,
): Promise<PrunedUpdaterCacheEntry[]> {
  if (keep < 1) return []
  let entries
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const versionDirs: PrunedUpdaterCacheEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d/.test(entry.name)) continue
    const directory = join(cacheRoot, entry.name)
    try {
      const info = await stat(directory)
      versionDirs.push({ directory, mtimeMs: info.mtimeMs })
    } catch {
      // 目录在枚举后被删除等竞态：直接跳过
    }
  }
  versionDirs.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const stale = versionDirs.slice(keep)
  await Promise.all(stale.map((entry) => rm(entry.directory, { recursive: true, force: true })))
  return stale
}
