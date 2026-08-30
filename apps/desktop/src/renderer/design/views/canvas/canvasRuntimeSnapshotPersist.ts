import type { CanvasSnapshotSaveRequest } from '@spark/protocol'
import type {
  CanvasAsset,
  CanvasBoard,
  CanvasEdge,
  CanvasNode,
  CanvasProject,
  CanvasSnapshot,
  CanvasTask,
} from './canvas.types'

type CanvasRuntimePersistDb = {
  projects: CanvasProject[]
  boards: CanvasBoard[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
}

export type CanvasPersistOutcome = {
  attempted: Set<string>
  failed: Set<string>
}

const EMPTY_PERSIST_OUTCOME: CanvasPersistOutcome = {
  attempted: new Set<string>(),
  failed: new Set<string>(),
}

type PersistCanvasRuntimeSnapshotInput = {
  projectId: string
  waitForPreviousPersist: () => Promise<unknown>
  canPersistFullSnapshot: () => boolean
  flushHotPersist: () => void
  readDbSnapshot: () => CanvasRuntimePersistDb
  loadPersistedSnapshot: () => Promise<CanvasSnapshot | null>
  mergeRuntimeState: (persisted: CanvasSnapshot, runtime: CanvasRuntimePersistDb) => CanvasSnapshot
  resolveActiveBoard: (
    boards: CanvasBoard[],
    preferredBoardId?: string | null,
  ) => { boards: CanvasBoard[]; active: CanvasBoard } | null
  buildProjectMeta: (project: CanvasProject) => NonNullable<CanvasSnapshotSaveRequest['meta']>
  captureVersion: () => number | undefined
  isVersionCurrent: (capturedVersion: number | undefined) => boolean
  saveSnapshot: (request: CanvasSnapshotSaveRequest) => Promise<unknown>
  setPersistTail: (tail: Promise<CanvasPersistOutcome>) => void
  clearPending: () => void
  reschedulePending: () => void
  reportError: (error: unknown) => void
}

/**
 * 静默持久化单个项目的任务运行态，不改变 renderer dirty 语义。
 *
 * 调用方提供热库快照、mutation 代次与公共保存队列接线；本模块负责组装单项目快照、
 * 等待已有保存、登记新保存尾部，并且只在“保存期间没有更新写入”时解除 pending。
 */
export async function persistCanvasRuntimeSnapshot(
  input: PersistCanvasRuntimeSnapshotInput,
): Promise<void> {
  const previousPersist = input.waitForPreviousPersist()
  const run = previousPersist
    .then(async () => {
      input.flushHotPersist()
      const db = input.readDbSnapshot()
      const project = db.projects.find((item) => item.id === input.projectId)
      if (!project || project.status === 'deleted') {
        input.clearPending()
        return
      }

      const capturedVersion = input.captureVersion()
      let snapshot: CanvasSnapshot
      if (input.canPersistFullSnapshot()) {
        const storedActiveBoardId = project.metadata?.activeBoardId
        const preferredBoardId =
          typeof storedActiveBoardId === 'string' ? storedActiveBoardId : undefined
        const resolved = input.resolveActiveBoard(
          db.boards.filter((board) => board.projectId === input.projectId),
          preferredBoardId,
        )
        // 无 board（数据异常）：无内容可落盘；保留挂起，维持热数据优先。
        if (!resolved) return
        snapshot = {
          project,
          board: resolved.active,
          boards: resolved.boards,
          activeBoardId: resolved.active.id,
          nodes: db.nodes.filter((item) => item.projectId === input.projectId),
          edges: db.edges.filter((item) => item.projectId === input.projectId),
          assets: db.assets.filter((item) => item.projectId === input.projectId),
          tasks: db.tasks.filter((item) => item.projectId === input.projectId),
        }
      } else {
        const persisted = await input.loadPersistedSnapshot()
        // 尚未显式保存过的新项目没有可合并基线；dirty 会继续保护热数据。
        if (!persisted) {
          input.clearPending()
          return
        }
        snapshot = input.mergeRuntimeState(persisted, db)
      }

      const request: CanvasSnapshotSaveRequest = {
        projectId: input.projectId,
        snapshotJson: JSON.stringify(snapshot),
        meta: input.buildProjectMeta(snapshot.project),
      }
      await input.saveSnapshot(request)
      if (input.isVersionCurrent(capturedVersion)) input.clearPending()
      else input.reschedulePending()
    })
    .catch((error: unknown) => {
      input.reportError(error)
    })
  // 从读取磁盘基线开始占用公共保存队列，避免全量保存插入 load/save 之间后又被旧基线覆盖。
  input.setPersistTail(
    run.then(
      () => EMPTY_PERSIST_OUTCOME,
      () => EMPTY_PERSIST_OUTCOME,
    ),
  )
  await run
}
