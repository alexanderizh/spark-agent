/**
 * 「文件」面板全局 store：选中项目 + 各项目展开目录（localStorage 持久化）+ 打开请求桥。
 *
 * 设计与 code-viewer/file-explorer/fileExplorerVisibility.ts 一致：
 * 模块级状态 + Set<listeners> + useSyncExternalStore。
 *
 * 与「代码」tab 的文件树不同（展开目录挂 per-session PanelSnapshot），「文件」面板是
 * 跨会话的项目浏览器：选中项目与各项目展开目录都是用户对项目的浏览偏好，
 * 按项目持久化、与会话无关，重启后沿用。
 *
 * 跨视图打开入口见同目录 projectFilesPanelNavigation.ts（与 codeViewerNavigation
 * 同构的「待处理标记 + CustomEvent」桥），打开时由 ChatView 把目标项目写入本 store。
 */

import { useSyncExternalStore } from 'react'

const SELECTED_KEY = 'spark-agent:project-files-selected-workspace'
const EXPANDED_KEY = 'spark-agent:project-files-expanded-dirs'

type Listener = () => void

const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readStoredSelectedWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SELECTED_KEY)
  } catch {
    /* localStorage 不可用时退回内存默认值 */
    return null
  }
}

function readStoredExpandedByWorkspace(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  if (typeof window === 'undefined') return map
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY)
    if (raw == null) return map
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object') return map
    for (const [workspaceId, dirs] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(dirs)) continue
      map.set(
        workspaceId,
        new Set(dirs.filter((dir): dir is string => typeof dir === 'string')),
      )
    }
  } catch {
    /* 解析失败视为无持久化数据，从空 Map 重新累积 */
  }
  return map
}

// ── 选中项目 ──

let selectedWorkspaceId: string | null = readStoredSelectedWorkspaceId()

export function getSelectedProjectFilesWorkspaceId(): string | null {
  return selectedWorkspaceId
}

/** 持久化选中的项目；传 null 表示清除（下次打开按「会话项目 → 第一个项目」回退）。 */
export function setSelectedProjectFilesWorkspaceId(workspaceId: string | null): void {
  if (selectedWorkspaceId === workspaceId) return
  selectedWorkspaceId = workspaceId
  try {
    if (workspaceId == null) window.localStorage.removeItem(SELECTED_KEY)
    else window.localStorage.setItem(SELECTED_KEY, workspaceId)
  } catch {
    /* 受限渲染上下文仍可使用内存偏好 */
  }
  emit()
}

export function useSelectedProjectFilesWorkspaceId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedProjectFilesWorkspaceId, () => null)
}

// ── 各项目展开目录 ──
// Set 实例缓存在 Map 里保证 getSnapshot 引用稳定（useSyncExternalStore 要求）。

const EMPTY_EXPANDED_DIRS: Set<string> = new Set()

let expandedByWorkspace: Map<string, Set<string>> = readStoredExpandedByWorkspace()

function persistExpandedByWorkspace(): void {
  try {
    const raw: Record<string, string[]> = {}
    for (const [workspaceId, dirs] of expandedByWorkspace) {
      raw[workspaceId] = Array.from(dirs)
    }
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(raw))
  } catch {
    /* 受限渲染上下文仍可使用内存偏好 */
  }
}

export function getProjectFilesExpandedDirs(workspaceId: string | null): Set<string> {
  if (workspaceId == null) return EMPTY_EXPANDED_DIRS
  return expandedByWorkspace.get(workspaceId) ?? EMPTY_EXPANDED_DIRS
}

/** 覆盖某项目的展开目录集合（文件树受控展开态的唯一写入入口）。 */
export function setProjectFilesExpandedDirs(workspaceId: string | null, next: Set<string>): void {
  if (workspaceId == null) return
  const prev = expandedByWorkspace.get(workspaceId)
  if (prev != null && prev.size === next.size && [...prev].every((dir) => next.has(dir))) return
  expandedByWorkspace.set(workspaceId, new Set(next))
  persistExpandedByWorkspace()
  emit()
}

export function useProjectFilesExpandedDirs(workspaceId: string | null): Set<string> {
  return useSyncExternalStore(
    subscribe,
    () => getProjectFilesExpandedDirs(workspaceId),
    () => EMPTY_EXPANDED_DIRS,
  )
}

/** 仅供测试：重置全部内存态（localStorage 数据保留，测试自管清理）。 */
export function resetProjectFilesPanelStoreForTest(): void {
  selectedWorkspaceId = readStoredSelectedWorkspaceId()
  expandedByWorkspace = readStoredExpandedByWorkspace()
  emit()
}
