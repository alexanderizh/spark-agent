/**
 * Checkpoint 与会话事件清理（P1-W3-S3 迁出，2026-08-19）。
 *
 * 承接 git checkpoint 快照/还原/裁剪、会话事件批量清理、消息删除完整性
 * 校验等只读多写少的会话维护能力。对 SessionService 的依赖（事件写入漏斗、
 * 执行器内存清理、活跃会话枚举）经窄接口 SessionCheckpointHost 注入。
 */
import crypto from 'node:crypto'
import { EventRepository, SessionRepository, WorkspaceRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import type { CheckpointRestoreResult, CheckpointSnapshot } from '../../core/index.js'
import { CheckpointGitService } from '../checkpoint-git.service.js'
import { ensureSessionWorkspaceRootPathSync } from '../session-workspace-root.js'
import { listSessionCheckpointsFromEvents } from './session-pure-utils.js'

const log = createLogger('session.checkpoint')

/** 每会话最多保留的 checkpoint 数量（超出按最旧裁剪）。 */
export const MAX_CHECKPOINTS_PER_SESSION = 20

/** checkpoint/事件清理模块对 SessionService 的窄依赖面。 */
export interface SessionCheckpointHost {
  /** 经唯一事件写入漏斗落库 checkpoint 事件（seq 由漏斗分配）。 */
  emitCheckpointEvent(
    sessionId: string,
    turnId: string,
    event: AgentEvent,
    eventRepo: EventRepository,
  ): void
  /** 终止并清理会话的运行中执行器与内存态，返回此前是否在跑。 */
  clearSessionMemoryForEvents(sessionId: string): boolean
  /** 当前所有活跃 turn 的会话 id（还原安全拦截用）。 */
  listActiveSessionIds(): string[]
}

export class SessionCheckpointManager {
  private checkpointGitService: CheckpointGitService | null = null
  private readonly pendingSessionEventCleanups = new Set<string>()
  private orphanEventCleanupPending = false

  constructor(
    private readonly db: SparkDatabase,
    private readonly host: SessionCheckpointHost,
  ) {}

  cleanupSessionEventsInBackground(sessionId: string): void {
    if (this.pendingSessionEventCleanups.has(sessionId)) return
    this.pendingSessionEventCleanups.add(sessionId)

    this.runEventCleanupInBatches({
      label: 'session event',
      context: { sessionId },
      deleteBatch: (repo) => repo.deleteBySessionBatch(sessionId, 1000),
      onFinish: () => this.pendingSessionEventCleanups.delete(sessionId),
    })
  }

  cleanupOrphanedSessionEventsInBackground(): void {
    if (this.orphanEventCleanupPending) return
    this.orphanEventCleanupPending = true

    this.runEventCleanupInBatches({
      label: 'orphan session event',
      context: {},
      deleteBatch: (repo) => repo.deleteOrphanedSessionEventsBatch(1000),
      onFinish: () => {
        this.orphanEventCleanupPending = false
      },
    })
  }

  private runEventCleanupInBatches(params: {
    label: string
    context: Record<string, unknown>
    deleteBatch: (repo: EventRepository) => number
    onFinish: () => void
  }): void {
    const eventRepo = new EventRepository(this.db)
    let totalDeleted = 0
    const cleanupBatch = () => {
      let shouldFinish = false
      try {
        const deleted = params.deleteBatch(eventRepo)
        totalDeleted += deleted
        if (deleted > 0) {
          setTimeout(cleanupBatch, 0)
          return
        }
        shouldFinish = true
        if (totalDeleted > 0) {
          log.info(`${params.label} cleanup completed`, {
            ...params.context,
            deleted: totalDeleted,
          })
        }
      } catch (err) {
        shouldFinish = true
        log.warn(`${params.label} cleanup failed`, {
          ...params.context,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (shouldFinish) {
          params.onFinish()
        }
      }
    }

    setTimeout(cleanupBatch, 0)
  }

  async clearEvents(sessionId: string): Promise<{ cleared: boolean }> {
    const eventRepo = new EventRepository(this.db)
    // 清空历史同样要先终止在跑的执行器。否则它会成为孤儿：UI 认为会话已空闲、
    // 用户随即再发一条消息，两个 executor 就会并发抢同一个 cwd / 同一个会话。
    const wasRunning = this.host.clearSessionMemoryForEvents(sessionId)
    eventRepo.deleteBySession(sessionId)
    if (wasRunning) {
      // 执行器已被杀，DB 里的 running 状态必须落回 idle，否则重启恢复流程会把
      // 这个会话当成"上次崩溃残留"再处理一遍。
      new SessionRepository(this.db).updateStatus(sessionId, 'idle')
      log.info('cancelled running executor before clearing session events', { sessionId })
    }
    return { cleared: true }
  }

  async deleteMessage(sessionId: string, eventIds: string[]): Promise<{ deleted: number }> {
    if (eventIds.length === 0) return { deleted: 0 }
    const eventRepo = new EventRepository(this.db)

    // 完整性校验：单条 user_message / assistant_message 不能硬删。
    //
    // 历史回放（queryBySession / SDK resume）按事件序列重建对话轮次；
    // 删掉一条 user_message 而留下它对应的 assistant_message（或反过来），
    // 会让后续 turn 的边界错乱，送给模型的历史就是坏的——模型可能把上一轮的
    // 回答当成新的用户输入。要"撤回"必须按整轮删，或用 message deletion marker
    // 软隐藏（这里走硬删路径，所以按轮次拦截）。
    const placeholders = eventIds.map(() => '?').join(',')
    const rows = this.db.raw
      .prepare(
        `SELECT id, turn_id, event_type
         FROM agent_events
         WHERE session_id = ? AND id IN (${placeholders})`,
      )
      .all(sessionId, ...eventIds) as Array<{
      id: string
      turn_id: string | null
      event_type: string
    }>

    if (rows.length === 0) return { deleted: 0 }

    const messageIdTypes = new Set(['user_message', 'assistant_message'])
    const partialTurnDeletes = rows.filter(
      (row) => messageIdTypes.has(row.event_type) && row.turn_id != null,
    )

    if (partialTurnDeletes.length > 0) {
      // 把同一轮的所有消息事件一起纳入删除范围，避免留下半截轮次。
      // 仍允许删纯工具事件（tool_call / tool_result / file_change 等）——
      // 它们不影响轮次边界，删了只是少一段工具记录。
      const turnIds = Array.from(
        new Set(
          partialTurnDeletes.map((row) => row.turn_id).filter((id): id is string => id != null),
        ),
      )
      if (turnIds.length > 0) {
        const turnPlaceholders = turnIds.map(() => '?').join(',')
        const turnRows = this.db.raw
          .prepare(
            `SELECT id FROM agent_events
             WHERE session_id = ? AND turn_id IN (${turnPlaceholders})
               AND event_type IN ('user_message', 'assistant_message')`,
          )
          .all(sessionId, ...turnIds) as Array<{ id: string }>
        const expandedIds = new Set([...eventIds, ...turnRows.map((r) => r.id)])
        eventIds = Array.from(expandedIds)
      }
    }

    const count = eventRepo.deleteEventsByIds(eventIds)
    return { deleted: count }
  }

  /**
   * 列出会话的所有还原点（代码检查点），最近在前。
   * 供 Checkpoint 时间线面板的「按会话撤回代码」视图使用。
   */
  listCheckpoints(sessionId: string): CheckpointSnapshot[] {
    const eventRepo = new EventRepository(this.db)
    // queryBySession 以 seq DESC 返回，即最近的还原点在前，符合时间线面板展示需要
    return listSessionCheckpointsFromEvents(eventRepo, sessionId)
  }

  // ── Checkpoint（git 方案：尊重 .gitignore、还原非破坏性，替代失效的 SDK rewindFiles）──
  // （原 restoreCheckpointViaRewind —— resume + Query.rewindFiles 的 SDK 还原路径 —— 已被
  //   git 方案整体替代且无任何调用方，W2-D4 清理删除；其 new ClaudeSDKExecutor() 的
  //   硬编码正是绕过 engineRegistry 的侧门遗留。）

  private getCheckpointGitService(): CheckpointGitService {
    if (this.checkpointGitService == null) this.checkpointGitService = new CheckpointGitService()
    return this.checkpointGitService
  }

  /** 解析会话的工作区根目录（无则返回 null）。 */
  private resolveSessionWorkspaceRoot(sessionId: string): string | null {
    const workspaceIds = new SessionRepository(this.db).getWorkspaceIds(sessionId)
    if (workspaceIds.length === 0) return null
    const ws = new WorkspaceRepository(this.db).get(workspaceIds[0] ?? '')
    return ws == null ? null : ensureSessionWorkspaceRootPathSync(ws, sessionId)
  }

  /** 读会话 checkpoint 开关（metadata.checkpointEnabled，默认关）。 */
  getSessionCheckpointEnabled(sessionId: string): boolean {
    return new SessionRepository(this.db).getMetadata(sessionId).checkpointEnabled === true
  }

  /** 功能可用性：仅 git 仓库工作区可用（非 git 前端隐藏入口）。 */
  async getSessionCheckpointAvailable(sessionId: string): Promise<boolean> {
    const root = this.resolveSessionWorkspaceRoot(sessionId)
    if (root == null) return false
    return this.getCheckpointGitService().isGitRepo(root)
  }

  /** 设置会话 checkpoint 开关（写 metadata，浅合并）。 */
  setSessionCheckpointEnabled(sessionId: string, enabled: boolean): boolean {
    const repo = new SessionRepository(this.db)
    if (repo.get(sessionId) == null) return false
    repo.patchMetadata(sessionId, { checkpointEnabled: enabled })
    if (!enabled) this.getCheckpointGitService().resetGatingBaseline(sessionId)
    log.info('checkpoint toggle', { sessionId, enabled })
    return true
  }

  /**
   * 智能采集：会话开启 checkpoint 且工作区为 git 仓库时，在本轮（改文件前）尝试快照。
   * git 按 tree SHA 去重：工作区相对上个 checkpoint 无变化则不新建。失败不阻塞 turn。
   */
  async maybeCaptureCheckpoint(
    sessionId: string,
    turnId: string,
    workspaceRootPath: string,
    eventRepo: EventRepository,
    label: string,
  ): Promise<void> {
    try {
      if (!this.getSessionCheckpointEnabled(sessionId)) return
      const svc = this.getCheckpointGitService()
      if (!(await svc.isGitRepo(workspaceRootPath))) return
      const checkpointId = crypto.randomUUID()
      const snap = await svc.snapshot(workspaceRootPath, sessionId, checkpointId, label)
      if (!snap.created) return // 无变化，跳过
      this.host.emitCheckpointEvent(
        sessionId,
        turnId,
        {
          id: crypto.randomUUID(),
          type: 'checkpoint',
          sessionId,
          turnId,
          timestamp: new Date().toISOString(),
          seq: 0,
          checkpointId,
          label: label.slice(0, 80),
        },
        eventRepo,
      )
      log.info('checkpoint captured', { sessionId, checkpointId, files: snap.fileCount })
      const ids = listSessionCheckpointsFromEvents(eventRepo, sessionId).map((c) => c.checkpointId)
      await svc.prune(workspaceRootPath, sessionId, ids.slice(0, MAX_CHECKPOINTS_PER_SESSION))
    } catch (err) {
      log.warn('checkpoint capture failed (non-fatal)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** 用 git 还原 checkpoint：安全拦截（同工作区有其他会话在跑则阻止）+ 还原前自动备份 + 非破坏性 restore。 */
  async restoreCheckpointViaSnapshot(
    sessionId: string,
    checkpointRef: string,
  ): Promise<CheckpointRestoreResult> {
    log.info('checkpoint restore: attempt', { sessionId, checkpointRef })
    const eventRepo = new EventRepository(this.db)
    const checkpoints = listSessionCheckpointsFromEvents(eventRepo, sessionId)
    const checkpoint = checkpoints.find(
      (item) => item.checkpointId === checkpointRef || item.checkpointId.endsWith(checkpointRef),
    )
    if (checkpoint == null) throw new Error(`Checkpoint not found: ${checkpointRef}`)

    const workspaceRootPath = this.resolveSessionWorkspaceRoot(sessionId)
    if (workspaceRootPath == null) throw new Error('会话没有打开的工作区，无法还原。')
    const svc = this.getCheckpointGitService()
    if (!(await svc.isGitRepo(workspaceRootPath))) {
      throw new Error('当前工作区不是 git 仓库，代码还原点不可用。')
    }
    if (!(await svc.hasCheckpoint(workspaceRootPath, sessionId, checkpoint.checkpointId))) {
      throw new Error(`还原点已失效或被清理：${checkpoint.checkpointId}`)
    }

    // 安全拦截（#4）：同一工作区若有其他会话正在跑 turn，阻止还原以免影响它们。
    const conflicting = this.findOtherActiveSessionsOnWorkspace(sessionId, workspaceRootPath)
    if (conflicting.length > 0) {
      throw new Error(
        `已阻止还原：同一项目目录下有其他会话正在运行（${conflicting.length} 个）。还原会改动共享文件、影响它们。请先停止这些会话再还原。`,
      )
    }

    // 还原前自动备份当前态，使本次还原可被再次还原（撤销）。
    try {
      const undoId = crypto.randomUUID()
      const undo = await svc.snapshot(
        workspaceRootPath,
        sessionId,
        undoId,
        `还原前自动备份（${new Date().toLocaleString()}）`,
      )
      if (undo.created) {
        const undoTurnId = crypto.randomUUID()
        this.host.emitCheckpointEvent(
          sessionId,
          undoTurnId,
          {
            id: crypto.randomUUID(),
            type: 'checkpoint',
            sessionId,
            turnId: undoTurnId,
            timestamp: new Date().toISOString(),
            seq: 0,
            checkpointId: undoId,
            label: '还原前自动备份',
          },
          eventRepo,
        )
      }
    } catch (err) {
      log.warn('checkpoint pre-restore backup failed (non-fatal)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const outcome = await svc.restore(workspaceRootPath, sessionId, checkpoint.checkpointId)
    log.info('checkpoint restore: done', {
      sessionId,
      checkpointId: checkpoint.checkpointId,
      restored: outcome.restoredFiles.length,
    })
    return {
      checkpointId: checkpoint.checkpointId,
      restoredFiles: outcome.restoredFiles,
      missingFiles: [],
    }
  }

  /** 找出「同一工作区目录、且当前有活跃 turn」的其他会话（用于还原安全拦截）。 */
  private findOtherActiveSessionsOnWorkspace(
    sessionId: string,
    workspaceRootPath: string,
  ): string[] {
    const result: string[] = []
    for (const otherId of this.host.listActiveSessionIds()) {
      if (otherId === sessionId) continue
      if (this.resolveSessionWorkspaceRoot(otherId) === workspaceRootPath) result.push(otherId)
    }
    return result
  }
}
