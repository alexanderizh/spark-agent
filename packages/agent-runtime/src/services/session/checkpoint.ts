/**
 * Checkpoint 与会话事件清理（P1-W3-S3 迁出，2026-08-19）。
 *
 * 承接 git checkpoint 快照/还原/裁剪、会话事件批量清理、消息删除完整性
 * 校验等只读多写少的会话维护能力。对 SessionService 的依赖（事件写入漏斗、
 * 执行器内存清理、活跃会话枚举）经窄接口 SessionCheckpointHost 注入。
 */
import crypto from 'node:crypto'
import {
  EventRepository,
  SessionRepository,
  SessionSummaryRepository,
  WorkspaceRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import type { CheckpointRestoreResult, CheckpointSnapshot } from '../../core/index.js'
import { CheckpointGitService } from '../checkpoint-git.service.js'
import { ensureSessionWorkspaceRootPathSync } from '../session-workspace-root.js'
import { listSessionCheckpointsFromEvents } from './session-pure-utils.js'
import { createCodexNativeThreadClearPatch } from './codex-native-thread-binding.js'
import { createSparkLedgerClearPatch } from './spark-ledger-binding.js'

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
  /** 清除被撤回轮次的进程内 usage 累计，避免替代轮次继承旧基线。 */
  clearUsageLedgerTurnState(sessionId: string, turnId?: string): void
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
   * 撤回最新一轮可见用户对话，为“编辑后重新发送”建立干净的上下文边界。
   *
   * 这里故意不修改工作区文件：与 Claude/Codex 的默认消息编辑语义一致。只允许最新、
   * 非内部隐藏且当前不再运行的 turn，避免截断队列、Goal 内部续轮或活跃执行器。
   */
  async rewindLastTurnForEdit(
    sessionId: string,
    turnId: string,
  ): Promise<{
    retractedEventIds: string[]
    turnCount: number
    logicalMessageCount: number
  }> {
    const sessionRepo = new SessionRepository(this.db)
    const session = sessionRepo.get(sessionId)
    if (session == null) throw new Error('会话不存在或已删除')
    if (session.status === 'running' || this.host.listActiveSessionIds().includes(sessionId)) {
      throw new Error('Agent 正在执行，请结束本轮后再编辑消息')
    }

    const pending = this.db.raw
      .prepare(
        `SELECT 1 FROM turn_requests
         WHERE session_id = ? AND status IN ('accepted', 'running')
         LIMIT 1`,
      )
      .get(sessionId)
    if (pending != null) throw new Error('会话仍有待处理消息，请先处理或清空队列')

    const eventRepo = new EventRepository(this.db)
    const rows = eventRepo.queryAllBySession(sessionId)
    const turnRows = rows.filter((row) => row.turn_id === turnId)
    const latestUserRow = [...rows].reverse().find((row) => row.event_type === 'user_message')
    const turnRequest = this.db.raw
      .prepare('SELECT status FROM turn_requests WHERE id = ? AND session_id = ?')
      .get(turnId, sessionId) as { status: string } | undefined
    const cancelledBeforeUserMessagePersisted =
      turnRequest?.status === 'cancelled' &&
      !turnRows.some((row) => row.event_type === 'user_message') &&
      turnRows.some((row) => {
        if (row.event_type !== 'agent_status') return false
        const event = JSON.parse(row.event_json) as Partial<AgentEvent>
        return event.type === 'agent_status' && event.status === 'cancelled'
      })
    if (latestUserRow?.turn_id !== turnId && !cancelledBeforeUserMessagePersisted) {
      throw new Error('只能编辑当前会话最后一轮用户消息')
    }
    if (latestUserRow?.turn_id === turnId) {
      const latestUserEvent = JSON.parse(latestUserRow.event_json) as AgentEvent
      if (
        latestUserEvent.type !== 'user_message' ||
        latestUserEvent.userMessageVisibility === 'hidden'
      ) {
        throw new Error('内部续轮消息不能编辑')
      }
    }

    const turnSeqs = turnRows
      .map((row) => row.seq)
      .filter((seq): seq is number => typeof seq === 'number')
    if (turnSeqs.length === 0) throw new Error('找不到要编辑的会话轮次')
    const firstTurnSeq = Math.min(...turnSeqs)
    const laterTurn = rows.find(
      (row) =>
        row.seq != null && row.seq > firstTurnSeq && row.turn_id != null && row.turn_id !== turnId,
    )
    if (laterTurn != null) throw new Error('只能编辑当前会话最后一轮用户消息')

    const retractedEventIds = turnRows.map((row) => row.id)
    if (retractedEventIds.length === 0) throw new Error('找不到要编辑的会话轮次')

    // 即便会话已经 idle，也清掉 SDK resume、队列闸门、团队运行态和 seq 缓存；下一次
    // submit-turn 必须从删减后的事件历史重新构建，而不能沿用旧轮的进程内上下文。
    this.host.clearSessionMemoryForEvents(sessionId)
    const remove = this.db.raw.transaction(() => {
      // 原生 Claude/Codex/Spark 会话各自持有历史；仅删 agent_events 会让下一轮继续
      // resume 到含旧 turn 的上游上下文。轮换 generation 并清空 ledger binding，强制
      // 所有 adapter 从删减后的 Spark 历史创建新原生会话。
      sessionRepo.patchMetadata(
        sessionId,
        createCodexNativeThreadClearPatch(sessionRepo.getMetadata(sessionId)),
      )
      sessionRepo.patchMetadata(
        sessionId,
        createSparkLedgerClearPatch(sessionRepo.getMetadata(sessionId)),
      )
      // 摘要是事件历史的派生缓存，可能包含刚撤回的文本；全部作废后由后续 turn
      // 按保留下来的历史重新生成，避免 fresh runtime 仍注入旧轮内容。
      new SessionSummaryRepository(this.db).deleteBySession(sessionId)
      eventRepo.deleteTurn(sessionId, turnId)
      this.db.raw
        .prepare('DELETE FROM turn_requests WHERE id = ? AND session_id = ?')
        .run(turnId, sessionId)
      this.db.raw
        .prepare('DELETE FROM turn_perf_metrics WHERE session_id = ? AND turn_id = ?')
        .run(sessionId, turnId)
      this.db.raw
        .prepare(
          `UPDATE sessions
           SET status = 'idle',
               metadata_json = json_remove(metadata_json, '$.lastRunOutcome'),
               updated_at = ?
           WHERE id = ?`,
        )
        .run(new Date().toISOString(), sessionId)
    })
    remove()
    this.host.clearUsageLedgerTurnState(sessionId, turnId)

    const updated = sessionRepo.findByIdOrFail(sessionId)
    log.info('rewound latest turn for user edit', {
      sessionId,
      turnId,
      retractedEvents: retractedEventIds.length,
    })
    return {
      retractedEventIds,
      turnCount: updated.turn_count,
      logicalMessageCount: updated.logical_message_count,
    }
  }

  /**
   * 列出会话的所有还原点（工作区快照），最近在前。
   * 供 Checkpoint 时间线面板的「工作区快照」视图使用。
   */
  listCheckpoints(sessionId: string): CheckpointSnapshot[] {
    const eventRepo = new EventRepository(this.db)
    // queryBySession 以 seq DESC 返回，即最近的还原点在前，符合时间线面板展示需要
    return listSessionCheckpointsFromEvents(eventRepo, sessionId)
  }

  /**
   * 列出会话还原点并标注可还原性（IPC 专用，异步验证 git ref 仍存在）。
   * - provider_sdk（引擎快照）不可经宿主还原，restorable=false；
   * - workspace_snapshot 逐项验证 Spark ref，失效项 restorable=false 由 UI 置灰；
   * - 无 git 工作区（如全部快照引用已随仓库移除）不在此处报错，仅全部置 false。
   */
  async listCheckpointsWithStatus(
    sessionId: string,
  ): Promise<Array<CheckpointSnapshot & { restorable: boolean }>> {
    const checkpoints = this.listCheckpoints(sessionId)
    if (checkpoints.length === 0) return []
    const svc = this.getCheckpointGitService()
    const roots = this.resolveSessionWorkspaceRoots(sessionId)
    return Promise.all(
      checkpoints.map(async (cp) => {
        if (cp.checkpointKind === 'provider_sdk') return { ...cp, restorable: false }
        const target = this.resolveCheckpointWorkspaceRoot(cp, roots)
        const restorable =
          target != null &&
          (await svc.isGitRepo(target.rootPath)) &&
          (await svc.hasCheckpoint(target.rootPath, sessionId, cp.checkpointId))
        return { ...cp, restorable }
      }),
    )
  }

  // ── Checkpoint（git 方案：尊重 .gitignore、还原非破坏性，替代失效的 SDK rewindFiles）──
  // （原 restoreCheckpointViaRewind —— resume + Query.rewindFiles 的 SDK 还原路径 —— 已被
  //   git 方案整体替代且无任何调用方，W2-D4 清理删除；其 new ClaudeSDKExecutor() 的
  //   硬编码正是绕过 engineRegistry 的侧门遗留。）
  // Phase 0（2026-09-28）：语义拆分为 workspace_snapshot / provider_sdk；多工作区逐一
  // 快照与还原；还原前 dry-run 预览；自动备份失败默认终止（fail-closed，--force 逃生门）；
  // 还原后校验并审计。见 2026-09-10 长程任务断点继续方案 §12。

  private getCheckpointGitService(): CheckpointGitService {
    if (this.checkpointGitService == null) this.checkpointGitService = new CheckpointGitService()
    return this.checkpointGitService
  }

  /** 解析会话的工作区根目录（无则返回 null）。 */
  private resolveSessionWorkspaceRoot(sessionId: string): string | null {
    const roots = this.resolveSessionWorkspaceRoots(sessionId)
    return roots[0]?.rootPath ?? null
  }

  /** 解析会话全部工作区（Phase 0 §12.2：多 Workspace 逐一处理，不再只取第一个）。 */
  private resolveSessionWorkspaceRoots(
    sessionId: string,
  ): Array<{ workspaceId: string; rootPath: string }> {
    const workspaceIds = new SessionRepository(this.db).getWorkspaceIds(sessionId)
    const repo = new WorkspaceRepository(this.db)
    const roots: Array<{ workspaceId: string; rootPath: string }> = []
    for (const workspaceId of workspaceIds) {
      const ws = repo.get(workspaceId)
      if (ws == null) continue
      roots.push({ workspaceId, rootPath: ensureSessionWorkspaceRootPathSync(ws, sessionId) })
    }
    return roots
  }

  /** 读会话 checkpoint 开关（metadata.checkpointEnabled，默认关）。 */
  getSessionCheckpointEnabled(sessionId: string): boolean {
    return new SessionRepository(this.db).getMetadata(sessionId).checkpointEnabled === true
  }

  /** 功能可用性：任一工作区是 git 仓库即可用（非 git 前端隐藏入口）。 */
  async getSessionCheckpointAvailable(sessionId: string): Promise<boolean> {
    const svc = this.getCheckpointGitService()
    for (const { rootPath } of this.resolveSessionWorkspaceRoots(sessionId)) {
      if (await svc.isGitRepo(rootPath)) return true
    }
    return false
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
   * 智能采集：会话开启 checkpoint 时，在本轮（改文件前）对每个 git 仓库工作区逐一快照
   * （每个工作区独立 checkpointId + 一条事件，带 workspaceId/treeSha/fileCount；
   * 独立 ID 保证按 checkpointId 的定位/预览/还原唯一命中对应工作区）。
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
      let roots = this.resolveSessionWorkspaceRoots(sessionId)
      if (roots.length === 0 && workspaceRootPath.length > 0) {
        // 防御：会话未登记工作区但执行器带根目录（理论不可达），保留旧行为。
        roots = [{ workspaceId: '', rootPath: workspaceRootPath }]
      }
      let captured = 0
      for (const { workspaceId, rootPath } of roots) {
        if (!(await svc.isGitRepo(rootPath))) continue
        const checkpointId = crypto.randomUUID()
        const snap = await svc.snapshot(rootPath, sessionId, checkpointId, label)
        if (!snap.created) continue // 该工作区无变化，跳过
        captured += 1
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
            checkpointKind: 'workspace_snapshot',
            ...(workspaceId.length > 0 ? { workspaceId } : {}),
            treeSha: snap.treeSha,
            fileCount: snap.fileCount,
          },
          eventRepo,
        )
        log.info('checkpoint captured', {
          sessionId,
          checkpointId,
          workspaceId,
          files: snap.fileCount,
        })
      }
      if (captured === 0) return
      const ids = listSessionCheckpointsFromEvents(eventRepo, sessionId).map((c) => c.checkpointId)
      const keep = Array.from(new Set(ids.slice(0, MAX_CHECKPOINTS_PER_SESSION)))
      for (const { rootPath } of roots) {
        if (!(await svc.isGitRepo(rootPath))) continue
        await svc.prune(rootPath, sessionId, keep)
      }
    } catch (err) {
      log.warn('checkpoint capture failed (non-fatal)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * 定位某条快照记录对应的工作区根目录。
   * 新事件带 workspaceId 精确匹配；旧事件（无 workspaceId）回退主工作区（第一个）。
   */
  private resolveCheckpointWorkspaceRoot(
    checkpoint: CheckpointSnapshot,
    roots: Array<{ workspaceId: string; rootPath: string }>,
  ): { workspaceId: string; rootPath: string } | null {
    if (checkpoint.workspaceId != null) {
      const match = roots.find((r) => r.workspaceId === checkpoint.workspaceId)
      if (match != null) return match
    }
    return roots[0] ?? null
  }

  /** 找出 checkpoint 事件（含同 id 多工作区条目）对应的全部去重工作区根。 */
  private resolveCheckpointWorkspaceRoots(
    checkpoints: CheckpointSnapshot[],
    sessionId: string,
  ): Array<{ workspaceId: string; rootPath: string }> {
    const roots = this.resolveSessionWorkspaceRoots(sessionId)
    const resolved: Array<{ workspaceId: string; rootPath: string }> = []
    const seen = new Set<string>()
    for (const checkpoint of checkpoints) {
      const target = this.resolveCheckpointWorkspaceRoot(checkpoint, roots)
      if (target == null || seen.has(target.rootPath)) continue
      seen.add(target.rootPath)
      resolved.push(target)
    }
    return resolved
  }

  /**
   * 按需拉取快照的完整受控文件清单（多工作区聚合）。
   * 事件只存 fileCount 不存全量清单，UI 展开时经此接口从 git ref 实时读取。
   */
  async listCheckpointFiles(
    sessionId: string,
    checkpointRef: string,
  ): Promise<{ checkpointId: string; filePaths: string[] }> {
    const eventRepo = new EventRepository(this.db)
    const checkpoints = listSessionCheckpointsFromEvents(eventRepo, sessionId)
    const matched = checkpoints.filter(
      (item) => item.checkpointId === checkpointRef || item.checkpointId.endsWith(checkpointRef),
    )
    const checkpoint = matched[0]
    if (checkpoint == null) throw new Error(`Checkpoint not found: ${checkpointRef}`)
    const svc = this.getCheckpointGitService()
    const targets = this.resolveCheckpointWorkspaceRoots(matched, sessionId)
    const filePaths: string[] = []
    for (const { rootPath } of targets) {
      if (!(await svc.isGitRepo(rootPath))) continue
      filePaths.push(
        ...(await svc.listSnapshotFiles(rootPath, sessionId, checkpoint.checkpointId)),
      )
    }
    return { checkpointId: checkpoint.checkpointId, filePaths }
  }

  /**
   * 还原预览（dry-run）：对快照涉及的每个工作区执行 previewRestore 并聚合分组。
   * 供 UI 在确认还原前展示「将修改/重建/保留/不影响」四组文件。
   */
  async previewCheckpointRestore(
    sessionId: string,
    checkpointRef: string,
  ): Promise<{
    checkpointId: string
    workspaceId?: string
    modifiedFiles: string[]
    recreatedFiles: string[]
    unchangedFiles: string[]
    newFilesKept: string[]
  }> {
    const eventRepo = new EventRepository(this.db)
    const checkpoints = listSessionCheckpointsFromEvents(eventRepo, sessionId)
    const matched = checkpoints.filter(
      (item) => item.checkpointId === checkpointRef || item.checkpointId.endsWith(checkpointRef),
    )
    const checkpoint = matched[0]
    if (checkpoint == null) throw new Error(`Checkpoint not found: ${checkpointRef}`)
    if (checkpoint.checkpointKind === 'provider_sdk') {
      throw new Error('引擎原生快照不支持宿主还原，请使用工作区快照。')
    }
    const svc = this.getCheckpointGitService()
    const targets = this.resolveCheckpointWorkspaceRoots(matched, sessionId)
    if (targets.length === 0) throw new Error('会话没有打开的工作区，无法预览还原。')

    const merged = {
      checkpointId: checkpoint.checkpointId,
      ...(checkpoint.workspaceId != null ? { workspaceId: checkpoint.workspaceId } : {}),
      modifiedFiles: [] as string[],
      recreatedFiles: [] as string[],
      unchangedFiles: [] as string[],
      newFilesKept: [] as string[],
    }
    for (const { rootPath } of targets) {
      if (!(await svc.isGitRepo(rootPath))) {
        throw new Error('当前工作区不是 git 仓库，工作区快照不可用。')
      }
      if (!(await svc.hasCheckpoint(rootPath, sessionId, checkpoint.checkpointId))) {
        throw new Error(`还原点已失效或被清理：${checkpoint.checkpointId}`)
      }
      const preview = await svc.previewRestore(rootPath, sessionId, checkpoint.checkpointId)
      merged.modifiedFiles.push(...preview.modifiedFiles)
      merged.recreatedFiles.push(...preview.recreatedFiles)
      merged.unchangedFiles.push(...preview.unchangedFiles)
      merged.newFilesKept.push(...preview.newFilesKept)
    }
    return merged
  }

  /**
   * 用 git 还原工作区快照：安全拦截（同工作区有其他会话在跑则阻止）+ 还原前自动备份
   * + 非破坏性 restore + 还原后校验。
   * Phase 0 §12.2：自动备份失败默认终止还原（fail-closed）；opts.force=true 时用户
   * 显式强制才继续。多工作区快照逐一还原，任一失败即中止并报告。
   */
  async restoreCheckpointViaSnapshot(
    sessionId: string,
    checkpointRef: string,
    opts?: { force?: boolean },
  ): Promise<CheckpointRestoreResult> {
    const force = opts?.force === true
    log.info('checkpoint restore: attempt', { sessionId, checkpointRef, force })
    const eventRepo = new EventRepository(this.db)
    const checkpoints = listSessionCheckpointsFromEvents(eventRepo, sessionId)
    const matched = checkpoints.filter(
      (item) => item.checkpointId === checkpointRef || item.checkpointId.endsWith(checkpointRef),
    )
    const checkpoint = matched[0]
    if (checkpoint == null) throw new Error(`Checkpoint not found: ${checkpointRef}`)
    if (checkpoint.checkpointKind === 'provider_sdk') {
      throw new Error('引擎原生快照不支持宿主还原，请使用工作区快照。')
    }

    const targets = this.resolveCheckpointWorkspaceRoots(matched, sessionId)
    if (targets.length === 0) throw new Error('会话没有打开的工作区，无法还原。')
    const svc = this.getCheckpointGitService()
    for (const { rootPath } of targets) {
      if (!(await svc.isGitRepo(rootPath))) {
        throw new Error('当前工作区不是 git 仓库，工作区快照不可用。')
      }
      if (!(await svc.hasCheckpoint(rootPath, sessionId, checkpoint.checkpointId))) {
        throw new Error(`还原点已失效或被清理：${checkpoint.checkpointId}`)
      }
    }

    // 安全拦截（#4）：任一涉及工作区若有其他会话正在跑 turn，阻止还原以免影响它们。
    for (const { rootPath } of targets) {
      const conflicting = this.findOtherActiveSessionsOnWorkspace(sessionId, rootPath)
      if (conflicting.length > 0) {
        throw new Error(
          `已阻止还原：同一项目目录下有其他会话正在运行（${conflicting.length} 个）。还原会改动共享文件、影响它们。请先停止这些会话再还原。`,
        )
      }
    }

    // 还原前自动备份当前态，使本次还原可被再次还原（撤销）。
    // fail-closed：备份失败默认终止，用户显式 --force 才继续（Phase 0 §12.2）。
    const backupFailedRoots: string[] = []
    for (const { workspaceId, rootPath } of targets) {
      try {
        const undoId = crypto.randomUUID()
        const undo = await svc.snapshot(
          rootPath,
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
              checkpointKind: 'workspace_snapshot',
              ...(workspaceId.length > 0 ? { workspaceId } : {}),
              treeSha: undo.treeSha,
              fileCount: undo.fileCount,
            },
            eventRepo,
          )
        }
      } catch (err) {
        backupFailedRoots.push(rootPath)
        log.warn('checkpoint pre-restore backup failed', {
          sessionId,
          rootPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (backupFailedRoots.length > 0 && !force) {
      throw new Error(
        `还原前自动备份失败（${backupFailedRoots.length} 个工作区），已终止还原以保证可撤销。` +
          '可稍后重试，或使用 `/checkpoint restore <id> --force` 显式跳过备份强制还原。',
      )
    }

    // 逐一还原并聚合；任一工作区还原失败即中止（后续工作区保持原状，便于重试）。
    const restoredFiles: string[] = []
    let verified = true
    for (const { workspaceId, rootPath } of targets) {
      const outcome = await svc.restore(rootPath, sessionId, checkpoint.checkpointId)
      restoredFiles.push(...outcome.restoredFiles)
      verified = verified && outcome.verified
      log.info('checkpoint restore: workspace done', {
        sessionId,
        checkpointId: checkpoint.checkpointId,
        workspaceId,
        restored: outcome.restoredFiles.length,
        verified: outcome.verified,
      })
    }
    log.info('checkpoint restore: done', {
      sessionId,
      checkpointId: checkpoint.checkpointId,
      restored: restoredFiles.length,
      verified,
      forced: backupFailedRoots.length > 0,
    })
    return {
      checkpointId: checkpoint.checkpointId,
      restoredFiles,
      missingFiles: [],
      verified,
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
      for (const { rootPath } of this.resolveSessionWorkspaceRoots(otherId)) {
        if (rootPath === workspaceRootPath) {
          result.push(otherId)
          break
        }
      }
    }
    return result
  }
}
