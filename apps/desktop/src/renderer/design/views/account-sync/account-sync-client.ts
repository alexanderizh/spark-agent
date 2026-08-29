import {
  ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_ITEMS,
  ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_TOTAL_CHARS,
  countAccountSyncPromptLibraryChars,
  type AccountSyncExecuteRequest,
  type AccountSyncExecuteResponse,
  type AccountSyncPreviewResult,
  type AccountSyncPromptLibraryItemInput,
} from '@spark/protocol'
import { canvasApi } from '../canvas/canvas.api'
import { getPromptCategory } from '../canvas/canvasPromptLibraryCategories'
import { readPromptLibraryCover, readPromptLibraryText } from '../canvas/canvasPromptLibraryData'
import { readAssetKind } from '../canvas/canvasFilmAssets'
import type { CanvasSnapshot } from '../canvas/canvas.types'

const EPOCH = new Date(0).toISOString()

function stringTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []
}

/** 将 `canvasApi.openSnapshot` 返回的最新热快照投影为同步所需的项目提示词。 */
export function projectPromptLibraryItemsFromSnapshots(
  snapshots: readonly CanvasSnapshot[],
): AccountSyncPromptLibraryItemInput[] {
  const items = snapshots.flatMap((snapshot) =>
    snapshot.assets
      .filter((asset) => readAssetKind(asset) === 'prompt_library')
      .flatMap((asset): AccountSyncPromptLibraryItemInput[] => {
        const text = readPromptLibraryText(asset).trim()
        if (!text) return []
        const cover = readPromptLibraryCover(asset, snapshot.assets)
        return [
          {
            id: `legacy:${snapshot.project.id}:${asset.id}`,
            title: asset.title?.trim() || '-',
            text,
            category: getPromptCategory(asset) ?? '',
            tags: stringTags(asset.metadata.tags),
            coverUrl: cover.url,
            coverMimeType: cover.mimeType,
            createdAt: asset.createdAt || EPOCH,
            updatedAt: asset.updatedAt || EPOCH,
          },
        ]
      }),
  )
  if (items.length > ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_ITEMS) {
    throw new Error(
      `提示词库共有 ${items.length} 条项目提示词，超过单次同步上限 ${ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_ITEMS} 条`,
    )
  }
  if (countAccountSyncPromptLibraryChars(items) > ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_TOTAL_CHARS) {
    throw new Error('提示词库项目数据超过单次同步大小上限，请移除超大封面后重试')
  }
  return items
}

/**
 * 列出全部项目（含软删除项目），并通过 openSnapshot 读取磁盘与热存储中的最新快照。
 * 这样同步既不会漏掉未落 SQLite 的热状态，也不会因项目删除而丢失提示词资产。
 */
export async function collectLatestProjectPromptLibraryItems(): Promise<
  AccountSyncPromptLibraryItemInput[] | undefined
> {
  let projects: Awaited<ReturnType<typeof canvasApi.listProjects>>
  try {
    projects = await canvasApi.listProjects(true)
  } catch {
    console.warn(
      '[account-sync] prompt library project list unavailable; falling back to persisted snapshots',
    )
    return undefined
  }
  const snapshots = await Promise.all(
    projects.map(async (project) => {
      try {
        return await canvasApi.openSnapshot(project.id)
      } catch {
        return null
      }
    }),
  )
  if (snapshots.some((snapshot) => snapshot === null)) {
    console.warn(
      '[account-sync] latest prompt library snapshot unavailable; falling back to persisted snapshots',
    )
    return undefined
  }
  return projectPromptLibraryItemsFromSnapshots(
    snapshots.filter((snapshot): snapshot is CanvasSnapshot => snapshot !== null),
  )
}

async function promptLibraryItemsWhenEnabled(
  enabled: boolean,
): Promise<AccountSyncPromptLibraryItemInput[] | undefined> {
  return enabled ? collectLatestProjectPromptLibraryItems() : undefined
}

export async function executeAccountSync(
  request: AccountSyncExecuteRequest,
  includePromptLibrary: boolean,
): Promise<AccountSyncExecuteResponse> {
  const promptLibraryItems = await promptLibraryItemsWhenEnabled(includePromptLibrary)
  return window.spark.invoke('account-sync:execute', {
    ...request,
    ...(promptLibraryItems !== undefined ? { promptLibraryItems } : {}),
  })
}

export async function previewAccountSync(
  includePromptLibrary: boolean,
): Promise<AccountSyncPreviewResult> {
  const promptLibraryItems = await promptLibraryItemsWhenEnabled(includePromptLibrary)
  return window.spark.invoke('account-sync:preview', {
    ...(promptLibraryItems !== undefined ? { promptLibraryItems } : {}),
  })
}
