/**
 * 会话排序纯工具 —— 从 SessionSidebarContext 抽离，便于独立单测，且不引入
 * React / UI 副作用依赖。排序规则与后端 SessionRepository.list 的 SQL 逐字对齐。
 */
import type { SessionListResponse } from '@spark/protocol'
import { sortByManualOrder } from './sidebar-manual-order'

export type SessionSummary = SessionListResponse['sessions'][number]

/** 把 ISO 时间字符串解析为可比较的时间戳，非法/缺失时回落到 0。 */
export function toTime(value: string | null | undefined): number {
  if (value == null) return 0
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * 会话排序，与后端 SessionRepository.list 的 SQL 逐字对齐：
 *   ORDER BY pinned_at IS NULL ASC, pinned_at DESC, updated_at DESC
 * 即：置顶在前（近期置顶更靠前），未置顶按最近更新时间倒序。
 * 乐观更新 pinnedAt 后依赖此排序让会话即时归位，避免等全量刷新。
 */
export function sortSessionsByPinned(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const aPinnedAt = a.pinnedAt
    const bPinnedAt = b.pinnedAt
    if (aPinnedAt != null && bPinnedAt == null) return -1
    if (aPinnedAt == null && bPinnedAt != null) return 1
    if (aPinnedAt != null && bPinnedAt != null) {
      return toTime(bPinnedAt) - toTime(aPinnedAt)
    }
    return toTime(b.updatedAt) - toTime(a.updatedAt)
  })
}

/**
 * 解析会话所属的展示分组 project id（worktree 归并到 base workspace），
 * 口径与 SessionSidebarContext.buildProjectGroups 的 effectiveWorkspaceId 一致：
 * worktree 若其 base 存在则归并到 base，孤儿 worktree / 普通 workspace 取自身。
 * 供 toggle 置顶时在 pinnedSessionIdsByProject / sessionIdsByProject 之间搬运 id 定位分组。
 */
export function resolveSessionGroupId(
  session: SessionSummary,
  workspaces: ReadonlyArray<{
    id: string
    worktreeMeta?: { baseWorkspaceId?: string | null } | null
  }>,
): string | null {
  for (const wsId of session.workspaceIds) {
    const ws = workspaces.find((w) => w.id === wsId)
    if (ws == null) continue
    const baseId = ws.worktreeMeta?.baseWorkspaceId
    if (baseId != null && workspaces.some((w) => w.id === baseId)) return baseId
    return wsId
  }
  return session.workspaceIds[0] ?? null
}

/**
 * 组装 project 分组的展示顺序：置顶段在前、普通段在后，各自独立套手动顺序。
 * 进入前 sessions 已被 sortSessionsByPinned 预排（pinned 段 pinnedAt 倒序、普通段 updatedAt 倒序），
 * 因此 sortByManualOrder 的 fallback「无秩项浮到该段最前、无秩项之间保持预排」
 * 恰好让新会话/新置顶落在该段顶部，符合自然顺序；有秩则按拖拽顺序。
 * 两段 manualOrder 独立，避免互相污染。
 */
export function composeProjectGroupSessions(
  sessions: readonly SessionSummary[],
  normalIds: readonly string[] | undefined,
  pinnedIds: readonly string[] | undefined,
): SessionSummary[] {
  const pinned = sessions.filter((session) => session.pinnedAt != null)
  const normal = sessions.filter((session) => session.pinnedAt == null)
  return [
    ...sortByManualOrder(pinned, pinnedIds, (session) => session.id),
    ...sortByManualOrder(normal, normalIds, (session) => session.id),
  ]
}

/* ─── 项目栏分组 fallback 排序（含临时会话分组）─── */

/** 项目栏分组排序所需的最小 workspace 结构（真实项目挂 workspace，临时会话分组不挂）。 */
export type ProjectGroupWorkspaceLike = {
  id: string
  pinnedAt: string | null
  updatedAt: string
}

/** 项目栏分组的排序输入；SidebarSessionList.DisplayGroup 结构兼容于此。 */
export type ProjectDisplayGroupLike = {
  id: string
  sessions: readonly SessionSummary[]
  workspace?: ProjectGroupWorkspaceLike | undefined
}

/** 解析分组的置顶时间：真实项目取 workspace.pinnedAt，临时会话分组取 no-project workspace。 */
export function getProjectGroupPinnedAt(
  group: ProjectDisplayGroupLike,
  noProjectWorkspace: ProjectGroupWorkspaceLike | null,
): string | null {
  if (group.workspace != null) return group.workspace.pinnedAt
  if (group.id === 'project:no-project') return noProjectWorkspace?.pinnedAt ?? null
  return null
}

/** 分组最新活动：组内会话最大 updatedAt，无会话时回落 workspace 自身 updatedAt。 */
function latestProjectGroupAt(
  group: ProjectDisplayGroupLike,
  noProjectWorkspace: ProjectGroupWorkspaceLike | null,
): number {
  let latest = 0
  for (const session of group.sessions) {
    const t = toTime(session.updatedAt)
    if (t > latest) latest = t
  }
  return latest || toTime(group.workspace?.updatedAt ?? noProjectWorkspace?.updatedAt)
}

/**
 * 项目栏分组 fallback 排序（手动拖拽序不存在/未覆盖时），口径与
 * SessionSidebarContext.buildProjectGroups 逐字一致：置顶在前（pinnedAt 倒序），
 * 未置顶按「组内最新会话 updatedAt」倒序，无会话回落 workspace.updatedAt。
 * 临时会话分组（project:no-project）不挂 workspace，由调用方传入其背后的
 * no-project workspace 提供排序字段，从而与真实项目同一口径参与排序。
 */
export function compareProjectDisplayGroups(
  a: ProjectDisplayGroupLike,
  b: ProjectDisplayGroupLike,
  noProjectWorkspace: ProjectGroupWorkspaceLike | null,
): number {
  const aPinnedAt = getProjectGroupPinnedAt(a, noProjectWorkspace)
  const bPinnedAt = getProjectGroupPinnedAt(b, noProjectWorkspace)
  if (aPinnedAt != null && bPinnedAt == null) return -1
  if (aPinnedAt == null && bPinnedAt != null) return 1
  if (aPinnedAt != null && bPinnedAt != null) return toTime(bPinnedAt) - toTime(aPinnedAt)
  return latestProjectGroupAt(b, noProjectWorkspace) - latestProjectGroupAt(a, noProjectWorkspace)
}
