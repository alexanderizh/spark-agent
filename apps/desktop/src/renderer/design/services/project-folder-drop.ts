import { getFileNameFromPath, hasFileDataTransfer } from './composer-attachments'

export const SIDEBAR_PROJECT_DROP_ZONE_SELECTOR = '[data-sidebar-project-drop-zone]'

export type DirectoryDropIntent = 'accept' | 'reject' | 'unknown'

export type DroppedProjectSummary = {
  added: number
  ignoredFiles: number
  duplicates: number
  failed: number
}

type FileKindProbe = (params: { path: string }) => Promise<{ kind: string }>
type OpenWorkspace = (params: {
  create: { name: string; rootPath: string }
}) => Promise<{ workspace: { id: string } }>

export type AddProjectsFromDroppedPathsDependencies = {
  existingRootPaths: string[]
  statFileKind: FileKindProbe
  openWorkspace: OpenWorkspace
  refreshData: () => Promise<void>
  setActiveWorkspace: (workspaceId: string) => void
}

type EntryLike = { isDirectory: boolean }
type EntryCapableItem = DataTransferItem & {
  webkitGetAsEntry?: () => EntryLike | null
}

export function getDirectoryDropIntent(
  dataTransfer: DataTransfer | null | undefined,
): DirectoryDropIntent {
  if (!hasFileDataTransfer(dataTransfer)) return 'reject'

  let inspectedEntries = 0
  for (const item of Array.from(dataTransfer?.items ?? [])) {
    if (item.kind !== 'file') continue
    const getEntry = (item as EntryCapableItem).webkitGetAsEntry
    if (typeof getEntry !== 'function') continue
    let entry: EntryLike | null
    try {
      entry = getEntry.call(item)
    } catch {
      continue
    }
    if (entry == null) continue
    inspectedEntries += 1
    if (entry.isDirectory) return 'accept'
  }

  return inspectedEntries > 0 ? 'reject' : 'unknown'
}

export function isSidebarProjectDropTarget(target: EventTarget | null): boolean {
  if (target == null) return false
  const closest = (target as { closest?: (selector: string) => Element | null }).closest
  return typeof closest === 'function'
    ? closest.call(target, SIDEBAR_PROJECT_DROP_ZONE_SELECTOR) != null
    : false
}

export function shouldHandleComposerFileDrop(
  dataTransfer: DataTransfer | null | undefined,
  target: EventTarget | null,
  sending: boolean,
): boolean {
  return !sending && hasFileDataTransfer(dataTransfer) && !isSidebarProjectDropTarget(target)
}

export async function addProjectsFromDroppedPaths(
  paths: string[],
  dependencies: AddProjectsFromDroppedPathsDependencies,
): Promise<DroppedProjectSummary> {
  const summary: DroppedProjectSummary = {
    added: 0,
    ignoredFiles: 0,
    duplicates: 0,
    failed: 0,
  }
  const seenRootPaths = new Set(dependencies.existingRootPaths.map(normalizePathForComparison))
  let lastWorkspaceId: string | null = null

  for (const rawPath of paths) {
    const rootPath = trimTrailingSeparators(rawPath.trim())
    if (rootPath.length === 0) {
      summary.failed += 1
      continue
    }

    const comparisonPath = normalizePathForComparison(rootPath)
    if (seenRootPaths.has(comparisonPath)) {
      summary.duplicates += 1
      continue
    }

    let kind: string
    try {
      kind = (await dependencies.statFileKind({ path: rootPath })).kind
    } catch {
      summary.failed += 1
      continue
    }
    if (kind !== 'directory') {
      summary.ignoredFiles += 1
      continue
    }

    try {
      const result = await dependencies.openWorkspace({
        create: { name: getFileNameFromPath(rootPath), rootPath },
      })
      summary.added += 1
      lastWorkspaceId = result.workspace.id
      seenRootPaths.add(comparisonPath)
    } catch {
      summary.failed += 1
    }
  }

  if (lastWorkspaceId != null) {
    await dependencies.refreshData()
    dependencies.setActiveWorkspace(lastWorkspaceId)
  }

  return summary
}

export function formatDroppedProjectSummary(summary: DroppedProjectSummary): string {
  const details: string[] = []
  if (summary.ignoredFiles > 0) details.push(`忽略 ${summary.ignoredFiles} 个文件`)
  if (summary.duplicates > 0) details.push(`${summary.duplicates} 个重复目录`)

  const added = summary.added > 0 ? `已添加 ${summary.added} 个项目` : '未添加项目'
  const ignored = details.length > 0 ? `；${details.join('、')}` : ''
  const failed = summary.failed > 0 ? `，${summary.failed} 个目录添加失败` : ''
  return `${added}${ignored}${failed}`
}

function normalizePathForComparison(filePath: string): string {
  const normalized = trimTrailingSeparators(filePath.trim().replace(/\\/g, '/'))
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function trimTrailingSeparators(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '')
  return trimmed.length > 0 ? trimmed : filePath
}
