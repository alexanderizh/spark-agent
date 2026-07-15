import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canvasApi, isMediaOperation, isTextModelOperation } from './canvas.api'
import type {
  CanvasBoard,
  CanvasEdge,
  CanvasNode,
  CanvasProject,
  CanvasProjectSettings,
  CanvasSnapshot,
  CanvasRightPanelTab,
  CreateCanvasTaskRequest,
  ShotScriptConfig,
} from './canvas.types'
import type {
  CanvasMediaTaskInputFile,
  CanvasMediaTaskStreamPayload,
  CanvasTextTaskStreamPayload,
  CanvasPromptTaskFields,
  SessionReasoningEffort,
} from '@spark/protocol'

export type CanvasViewMode = { mode: 'projects' } | { mode: 'workspace'; projectId: string }

const CANVAS_HISTORY_LIMIT = 50

export function cloneCanvasSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  if (typeof structuredClone === 'function') return structuredClone(snapshot)
  return JSON.parse(JSON.stringify(snapshot)) as CanvasSnapshot
}

export function boardHistorySignature(snapshot: CanvasSnapshot): string {
  const boardId = snapshot.activeBoardId ?? snapshot.board.id
  return JSON.stringify({
    board: snapshot.board,
    nodes: snapshot.nodes.filter((node) => node.boardId === boardId),
    edges: snapshot.edges.filter((edge) => edge.boardId === boardId),
    tasks: snapshot.tasks.filter((task) => task.boardId === boardId),
    assets: snapshot.assets,
  })
}

type CanvasHistoryEntry = {
  snapshot: CanvasSnapshot
  signature: string
}

export function shouldRefreshCanvasProjectsForTaskStream(
  payload: CanvasMediaTaskStreamPayload | CanvasTextTaskStreamPayload,
): boolean {
  return payload.status !== 'running'
}

export function createHistoryEntry(snapshot: CanvasSnapshot): CanvasHistoryEntry {
  const cloned = cloneCanvasSnapshot(snapshot)
  return { snapshot: cloned, signature: boardHistorySignature(cloned) }
}

type VersionedCanvasEntity = {
  id: string
  updatedAt?: string
  createdAt?: string
}

function mergeTaskEntities<T extends VersionedCanvasEntity>(
  current: T[],
  next: T[],
  preserveMissing = false,
): T[] {
  const currentById = new Map(current.map((item) => [item.id, item]))
  const merged = next.map((item) => {
    const previous = currentById.get(item.id)
    if (!previous) return item
    const previousVersion = previous.updatedAt ?? previous.createdAt
    const nextVersion = item.updatedAt ?? item.createdAt
    return previousVersion != null && previousVersion === nextVersion ? previous : item
  })
  if (preserveMissing) {
    const nextIds = new Set(next.map((item) => item.id))
    for (const item of current) {
      if (!nextIds.has(item.id)) merged.push(item)
    }
  }
  if (merged.length === current.length && merged.every((item, index) => item === current[index])) {
    return current
  }
  return merged
}

/**
 * Merge a task-related snapshot without replacing the active canvas board.
 * Task APIs return full snapshots for IPC compatibility, but task status
 * changes must not reset the user's viewport or recreate unrelated entities.
 */
export function mergeCanvasTaskSnapshot(
  current: CanvasSnapshot | null,
  next: CanvasSnapshot,
): CanvasSnapshot {
  return mergeCanvasSnapshot(current, next, true)
}

/** Merge a normal canvas mutation without replacing the active board viewport. */
export function mergeCanvasMutationSnapshot(
  current: CanvasSnapshot | null,
  next: CanvasSnapshot,
): CanvasSnapshot {
  return mergeCanvasSnapshot(current, next, false)
}

