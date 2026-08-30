import type { CanvasProject } from './canvas.types'

export type CanvasProjectSortKey = 'updated' | 'created' | 'lastOpened' | 'title'
export type CanvasProjectSortDir = 'desc' | 'asc'

export const CANVAS_PROJECT_SORT_LABELS: Record<CanvasProjectSortKey, string> = {
  updated: '修改时间',
  created: '创建时间',
  lastOpened: '最近打开',
  title: '名称',
}

function compareIso(a: string | null | undefined, b: string | null | undefined): number {
  const left = a ?? ''
  const right = b ?? ''
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareProjectId(a: CanvasProject, b: CanvasProject): number {
  return a.id.localeCompare(b.id)
}

/**
 * 排序无限画布项目列表：置顶项目始终排最前，未置顶按 sortKey/sortDir 排序。
 * 纯函数，便于单测；UI 层（CanvasProjectsView）直接复用。
 */
export function sortCanvasProjects(
  projects: CanvasProject[],
  sortKey: CanvasProjectSortKey,
  sortDir: CanvasProjectSortDir,
): CanvasProject[] {
  const factor = sortDir === 'asc' ? 1 : -1
  const sorted = [...projects].sort((a, b) => {
    let result: number
    switch (sortKey) {
      case 'created':
        result = compareIso(a.createdAt, b.createdAt)
        break
      case 'lastOpened':
        result = compareIso(a.lastOpenedAt ?? a.createdAt, b.lastOpenedAt ?? b.createdAt)
        break
      case 'title':
        result = (a.title ?? '').localeCompare(b.title ?? '', undefined, {
          sensitivity: 'base',
        })
        break
      case 'updated':
      default:
        result = compareIso(a.updatedAt, b.updatedAt)
        break
    }
    return result === 0 ? compareProjectId(a, b) : factor * result
  })
  return [
    ...sorted.filter((project) => project.pinned),
    ...sorted.filter((project) => !project.pinned),
  ]
}
