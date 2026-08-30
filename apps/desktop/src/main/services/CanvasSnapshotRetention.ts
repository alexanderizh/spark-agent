/**
 * 画布项目快照保留策略。
 *
 * 每次画布自动保存都会在 `<project>/snapshots/` 追加一个全量时间戳 JSON
 * （见 ipc/index.ts writeCanvasProjectPackageFiles），历史行为无上限，
 * 单项目可积累数百份、全量目录可达数 GB。这里在每次保存后按时间倒序
 * 只保留最近 keep 份时间戳快照；latest.json 永不删除。
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 每个画布项目保留的时间戳快照份数 */
export const CANVAS_SNAPSHOT_KEEP = 10
/** 退出画布编辑（窗口关闭/切换项目）后收紧到的份数：latest.json 之外仅留少量恢复点 */
export const CANVAS_SNAPSHOT_KEEP_ON_EXIT = 2

/** 时间戳快照文件名形如 2026-08-27T03-22-00-123Z.json（保存时把 : 和 . 替换成 -） */
const TIMESTAMP_SNAPSHOT_PATTERN = /^\d{4}-\d{2}-\d{2}T.*\.json$/

export interface PrunedCanvasSnapshot {
  file: string
  mtimeMs: number
}

/**
 * 删除 snapshotsDir 中超出保留数量的时间戳快照。
 * 文件名按字典序即时间序（ISO 8601），同时以 mtime 兜底排序。
 *
 * @returns 被删除的文件列表；目录不存在时返回空列表且不报错。
 */
export async function pruneCanvasSnapshots(
  snapshotsDir: string,
  keep: number = CANVAS_SNAPSHOT_KEEP,
): Promise<PrunedCanvasSnapshot[]> {
  if (keep < 1) return []
  let entries
  try {
    entries = await readdir(snapshotsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const snapshots: PrunedCanvasSnapshot[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !TIMESTAMP_SNAPSHOT_PATTERN.test(entry.name)) continue
    const file = join(snapshotsDir, entry.name)
    try {
      const info = await stat(file)
      snapshots.push({ file, mtimeMs: info.mtimeMs })
    } catch {
      // 枚举后被删除等竞态：直接跳过
    }
  }
  snapshots.sort((left, right) => right.mtimeMs - left.mtimeMs)
  const stale = snapshots.slice(keep)
  await Promise.all(stale.map((snapshot) => rm(snapshot.file, { force: true })))
  return stale
}