function mergeCanvasSnapshot(
  current: CanvasSnapshot | null,
  next: CanvasSnapshot,
  preserveMissingEntities: boolean,
): CanvasSnapshot {
  if (
    !current ||
    current.project.id !== next.project.id ||
    current.board.id !== next.board.id ||
    current.activeBoardId !== next.activeBoardId
  ) {
    return next
  }

  const boards =
    current.boards && next.boards
      ? mergeTaskEntities(current.boards, next.boards, preserveMissingEntities).map((board) =>
          board.id === current.board.id ? { ...board, viewport: current.board.viewport } : board,
        )
      : (current.boards ?? next.boards)

  return {
    ...next,
    board: current.board,
    ...(boards ? { boards } : {}),
    ...(current.activeBoardId ? { activeBoardId: current.activeBoardId } : {}),
    nodes: mergeTaskEntities(current.nodes, next.nodes, preserveMissingEntities),
    edges: mergeTaskEntities(current.edges, next.edges, preserveMissingEntities),
    assets: mergeTaskEntities(current.assets, next.assets, preserveMissingEntities),
    tasks: mergeTaskEntities(current.tasks, next.tasks, preserveMissingEntities),
  }
}

export function mergeCanvasBackgroundTaskSnapshot(
  current: CanvasSnapshot | null,
  next: CanvasSnapshot,
): CanvasSnapshot {
  if (!current || current.project.id !== next.project.id) return next
  return mergeCanvasTaskSnapshot(current, next)
}

export function useCanvasProjects() {
  const [projects, setProjects] = useState<CanvasProject[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // 先从 SQLite 恢复（生产持久化层），再列项目；失败静默降级到 localStorage
      try {
        await canvasApi.hydrateFromStorage()
      } catch {
        // SQLite 不可用时忽略
      }
      setProjects(await canvasApi.listProjects())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const unsubscribeMedia = window.spark.on(
      'stream:canvas:media-task',
      (payload: CanvasMediaTaskStreamPayload) => {
        if (shouldRefreshCanvasProjectsForTaskStream(payload)) void refresh()
      },
    )
    const unsubscribeText = window.spark.on(
      'stream:canvas:text-task',
      (payload: CanvasTextTaskStreamPayload) => {
        if (shouldRefreshCanvasProjectsForTaskStream(payload)) void refresh()
      },
    )
    return () => {
      unsubscribeMedia()
      unsubscribeText()
    }
  }, [refresh])

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== 'deleted'),
    [projects],
  )

  return { projects: activeProjects, loading, refresh }
}

