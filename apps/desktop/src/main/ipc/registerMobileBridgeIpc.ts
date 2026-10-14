/**
 * 移动桥接 IPC 注册 + 依赖装配。
 *
 * 装配层职责（本文件）：
 *   1. 创建 MobileBridgeService（设置与设备存 SettingsService，键 mobileBridge/store）
 *   2. 注入 deps 闭包（会话仓库 / SessionService / 账号校验），避免服务层反向依赖
 *   3. 注册设置 IPC（get-status / update-settings / revoke-device）
 *   4. 按设置启动 HTTP/WS 服务
 *
 * 主进程 ipc/index.ts 只加一行 registerMobileBridgeIpc({...}) 调用。
 */

import { app } from 'electron'
import type {
  AgentEvent,
  MobileBridgeEvent,
  MobileBridgeProjectSummary,
  MobileBridgeSettings,
  MobileBridgeSessionSummary,
  MobileBridgeStatus,
} from '@spark/protocol'
import type {
  ScheduledTaskService,
  SessionService,
  SettingsService,
  WorkspaceService,
} from '@spark/agent-runtime'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'
import { SessionRepository } from '@spark/storage'
import { DEFAULT_MOBILE_BRIDGE_SETTINGS } from '@spark/protocol'
import {
  MobileBridgeService,
  type MobileBridgeDeps,
  type MobileBridgePersistedDevice,
} from '../services/MobileBridgeService.js'
import { createLogger } from '@spark/shared'

const log = createLogger('mobile-bridge:ipc')

const SETTINGS_CATEGORY = 'mobileBridge'
const SETTINGS_KEY = 'store'

export interface MobileBridgeIpcDeps {
  getSessionService(): SessionService
  getSettingsService(): SettingsService
  getWorkspaceService(): WorkspaceService
  /** 删除会话时关闭该会话名下的内置终端 PTY（与 session:delete 行为对齐）；最小结构类型避免依赖桌面端本地实现 */
  getTerminalService(): { disposeBySession(sessionId: string, opts?: { defer?: boolean }): number }
  /** 归档会话时同步暂停关联定时任务（与 session:update 行为对齐） */
  getScheduledTaskService(): ScheduledTaskService
  /** 账号 token 校验（edu-server /me） */
  validateAccountToken(token: string): Promise<{ userId: string; account: string } | null>
  /** 新建会话（默认渠道/引擎/权限，与远程建会话同规则；projectId 归属项目） */
  createMobileSession(title?: string, projectId?: string): Promise<MobileBridgeSessionSummary>
}

/** 持久化形态：设备含 deviceToken（本机 Secrets，与远程连接凭据同存储） */
interface BridgeStoreShape {
  settings: MobileBridgeSettings
  devices: MobileBridgePersistedDevice[]
}

let service: MobileBridgeService | null = null

function getService(deps: MobileBridgeIpcDeps): MobileBridgeService {
  if (service != null) return service
  const settings = deps.getSettingsService()
  service = new MobileBridgeService(
    () => {
      const raw = settings.get(SETTINGS_CATEGORY, SETTINGS_KEY)
      if (raw == null || typeof raw !== 'object') {
        return { settings: { ...DEFAULT_MOBILE_BRIDGE_SETTINGS }, devices: [] }
      }
      const record = raw as Record<string, unknown>
      return {
        settings:
          record.settings != null && typeof record.settings === 'object'
            ? { ...DEFAULT_MOBILE_BRIDGE_SETTINGS, ...(record.settings as MobileBridgeSettings) }
            : { ...DEFAULT_MOBILE_BRIDGE_SETTINGS },
        devices: Array.isArray(record.devices) ? (record.devices as MobileBridgePersistedDevice[]) : [],
      } satisfies BridgeStoreShape
    },
    (store) => {
      settings.set(SETTINGS_CATEGORY, SETTINGS_KEY, {
        settings: store.settings,
        devices: store.devices,
      } satisfies BridgeStoreShape)
    },
  )
  service.setDeps(buildDeps(deps))
  return service
}

