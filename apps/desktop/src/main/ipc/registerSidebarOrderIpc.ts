import { SparkError } from '@spark/shared'
import {
  SessionRepository,
  SettingsRepository,
  WorkspaceRepository,
  type WorktreeMeta,
} from '@spark/storage'
import type { SidebarOrderState, SidebarOrderUpdateRequest } from '@spark/protocol'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'

const SETTINGS_CATEGORY = 'sidebar-order'
const PROJECTS_KEY = 'projects'
const SESSIONS_KEY_PREFIX = 'sessions:'
const PINNED_SESSIONS_KEY_PREFIX = 'pinned-sessions:'

interface SidebarOrderSettingsStore {
  getByCategory(category: string): Record<string, unknown>
  set(category: string, key: string, value: unknown): void
}

interface SidebarOrderWorkspaceStore {
  get(id: string): { id: string } | null
  getWorktreeMeta(id: string): WorktreeMeta | null
}

interface SidebarOrderSessionStore {
  get(id: string): { id: string } | null
  getWorkspaceIds(id: string): string[]
}

export interface SidebarOrderControllerOptions {
  settings: SidebarOrderSettingsStore
  workspaces: SidebarOrderWorkspaceStore
  sessions: SidebarOrderSessionStore
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((item): item is string => typeof item === 'string')
  return [...new Set(ids)]
}

/** Owns validation and durable storage for manually ordered sidebar items. */
export class SidebarOrderController {
  constructor(private readonly stores: SidebarOrderControllerOptions) {}

  list(): SidebarOrderState {
    const stored = this.stores.settings.getByCategory(SETTINGS_CATEGORY)
    const sessionIdsByProject: Record<string, string[]> = {}
    const pinnedSessionIdsByProject: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(stored)) {
      if (key.startsWith(SESSIONS_KEY_PREFIX)) {
        const projectId = key.slice(SESSIONS_KEY_PREFIX.length)
        if (projectId.length > 0) sessionIdsByProject[projectId] = normalizeIdList(value)
      } else if (key.startsWith(PINNED_SESSIONS_KEY_PREFIX)) {
        const projectId = key.slice(PINNED_SESSIONS_KEY_PREFIX.length)
        if (projectId.length > 0) pinnedSessionIdsByProject[projectId] = normalizeIdList(value)
      }
    }
    return {
      projectIds: normalizeIdList(stored[PROJECTS_KEY]),
      sessionIdsByProject,
      pinnedSessionIdsByProject,
    }
  }

  update(request: SidebarOrderUpdateRequest): string[] {
    if (request.scope === 'projects') {
      this.assertProjectOrder(request.itemIds)
      this.stores.settings.set(SETTINGS_CATEGORY, PROJECTS_KEY, request.itemIds)
      return request.itemIds
    }

    // sessions 与 pinned-sessions 共用「会话必须在所属项目内」的校验，仅落库 key 前缀不同。
    const keyPrefix =
      request.scope === 'pinned-sessions' ? PINNED_SESSIONS_KEY_PREFIX : SESSIONS_KEY_PREFIX
    this.assertSessionOrder(request.projectId, request.itemIds)
    this.stores.settings.set(SETTINGS_CATEGORY, `${keyPrefix}${request.projectId}`, request.itemIds)
    return request.itemIds
  }

  private assertProjectOrder(projectIds: string[]): void {
    for (const projectId of projectIds) {
      if (this.stores.workspaces.get(projectId) == null) {
        throw new SparkError('NOT_FOUND', '排序中的项目不存在或已被删除')
      }
      if (this.stores.workspaces.getWorktreeMeta(projectId) != null) {
        throw new SparkError('VALIDATION_FAILED', '工作树不能作为独立项目参与侧栏排序')
      }
    }
  }

  private assertSessionOrder(projectId: string, sessionIds: string[]): void {
    if (this.stores.workspaces.get(projectId) == null) {
      throw new SparkError('NOT_FOUND', '目标项目不存在或已被删除')
    }
    for (const sessionId of sessionIds) {
      if (this.stores.sessions.get(sessionId) == null) {
        throw new SparkError('NOT_FOUND', '排序中的会话不存在或已被删除')
      }
      const belongsToProject = this.stores.sessions
        .getWorkspaceIds(sessionId)
        .some((workspaceId) => {
          if (workspaceId === projectId) return true
          return this.stores.workspaces.getWorktreeMeta(workspaceId)?.baseWorkspaceId === projectId
        })
      if (!belongsToProject) {
        throw new SparkError('VALIDATION_FAILED', '会话只能在所属项目内部排序')
      }
    }
  }
}

export function registerSidebarOrderIpc(options?: Partial<SidebarOrderControllerOptions>): void {
  const database = options == null ? getDatabase() : null
  const controller = new SidebarOrderController({
    settings: options?.settings ?? new SettingsRepository(database ?? getDatabase()),
    workspaces: options?.workspaces ?? new WorkspaceRepository(database ?? getDatabase()),
    sessions: options?.sessions ?? new SessionRepository(database ?? getDatabase()),
  })

  typedIpcHandle('sidebar-order:list', async () => controller.list())
  typedIpcHandle('sidebar-order:update', async (request) => ({
    itemIds: controller.update(request),
  }))
}