export function useCanvasWorkspace(projectId: string) {
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  // 记录当前激活 board，refresh 时保留（不跳回默认 board）
  const activeBoardIdRef = useRef<string | null>(null)
  const undoStackRef = useRef<CanvasHistoryEntry[]>([])
  const redoStackRef = useRef<CanvasHistoryEntry[]>([])
  const lastRecordedSnapshotRef = useRef<CanvasHistoryEntry | null>(null)
  const restoringHistoryRef = useRef(false)
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHistorySnapshotRef = useRef<CanvasSnapshot | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [historyBusy, setHistoryBusy] = useState(false)
  useEffect(() => {
    activeBoardIdRef.current = snapshot?.activeBoardId ?? snapshot?.board.id ?? null
  }, [snapshot?.activeBoardId, snapshot?.board.id])

  useEffect(() => {
    if (!snapshot) return
    pendingHistorySnapshotRef.current = snapshot
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      historyTimerRef.current = null
      const snap = pendingHistorySnapshotRef.current
      if (!snap) return
      const signature = boardHistorySignature(snap)
      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false
        lastRecordedSnapshotRef.current = { snapshot: snap, signature }
        return
      }
      const previous = lastRecordedSnapshotRef.current
      if (previous && previous.signature !== signature) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(CANVAS_HISTORY_LIMIT - 1)),
          createHistoryEntry(previous.snapshot),
        ]
        redoStackRef.current = []
        setHistoryVersion((version) => version + 1)
      }
      lastRecordedSnapshotRef.current = { snapshot: snap, signature }
    }, 200)
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    }
  }, [snapshot])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await canvasApi.openSnapshot(projectId, activeBoardIdRef.current))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const refreshTaskSnapshot = useCallback(async () => {
    const next = await canvasApi.openSnapshot(projectId, activeBoardIdRef.current)
    setSnapshot((current) => mergeCanvasTaskSnapshot(current, next))
  }, [projectId])

  const applyTaskSnapshot = useCallback(async (request: Promise<CanvasSnapshot>) => {
    const next = await request
    setSnapshot((current) => mergeCanvasTaskSnapshot(current, next))
    return next
  }, [])

  const applyCanvasMutationSnapshot = useCallback(async (request: Promise<CanvasSnapshot>) => {
    const next = await request
    setSnapshot((current) => mergeCanvasMutationSnapshot(current, next))
    return next
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    const unsubscribe = window.spark.on(
      'stream:canvas:media-task',
      (payload: CanvasMediaTaskStreamPayload) => {
        if (!active) return
        if (payload.projectId && payload.projectId !== projectId) return
        if (!payload.clientTaskId) return
        if (payload.status === 'running') return
        void canvasApi
          .applyMediaTaskResult(projectId, payload.clientTaskId, payload.response)
          .then((next) => {
            if (active) setSnapshot((current) => mergeCanvasBackgroundTaskSnapshot(current, next))
          })
          .catch(() => {
            // 后台事件不能打断画布拖拽/编辑；失败详情已写入 task runtime。
          })
      },
    )
    // 文本任务（generate-text 后台模式）完成回写：结构与 media-task 对称，走 applyTextTaskResult。
    const unsubscribeText = window.spark.on(
      'stream:canvas:text-task',
      (payload: CanvasTextTaskStreamPayload) => {
        if (!active) return
        if (payload.projectId && payload.projectId !== projectId) return
        if (!payload.clientTaskId) return
        void canvasApi
          .applyTextTaskResult(projectId, payload.clientTaskId, payload.response)
          .then((next) => {
            if (active) setSnapshot((current) => mergeCanvasBackgroundTaskSnapshot(current, next))
          })
          .catch(() => {
            // 后台文本任务回写失败静默；详情已写入 task runtime。
          })
      },
    )
    return () => {
      active = false
      unsubscribe()
      unsubscribeText()
    }
  }, [projectId])

  const updateNodes = useCallback(
    async (nodes: CanvasNode[]) => {
      setSnapshot((prev) => (prev ? { ...prev, nodes } : prev))
      await canvasApi.updateNodes(projectId, nodes)
    },
    [projectId],
  )

  const connectNodes = useCallback(
    async (input: { sourceNodeId: string; targetNodeId: string; type?: CanvasEdge['type'] }) => {
      await applyCanvasMutationSnapshot(canvasApi.connectNodes(projectId, input))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const deleteEdges = useCallback(
    async (edgeIds: string[]) => {
      if (edgeIds.length === 0) return
      await applyCanvasMutationSnapshot(canvasApi.deleteEdges(projectId, edgeIds))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const createTextNode = useCallback(
    async (input: {
      text: string
      x: number
      y: number
      kind?: 'text' | 'prompt'
      format?: 'plain' | 'markdown' | 'prompt'
    }) => {
      const current = snapshot
      if (!current) return
      const node = await canvasApi.createTextNode({
        projectId,
        boardId: current.board.id,
        ...input,
      })
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
      return node
    },
    [applyCanvasMutationSnapshot, projectId, snapshot],
  )

  /** 上传图片到项目资产库（不创建节点），返回新 assetId */
  const uploadImageAsset = useCallback(
    async (file: File): Promise<string | null> => {
      const current = snapshot
      if (!current) return null
      const { readFileAsDataUrl, readImageDimensions } = await import('./canvas-safe-file')
      const dataUrl = await readFileAsDataUrl(file)
      const dimensions = await readImageDimensions(dataUrl)
      const saved = await window.spark.invoke('file:save-pasted-image', {
        dataUrl,
        mimeType: file.type,
        suggestedBaseName: file.name.replace(/\.[^.]+$/, ''),
        storageScope: 'canvas',
        ...(current.project.rootPath ? { projectRootPath: current.project.rootPath } : {}),
      })
      const asset = await canvasApi.createImageAsset({
        projectId,
        file,
        filePath: saved.filePath,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
      })
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
      return asset.id
    },
    [applyCanvasMutationSnapshot, projectId, snapshot],
  )

  const createImageNode = useCallback(
    async (input: {
      file: File
      filePath: string
      x: number
      y: number
      width?: number
      height?: number
      imageWidth?: number
      imageHeight?: number
    }) => {
      const current = snapshot
      if (!current) return
      const node = await canvasApi.createImageNode({
        projectId,
        boardId: current.board.id,
        ...input,
      })
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
      return node
    },
    [applyCanvasMutationSnapshot, projectId, snapshot],
  )

  /** 创建视频/音频节点（拖入外部媒体文件时使用），与 createImageNode 对称。 */
  const createMediaNode = useCallback(
    async (input: {
      kind: 'video' | 'audio'
      fileName: string
      fileMimeType?: string
      fileSize?: number
      filePath: string
      x: number
      y: number
      width?: number
      height?: number
      mediaWidth?: number
      mediaHeight?: number
      durationMs?: number
    }) => {
      const current = snapshot
      if (!current) return
      const node = await canvasApi.createMediaNode({
        projectId,
        boardId: current.board.id,
        ...input,
      })
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
      return node
    },
    [applyCanvasMutationSnapshot, projectId, snapshot],
  )

  const createGroupNode = useCallback(
    async (nodeIds: string[]) => {
      const nextSnapshot = await canvasApi.createGroupNode(projectId, nodeIds)
      return applyCanvasMutationSnapshot(Promise.resolve(nextSnapshot))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const dissolveGroupNode = useCallback(
    async (groupId: string) => {
      await applyCanvasMutationSnapshot(canvasApi.dissolveGroupNode(projectId, groupId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const addNodesToGroup = useCallback(
    async (groupId: string, nodeIds: string[]) => {
      await applyCanvasMutationSnapshot(canvasApi.addNodesToGroup(projectId, groupId, nodeIds))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const removeNodesFromGroup = useCallback(
    async (nodeIds: string[]) => {
      await applyCanvasMutationSnapshot(canvasApi.removeNodesFromGroup(projectId, nodeIds))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const deleteNodes = useCallback(
    async (nodeIds: string[]) => {
      await canvasApi.deleteNodes(projectId, nodeIds)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const duplicateNodes = useCallback(
    async (nodeIds: string[]) => {
      await applyCanvasMutationSnapshot(canvasApi.duplicateNodes(projectId, nodeIds))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const patchNodes = useCallback(
    async (nodeIds: string[], patch: Parameters<typeof canvasApi.patchNodes>[2]) => {
      await applyCanvasMutationSnapshot(canvasApi.patchNodes(projectId, nodeIds, patch))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const updateNodeData = useCallback(
    async (nodeId: string, data: Parameters<typeof canvasApi.updateNodeData>[2]) => {
      await applyCanvasMutationSnapshot(canvasApi.updateNodeData(projectId, nodeId, data))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const updateManyNodeData = useCallback(
    async (
      updates: Array<{ nodeId: string; data: Parameters<typeof canvasApi.updateNodeData>[2] }>,
    ) => {
      await applyCanvasMutationSnapshot(canvasApi.updateManyNodeData(projectId, updates))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const updateProjectSettings = useCallback(
    async (settings: CanvasProjectSettings) => {
      await applyCanvasMutationSnapshot(canvasApi.updateProjectSettings(projectId, settings))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const createTask = useCallback(
    async (
      request: Omit<CreateCanvasTaskRequest, 'boardId'> & {
        inputFiles?: CanvasMediaTaskInputFile[]
      },
    ) => {
      const current = snapshot
      if (!current) return
      // 多媒体 operation 走真实平台 adapter；文本 operation 走真实文本模型；其余记录为待接入执行器的任务。
      if (isMediaOperation(request.operation)) {
        await applyTaskSnapshot(canvasApi.createMediaTask(projectId, request))
      } else if (isTextModelOperation(request.operation)) {
        await applyTaskSnapshot(canvasApi.createTextTask(projectId, request))
      } else {
        await applyTaskSnapshot(
          canvasApi.createTask(projectId, { ...request, boardId: current.board.id }),
        )
      }
    },
    [applyTaskSnapshot, projectId, snapshot],
  )

  const cancelTask = useCallback(
    async (taskId: string) => {
      await applyTaskSnapshot(canvasApi.cancelTask(projectId, taskId))
    },
    [applyTaskSnapshot, projectId],
  )

  /**
   * 按 id 直接删除任务记录（任意状态）。
   *
   * 用于清理孤儿任务（承载节点已删、runtime 失效，cancelTask 无法终止）等无法走正常
   * cancel 流程的残留记录。底层 deleteTasks 不校验状态、不通知 runtime，仅从库移除。
   */
  const deleteTasks = useCallback(
    async (taskIds: string[]) => {
      if (taskIds.length === 0) return
      await canvasApi.deleteTasks(projectId, taskIds)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  /**
   * 批量清理画布任务，供任务队列头部「全部取消 / 清空失败」使用。
   *
   * - scope='active'：取消所有运行中（pending/running）任务。这些任务仍占用 runtime，
   *   必须逐个走 cancelTask（通知平台 adapter 中断 media 请求 + 标记 cancelled），
   *   记录保留在队列里作为历史，不删除。串行执行避免并发写库竞态，
   *   单个失败不阻塞其余任务。
   * - scope='failed'：直接删除所有已结束（failed/cancelled）任务记录。
   *   这些任务已无运行态，无需 cancel，用 deleteTasks 一次性清掉。
   *
   * 注意：孤儿任务（运行中但承载节点已删）不在本方法处理——它们 cancelTask 无法终止，
   * 改由 deleteTasks(taskIds) 单独删除，UI 通过 onDeleteTasks 触发。
   *
   * scope 互斥：active 只取消不删记录，failed 只删记录不取消。
   */
  const clearTasks = useCallback(
    async (scope: 'active' | 'failed') => {
      if (!snapshot) return
      if (scope === 'active') {
        const activeTasks = snapshot.tasks.filter(
          (task) => task.status === 'pending' || task.status === 'running',
        )
        for (const task of activeTasks) {
          try {
            await applyTaskSnapshot(canvasApi.cancelTask(projectId, task.id))
          } catch {
            // 单个任务取消失败不阻塞其余任务。
          }
        }
        return
      }
      // scope === 'failed'
      const endedTaskIds = snapshot.tasks
        .filter((task) => task.status === 'failed' || task.status === 'cancelled')
        .map((task) => task.id)
      if (endedTaskIds.length === 0) return
      await canvasApi.deleteTasks(projectId, endedTaskIds)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, applyTaskSnapshot, projectId, snapshot],
  )

  // ─── 多 board 操作（文档 §7.1）──────────────────────────────────────────
  const createBoard = useCallback(
    async (input?: { name?: string; templateId?: string | null }) => {
      await applyCanvasMutationSnapshot(canvasApi.createBoard(projectId, input))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const renameBoard = useCallback(
    async (boardId: string, name: string) => {
      await applyCanvasMutationSnapshot(canvasApi.renameBoard(projectId, boardId, name))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const deleteBoard = useCallback(
    async (boardId: string) => {
      await applyCanvasMutationSnapshot(canvasApi.deleteBoard(projectId, boardId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const duplicateBoard = useCallback(
    async (boardId: string, name?: string) => {
      await applyCanvasMutationSnapshot(canvasApi.duplicateBoard(projectId, boardId, name))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  /** 切换激活 board：保存当前 viewport 后切换（文档 §7.1 注意点） */
  const switchBoard = useCallback(
    async (boardId: string, viewport?: CanvasBoard['viewport']) => {
      const current = snapshot
      // 先持久化当前 board 的 viewport
      if (current && viewport) {
        await canvasApi.updateViewport(projectId, viewport, current.board.id)
      }
      setSnapshot(await canvasApi.setActiveBoard(projectId, boardId))
    },
    [projectId, snapshot],
  )

  const reorderBoards = useCallback(
    async (orderedBoardIds: string[]) => {
      await applyCanvasMutationSnapshot(canvasApi.reorderBoards(projectId, orderedBoardIds))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const setBoardCover = useCallback(
    async (boardId: string, coverAssetId: string | null) => {
      await applyCanvasMutationSnapshot(canvasApi.setBoardCover(projectId, boardId, coverAssetId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const setDefaultBoard = useCallback(
    async (boardId: string) => {
      await applyCanvasMutationSnapshot(canvasApi.setDefaultBoard(projectId, boardId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const copyNodesToBoard = useCallback(
    async (nodeIds: string[], targetBoardId: string) => {
      await applyCanvasMutationSnapshot(
        canvasApi.copyNodesToBoard(projectId, nodeIds, targetBoardId),
      )
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  // ─── 资产 → board（文档 §7.2）───────────────────────────────────────────
  const insertAsset = useCallback(
    async (input: { assetId: string; boardId: string; x: number; y: number }) => {
      const node = await canvasApi.insertAssetToBoard({ projectId, ...input })
      if (node) await applyTaskSnapshot(canvasApi.openSnapshot(projectId))
      return node
    },
    [applyTaskSnapshot, projectId],
  )

  /** 应用模板：在指定 board 的指定位置生成节点组合（文档 §7.8） */
  const applyTemplate = useCallback(
    async (input: {
      boardId: string
      originX: number
      originY: number
      nodes: Array<{
        ref: string
        type: import('./canvas.types').CanvasNodeType
        title?: string
        x: number
        y: number
        width?: number
        height?: number
        data?: Partial<import('./canvas.types').CanvasNodeData>
      }>
      edges?: Array<{
        from: string
        to: string
        type?: 'used_as_input' | 'generated' | 'references'
      }>
    }) => {
      await applyCanvasMutationSnapshot(canvasApi.applyTemplate({ projectId, ...input }))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  /** 局部更新项目扩展元数据（影视等行业模式，文档 §7.10） */
  const updateProjectMetadata = useCallback(
    async (patch: Record<string, unknown>) => {
      await applyCanvasMutationSnapshot(canvasApi.updateProjectMetadata(projectId, patch))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  // ─── 影视公用资产（文档 §7.10）─────────────────────────────────────────
  const createFilmAsset = useCallback(
    async (input: import('./canvasFilmAssets').CreateFilmAssetInput) => {
      const asset = await canvasApi.createFilmAsset(projectId, input)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
      return asset
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  /** 批量导入文稿（整篇 + 逐章）：单次事务，避免逐章重渲染卡死 */
  const importManuscript = useCallback(
    async (input: Parameters<typeof canvasApi.importManuscript>[1]) => {
      await applyCanvasMutationSnapshot(canvasApi.importManuscript(projectId, input))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  /** 删除整部文稿：级联删除全部章节，返回删除的章节数 */
  const deleteManuscript = useCallback(
    async (manuscriptAssetId: string) => {
      const { snapshot: next, deletedChapters } = await canvasApi.deleteManuscript(
        projectId,
        manuscriptAssetId,
      )
      await applyCanvasMutationSnapshot(Promise.resolve(next))
      return deletedChapters
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const updateFilmAsset = useCallback(
    async (assetId: string, patch: Parameters<typeof canvasApi.updateFilmAsset>[2]) => {
      await applyCanvasMutationSnapshot(canvasApi.updateFilmAsset(projectId, assetId, patch))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const deleteFilmAsset = useCallback(
    async (assetId: string) => {
      await applyCanvasMutationSnapshot(canvasApi.deleteFilmAsset(projectId, assetId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  /** 查询资源被谁引用（分镜片段 + 画布节点） */
  const getFilmAssetUsage = useCallback(
    (assetId: string) => canvasApi.getFilmAssetUsage(projectId, assetId),
    [projectId],
  )

  // ─── 分镜分组（存 project.metadata.film.shotGroups）─────────────────────
  const createShotGroup = useCallback(
    async (input: { name: string; description?: string }) => {
      const result = await canvasApi.createShotGroup(projectId, input)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
      const created = result.shotGroups[result.shotGroups.length - 1]
      if (!created) throw new Error('分镜分组创建失败')
      return created
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const updateShotGroup = useCallback(
    async (groupId: string, patch: { name?: string; description?: string }) => {
      await canvasApi.updateShotGroup(projectId, groupId, patch)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const deleteShotGroup = useCallback(
    async (groupId: string) => {
      await canvasApi.deleteShotGroup(projectId, groupId)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const createShotSegment = useCallback(
    async (
      groupId: string,
      input: Partial<import('./canvasFilmAssets').ShotSegment> & { title: string },
    ) => {
      await canvasApi.createShotSegment(projectId, groupId, input)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const updateShotSegment = useCallback(
    async (
      groupId: string,
      segmentId: string,
      patch: Partial<import('./canvasFilmAssets').ShotSegment>,
    ) => {
      await canvasApi.updateShotSegment(projectId, groupId, segmentId, patch)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  const deleteShotSegment = useCallback(
    async (groupId: string, segmentId: string) => {
      await canvasApi.deleteShotSegment(projectId, groupId, segmentId)
      await applyCanvasMutationSnapshot(canvasApi.openSnapshot(projectId))
    },
    [applyCanvasMutationSnapshot, projectId],
  )

  // ─── 操作节点（文档：AI 操作按类型分拆）─────────────────────────────────
  const createOperationNode = useCallback(
    async (input: {
      boardId: string
      operation: import('./canvas.types').CanvasOperationType
      inputNodeIds: string[]
      x: number
      y: number
      title?: string
      message?: string
      prompt?: string
      systemPrompt?: string
      negativePrompt?: string
      modelParams?: Record<string, unknown>
      agentId?: string
      providerProfileId?: string
      manifestId?: string
      modelId?: string
      taskPipelineRole?: CreateCanvasTaskRequest['taskPipelineRole']
      outputPipelineRole?: CreateCanvasTaskRequest['outputPipelineRole']
      outputTitle?: CreateCanvasTaskRequest['outputTitle']
      shotScriptConfig?: ShotScriptConfig
    }) => {
      const next = await canvasApi.createOperationNode({ projectId, ...input })
      return applyTaskSnapshot(Promise.resolve(next))
    },
    [applyTaskSnapshot, projectId],
  )

  const retryOperationNode = useCallback(
    async (nodeId: string) => {
      await applyTaskSnapshot(canvasApi.retryOperationNode(projectId, nodeId))
    },
    [applyTaskSnapshot, projectId],
  )
  const runOperationNode = useCallback(
    async (
      nodeId: string,
      params: {
        prompt: string
        negativePrompt?: string
        inputNodeIds?: string[]
        inputAssetIds?: string[]
        inputFiles?: CanvasMediaTaskInputFile[]
        agentId?: string
        providerProfileId?: string
        manifestId?: string
        modelId?: string
        reasoningEffort?: SessionReasoningEffort
        modelParams?: Record<string, unknown>
        skillIds?: string[]
        userPrompt?: string
      } & CanvasPromptTaskFields,
    ) => {
      await applyTaskSnapshot(canvasApi.runOperationNode(projectId, nodeId, params))
    },
    [applyTaskSnapshot, projectId],
  )

  const undoCanvasChange = useCallback(async () => {
    if (historyBusy) return
    const previous = undoStackRef.current.pop()
    const current = lastRecordedSnapshotRef.current
    if (!previous || !current) return
    setHistoryBusy(true)
    try {
      redoStackRef.current.push(current)
      restoringHistoryRef.current = true
      setSnapshot(await canvasApi.restoreBoardSnapshot(projectId, previous.snapshot))
      setHistoryVersion((version) => version + 1)
    } catch (error) {
      undoStackRef.current.push(previous)
      redoStackRef.current = redoStackRef.current.filter((entry) => entry !== current)
      restoringHistoryRef.current = false
      throw error
    } finally {
      setHistoryBusy(false)
    }
  }, [historyBusy, projectId])

  const redoCanvasChange = useCallback(async () => {
    if (historyBusy) return
    const next = redoStackRef.current.pop()
    const current = lastRecordedSnapshotRef.current
    if (!next || !current) return
    setHistoryBusy(true)
    try {
      undoStackRef.current.push(current)
      restoringHistoryRef.current = true
      setSnapshot(await canvasApi.restoreBoardSnapshot(projectId, next.snapshot))
      setHistoryVersion((version) => version + 1)
    } catch (error) {
      redoStackRef.current.push(next)
      undoStackRef.current = undoStackRef.current.filter((entry) => entry !== current)
      restoringHistoryRef.current = false
      throw error
    } finally {
      setHistoryBusy(false)
    }
  }, [historyBusy, projectId])

  const canUndo = useMemo(
    () => !historyBusy && undoStackRef.current.length > 0,
    [historyBusy, historyVersion],
  )
  const canRedo = useMemo(
    () => !historyBusy && redoStackRef.current.length > 0,
    [historyBusy, historyVersion],
  )

  return {
    snapshot,
    loading,
    canUndo,
    canRedo,
    undoCanvasChange,
    redoCanvasChange,
    refresh,
    refreshTaskSnapshot,
    updateNodes,
    connectNodes,
    deleteEdges,
    createTextNode,
    createImageNode,
    createMediaNode,
    uploadImageAsset,
    createGroupNode,
    dissolveGroupNode,
    addNodesToGroup,
    removeNodesFromGroup,
    deleteNodes,
    duplicateNodes,
    patchNodes,
    updateNodeData,
    updateManyNodeData,
    updateProjectSettings,
    createTask,
    cancelTask,
    clearTasks,
    deleteTasks,
    // board 管理
    createBoard,
    renameBoard,
    deleteBoard,
    duplicateBoard,
    switchBoard,
    reorderBoards,
    setBoardCover,
    setDefaultBoard,
    copyNodesToBoard,
    // 资产
    insertAsset,
    // 模板
    applyTemplate,
    // 项目元数据（影视等行业模式）
    updateProjectMetadata,
    // 影视公用资产
    createFilmAsset,
    importManuscript,
    deleteManuscript,
    updateFilmAsset,
    deleteFilmAsset,
    getFilmAssetUsage,
    // 分镜分组
    createShotGroup,
    updateShotGroup,
    deleteShotGroup,
    createShotSegment,
    updateShotSegment,
    deleteShotSegment,
    // 操作节点
    createOperationNode,
    retryOperationNode,
    runOperationNode,
  }
}

/**
 * 画布工作区 UI 状态（文档 §8.5）：右侧 tab、
 * 资产选择/视图模式。这些是纯 UI 状态，不进持久化热存储
 * （需要会话恢复时再写 snapshot.uiState）。
 */
export function useCanvasWorkspaceUi(initial?: { rightPanelTab?: CanvasRightPanelTab }) {
  const [rightPanelTab, setRightPanelTab] = useState<CanvasRightPanelTab>(
    initial?.rightPanelTab ?? 'inspector',
  )
  const [assetViewMode, setAssetViewMode] = useState<'list' | 'grid'>('list')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])

  return {
    rightPanelTab,
    setRightPanelTab,
    assetViewMode,
    setAssetViewMode,
    selectedAssetIds,
    setSelectedAssetIds,
  }
}