/** AgentEvent → 移动端子集（只留对话必需的字段） */
function toMobileEvent(event: AgentEvent): MobileBridgeEvent | null {
  const base = {
    id: event.id,
    seq: event.seq,
    turnId: event.turnId,
    timestamp: event.timestamp,
  }
  switch (event.type) {
    case 'user_message':
      return { ...base, type: 'user_message', content: event.content }
    case 'assistant_message':
      return {
        ...base,
        type: 'assistant_message',
        content: event.content,
        mode: event.mode,
        isFinal: event.isFinal,
        ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
      }
    case 'tool_call':
      return { ...base, type: 'tool_call', toolName: event.toolName, toolCallId: event.toolCallId }
    case 'tool_result':
      return {
        ...base,
        type: 'tool_result',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolStatus: event.status === 'success' ? 'success' : 'error',
      }
    case 'agent_status':
      return {
        ...base,
        type: 'agent_status',
        status: event.status,
        ...(event.message != null ? { statusMessage: event.message } : {}),
      }
    case 'agent_error':
      return { ...base, type: 'agent_error', statusMessage: event.message }
    default:
      return null
  }
}

/**
 * 解析 worktree workspace 的归属：worktree 会话在侧边栏归到原项目分组，
 * 移动端保持同一口径 —— 返回 base workspace id（非 worktree 返回 null）。
 */
function parseWorktreeBaseId(metaJson: string | null): string | null {
  if (metaJson == null) return null
  try {
    const meta = JSON.parse(metaJson) as { baseWorkspaceId?: string }
    return typeof meta.baseWorkspaceId === 'string' && meta.baseWorkspaceId ? meta.baseWorkspaceId : null
  } catch {
    return null
  }
}

