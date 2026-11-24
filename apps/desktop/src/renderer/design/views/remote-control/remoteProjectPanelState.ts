import type { MobileBridgeProjectArtifactItem } from '@spark/protocol'
import { classifyRemoteFile } from './remoteRichContent'

export const REMOTE_PROJECT_PANEL_WIDTH_KEY = 'spark-agent:remote-project-panel-width'
export const REMOTE_PROJECT_PANEL_MIN_WIDTH = 280
export const REMOTE_PROJECT_PANEL_MAX_WIDTH = 560
export const REMOTE_PROJECT_PANEL_DEFAULT_WIDTH = 340

/** 面板开合持久化 key；未持久化过时默认打开（2026-11-25 需求：右侧面板默认展开） */
export const REMOTE_PROJECT_PANEL_OPEN_KEY = 'spark-agent:remote-project-panel-open'
export const REMOTE_PROJECT_PANEL_DEFAULT_OPEN = true

export type RemoteArtifactScope = 'session' | 'project'
export type RemoteArtifactType = 'all' | 'image' | 'document' | 'text' | 'code' | 'other'
/**
 * 面板 tab（2026-11-25 对齐本地会话侧面板）：静态 项目/产物/检查器/配置，
 * 外加动态 `preview:<远程路径>` 预览 tab（产物卡片点击打开，对齐本地 openUnifiedSidePanel）。
 * 2026-11-25 复审移除「会话」tab：其内容（项目会话列表）与左侧栏完全重复。
 */
export type RemoteProjectPanelTab =
  | 'project'
  | 'artifacts'
  | 'inspector'
  | 'config'
  | `preview:${string}`

export function remoteFilePreviewPanelKind(filePath: string): RemoteProjectPanelTab {
  return `preview:${filePath}`
}

export function remotePathOfPreviewPanelTab(tab: RemoteProjectPanelTab): string | null {
  return tab.startsWith('preview:') ? tab.slice('preview:'.length) : null
}

export function parseRemoteArtifactType(value: string): RemoteArtifactType {
  return value === 'image' ||
    value === 'document' ||
    value === 'text' ||
    value === 'code' ||
    value === 'other'
    ? value
    : 'all'
}

export interface RemoteProjectPanelStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function clampRemoteProjectPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return REMOTE_PROJECT_PANEL_DEFAULT_WIDTH
  return Math.round(
    Math.min(REMOTE_PROJECT_PANEL_MAX_WIDTH, Math.max(REMOTE_PROJECT_PANEL_MIN_WIDTH, width)),
  )
}

function resolveStorage(
  storage?: RemoteProjectPanelStorage | null,
): RemoteProjectPanelStorage | null {
  if (storage !== undefined) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readRemoteProjectPanelWidth(storage?: RemoteProjectPanelStorage | null): number {
  const target = resolveStorage(storage)
  if (target == null) return REMOTE_PROJECT_PANEL_DEFAULT_WIDTH
  try {
    const raw = target.getItem(REMOTE_PROJECT_PANEL_WIDTH_KEY)
    if (raw == null || raw.trim().length === 0) return REMOTE_PROJECT_PANEL_DEFAULT_WIDTH
    const value = Number(raw)
    return Number.isFinite(value)
      ? clampRemoteProjectPanelWidth(value)
      : REMOTE_PROJECT_PANEL_DEFAULT_WIDTH
  } catch {
    return REMOTE_PROJECT_PANEL_DEFAULT_WIDTH
  }
}

export function rememberRemoteProjectPanelWidth(
  width: number,
  storage?: RemoteProjectPanelStorage | null,
): number {
  const bounded = clampRemoteProjectPanelWidth(width)
  const target = resolveStorage(storage)
  if (target == null) return bounded
  try {
    target.setItem(REMOTE_PROJECT_PANEL_WIDTH_KEY, String(bounded))
  } catch {
    // Storage is optional UI state; a blocked write must not affect resizing.
  }
  return bounded
}

/** 读取面板开合状态：未持久化过 → 默认打开；手动关过 → 跟随用户选择不再强开 */
export function readRemoteProjectPanelOpen(storage?: RemoteProjectPanelStorage | null): boolean {
  const target = resolveStorage(storage)
  if (target == null) return REMOTE_PROJECT_PANEL_DEFAULT_OPEN
  try {
    const raw = target.getItem(REMOTE_PROJECT_PANEL_OPEN_KEY)
    if (raw == null || raw.trim().length === 0) return REMOTE_PROJECT_PANEL_DEFAULT_OPEN
    if (raw === 'true') return true
    if (raw === 'false') return false
    return REMOTE_PROJECT_PANEL_DEFAULT_OPEN
  } catch {
    return REMOTE_PROJECT_PANEL_DEFAULT_OPEN
  }
}

export function rememberRemoteProjectPanelOpen(
  open: boolean,
  storage?: RemoteProjectPanelStorage | null,
): void {
  const target = resolveStorage(storage)
  if (target == null) return
  try {
    target.setItem(REMOTE_PROJECT_PANEL_OPEN_KEY, open ? 'true' : 'false')
  } catch {
    // Storage is optional UI state; a blocked write must not affect toggling.
  }
}

export function filterProjectArtifacts(
  artifacts: MobileBridgeProjectArtifactItem[],
  sessionId: string | null,
  scope: RemoteArtifactScope,
  type: RemoteArtifactType,
): MobileBridgeProjectArtifactItem[] {
  return artifacts.filter((artifact) => {
    if (scope === 'session' && (sessionId == null || artifact.sessionId !== sessionId)) {
      return false
    }
    if (type === 'all') return true
    const kind = classifyRemoteFile(artifact.path)
    if (type === 'text') return kind === 'text' || kind === 'markdown' || kind === 'html'
    return kind === type
  })
}

/**
 * 把当前会话时间线里的产物事件（presented_files）合并进 REST 聚合结果。
 *
 * 2026-11-25 修复「面板比聊天慢」：聊天里的文件卡片来自实时事件流，而产物 tab
 * 只读 30s 轮询的 REST 聚合——新产物要等下一轮轮询才出现。现在时间线条目即时
 * 并入：按路径精确去重（REST 已有的条目保留其更完整的元信息），时间线独有的
 * 条目标记为本会话即时条目。
 */
export function mergeSessionTimelineArtifacts(
  restArtifacts: MobileBridgeProjectArtifactItem[],
  timelineFiles: ReadonlyArray<{ path: string; title?: string }>,
  sessionId: string | null,
): MobileBridgeProjectArtifactItem[] {
  if (sessionId == null || timelineFiles.length === 0) return restArtifacts
  const restByPath = new Set(restArtifacts.map((item) => item.path))
  const now = new Date().toISOString()
  const timelineOnly = timelineFiles
    .filter((file) => !restByPath.has(file.path))
    .map<MobileBridgeProjectArtifactItem>((file) => ({
      path: file.path,
      ...(file.title != null ? { title: file.title } : {}),
      sessionId,
      sessionTitle: '本会话',
      // 时间线即时条目用当前时间：排序自然置顶，显示为「刚刚」；
      // REST 轮询跟上后同路径去重收敛，元信息交还给聚合结果
      presentedAt: now,
      presented: true,
    }))
    .slice(0, 50)
  return [...timelineOnly, ...restArtifacts]
}
