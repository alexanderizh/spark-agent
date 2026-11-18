import type { MobileBridgeProjectArtifactItem } from '@spark/protocol'
import { classifyRemoteFile } from './remoteRichContent'

export const REMOTE_PROJECT_PANEL_WIDTH_KEY = 'spark-agent:remote-project-panel-width'
export const REMOTE_PROJECT_PANEL_MIN_WIDTH = 280
export const REMOTE_PROJECT_PANEL_MAX_WIDTH = 560
export const REMOTE_PROJECT_PANEL_DEFAULT_WIDTH = 340

export type RemoteArtifactScope = 'session' | 'project'
export type RemoteArtifactType = 'all' | 'image' | 'document' | 'text' | 'code' | 'other'
export type RemoteProjectPanelTab = 'session' | 'project' | 'artifacts'

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