function buildDeps(deps: MobileBridgeIpcDeps): MobileBridgeDeps {
  return {
    validateAccountToken: (token) => deps.validateAccountToken(token),

    listProjects: async (limit) => {
      const db = getDatabase()
      const workspaces = deps.getWorkspaceService().listWorkspaces(limit, 0, {})
      // 项目下会话数（排除归档；worktree 会话并入 base workspace，与桌面端侧边栏同口径）
      const countRows = db.raw
        .prepare(
          `SELECT project_id, COUNT(*) AS count FROM sessions WHERE archived_at IS NULL GROUP BY project_id`,
        )
        .all() as { project_id: string; count: number }[]
      const countByProject = new Map<string, number>()
      for (const row of countRows) {
        countByProject.set(row.project_id, row.count)
      }
      // workspace id → 是否 worktree（是则把计数并入 base 后从顶层剔除）
      const worktreeBase = new Map<string, string>()
      for (const workspace of workspaces) {
        const baseId = parseWorktreeBaseId(workspace.worktree_meta_json)
        if (baseId != null) worktreeBase.set(workspace.id, baseId)
      }
      const mergedCounts = new Map(countByProject)
      for (const [worktreeId, baseId] of worktreeBase) {
        const count = mergedCounts.get(worktreeId) ?? 0
        if (count > 0) mergedCounts.set(baseId, (mergedCounts.get(baseId) ?? 0) + count)
        mergedCounts.delete(worktreeId)
      }
      const projects: MobileBridgeProjectSummary[] = workspaces
        .filter((workspace) => !worktreeBase.has(workspace.id))
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          rootPath: workspace.root_path,
          projectKind: workspace.project_kind,
          pinnedAt: workspace.pinned_at,
          updatedAt: workspace.updated_at,
          sessionCount: mergedCounts.get(workspace.id) ?? 0,
        }))
      return { projects, total: projects.length }
    },

    listSessions: async (limit, projectId) => {
      const db = getDatabase()
      const { sessions, total } = new SessionRepository(db).list({
        limit,
        ...(projectId != null ? { projectId } : {}),
      })
      const previewStmt = db.raw.prepare(
        `SELECT event_json FROM agent_events
         WHERE session_id = ? AND event_type = 'user_message'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      const rows: MobileBridgeSessionSummary[] = sessions.map((row) => {
        let preview = ''
        try {
          const found = previewStmt.get(row.id) as { event_json?: string } | undefined
          if (found?.event_json != null) {
            const parsed = JSON.parse(found.event_json) as { content?: string }
            preview = (parsed.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
          }
        } catch {
          /* 预览缺失不阻塞列表 */
        }
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          updatedAt: row.updated_at,
          preview,
          projectId: row.project_id,
          pinnedAt: row.pinned_at,
        }
      })
      return { sessions: rows, total }
    },

    createSession: async (input) => deps.createMobileSession(input.title, input.projectId),

    updateSession: async (sessionId, patch) => {
      const result = await deps
        .getSessionService()
        .updateSession({ sessionId, ...patch })
      if (patch.archived !== undefined) {
        deps.getScheduledTaskService().setSessionArchived(sessionId, patch.archived)
      }
      const session = result.session
      return {
        id: session.id,
        title: session.title,
        status: session.status,
        updatedAt: session.updatedAt,
        preview: '',
        projectId: session.projectId,
        pinnedAt: session.pinnedAt ?? null,
      }
    },

    deleteSession: async (sessionId) => {
      // 关闭该 session 名下所有内置终端 PTY，再删数据（与 session:delete 行为对齐）
      deps.getTerminalService().disposeBySession(sessionId, { defer: true })
      return deps.getSessionService().deleteSession(sessionId)
    },

    getHistory: async (sessionId, limit) => {
      const history = await deps.getSessionService().getHistory({ sessionId, limit })
      const events: MobileBridgeEvent[] = []
      for (const event of history.events) {
        const mapped = toMobileEvent(event)
        if (mapped != null) events.push(mapped)
      }
      // 运行中 = 任一非终态 agent_status（AgentStatusValue 无 'running' 字面量）
      const running = history.events.some(
        (event) =>
          event.type === 'agent_status' &&
          (event.status === 'thinking' ||
            event.status === 'calling_tool' ||
            event.status === 'waiting_permission' ||
            event.status === 'waiting_user'),
      )
      return { events, running }
    },

    submitTurn: async (sessionId, text) => {
      const result = await deps.getSessionService().submitTurn({
        sessionId,
        message: text,
        turnSource: 'remote_user',
      })
      return { turnId: result.turnId }
    },

    cancelTurn: async (sessionId) => {
      await deps.getSessionService().cancelTurn(sessionId)
    },

    getDesktopInfo: () => ({
      name: app.getName(),
      version: app.getVersion(),
    }),
  }
}

export function registerMobileBridgeIpc(deps: MobileBridgeIpcDeps): void {
  const bridge = getService(deps)

  typedIpcHandle('mobile-bridge:get-status', async () => bridge.getStatus())

  typedIpcHandle('mobile-bridge:update-settings', async (request) => {
    const current = bridge.getStatus().settings
    const next: MobileBridgeSettings = {
      enabled: request.enabled ?? current.enabled,
      port: request.port ?? current.port,
    }
    if (!Number.isInteger(next.port) || next.port < 0 || next.port > 65535) {
      throw new Error('端口必须是 0-65535 的整数（0 表示随机）')
    }
    await bridge.applySettings(next)
    return bridge.getStatus()
  })

  typedIpcHandle('mobile-bridge:revoke-device', async (request) => {
    bridge.revokeDevice(request.deviceId)
    return bridge.getStatus()
  })

  // 按设置启动（关闭态不监听；端口冲突等错误只记日志，不阻塞启动序列）
  void bridge.start().catch((error) => {
    log.warn(
      `mobile bridge start failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  log.info('mobile bridge ipc registered')
}

/** 测试辅助：重置单例 */
export function __resetMobileBridgeServiceForTesting(): void {
  service = null
}
