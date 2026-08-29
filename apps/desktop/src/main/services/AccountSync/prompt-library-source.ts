import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CanvasProjectRepository,
  CanvasSnapshotRepository,
  type CanvasProjectRow,
  type SparkDatabase,
} from '@spark/storage'
import {
  readCanvasProjectPromptLibraryItems,
  type CanvasPromptSnapshot,
  type PersistedPromptLibraryItem,
} from '../CanvasPromptLibraryPersistence.js'

function parseSnapshotJson(value: string | null | undefined): CanvasPromptSnapshot | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CanvasPromptSnapshot)
      : null
  } catch {
    return null
  }
}

/** 与 canvas:snapshot:load / canvasApi.openSnapshot 一致：项目目录最新快照优先，SQLite 回退。 */
async function readLatestProjectSnapshot(
  project: CanvasProjectRow,
  snapshots: CanvasSnapshotRepository,
): Promise<CanvasPromptSnapshot | null> {
  if (project.root_path) {
    try {
      const fileValue = await readFile(
        path.join(project.root_path, 'snapshots', 'latest.json'),
        'utf8',
      )
      const snapshot = parseSnapshotJson(fileValue)
      if (snapshot) return snapshot
    } catch {
      // 项目目录快照缺失或损坏时，保持现有加载语义并回退 SQLite。
    }
  }
  return parseSnapshotJson(snapshots.get(project.id)?.snapshot_json)
}

/**
 * 读取提示词库“全部用户提示词”：全局设置条目 + 所有项目（含软删除项目）的提示词资产。
 * 全局条目优先，兼容新版 `legacy:<projectId>:<assetId>` 与旧版 `legacy:<assetId>` 去重。
 */
export async function readAllPromptLibraryItems(
  db: SparkDatabase,
  globalItems: readonly PersistedPromptLibraryItem[],
  latestProjectItems?: readonly PersistedPromptLibraryItem[],
): Promise<PersistedPromptLibraryItem[]> {
  const itemsById = new Map(globalItems.map((item) => [item.id, item]))

  const addProjectItem = (item: PersistedPromptLibraryItem): void => {
    const legacyParts = item.id.split(':')
    const assetId = legacyParts.length >= 3 ? legacyParts.slice(2).join(':') : ''
    if (itemsById.has(item.id) || (assetId && itemsById.has(`legacy:${assetId}`))) return
    itemsById.set(item.id, item)
  }

  if (latestProjectItems !== undefined) {
    for (const item of latestProjectItems) addProjectItem(item)
    return [...itemsById.values()]
  }

  const projects = new CanvasProjectRepository(db)
  const snapshots = new CanvasSnapshotRepository(db)

  for (const project of projects.list(0, true)) {
    const snapshot = await readLatestProjectSnapshot(project, snapshots)
    if (!snapshot) continue
    for (const item of readCanvasProjectPromptLibraryItems(project.id, snapshot)) {
      addProjectItem(item)
    }
  }

  return [...itemsById.values()]
}
