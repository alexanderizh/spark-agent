import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canvasApi, isMediaOperation } from './canvas.api'
import type {
  CanvasBoard,
  CanvasNode,
  CanvasProject,
  CanvasProjectSettings,
  CanvasSnapshot,
  CanvasLeftPanelTab,
  CanvasLeftUtilityTab,
  CanvasRightPanelTab,
  CreateCanvasTaskRequest,
} from './canvas.types'
import type { CanvasMediaTaskInputFile, CanvasMediaTaskStreamPayload } from '@spark/protocol'

export type CanvasViewMode = { mode: 'projects' } | { mode: 'workspace'; projectId: string }

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
  useEffect(() => {
    activeBoardIdRef.current = snapshot?.activeBoardId ?? snapshot?.board.id ?? null
  }, [snapshot?.activeBoardId, snapshot?.board.id])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await canvasApi.openSnapshot(projectId, activeBoardIdRef.current))
    } finally {
      setLoading(false)
    }
  }, [projectId])

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
            if (active) setSnapshot(next)
          })
          .catch(() => {
            // 后台事件不能打断画布拖拽/编辑；失败详情已写入 task runtime。
          })
      },
    )
    return () => {
      active = false
      unsubscribe()
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
    async (input: { sourceNodeId: string; targetNodeId: string }) => {
      setSnapshot(await canvasApi.connectNodes(projectId, input))
    },
    [projectId],
  )

  const createTextNode = useCallback(
    async (input: { text: string; x: number; y: number }) => {
      const current = snapshot
      if (!current) return
      const node = await canvasApi.createTextNode({
        projectId,
        boardId: current.board.id,
        ...input,
      })
      setSnapshot(await canvasApi.openSnapshot(projectId))
      return node
    },
    [projectId, snapshot],
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
      setSnapshot(await canvasApi.openSnapshot(projectId))
      return node
    },
    [projectId, snapshot],
  )

  const createGroupNode = useCallback(
    async (nodeIds: string[]) => {
      const nextSnapshot = await canvasApi.createGroupNode(projectId, nodeIds)
      setSnapshot(nextSnapshot)
      return nextSnapshot
    },
    [projectId],
  )

  const dissolveGroupNode = useCallback(
    async (groupId: string) => {
      setSnapshot(await canvasApi.dissolveGroupNode(projectId, groupId))
    },
    [projectId],
  )

  const addNodesToGroup = useCallback(
    async (groupId: string, nodeIds: string[]) => {
      setSnapshot(await canvasApi.addNodesToGroup(projectId, groupId, nodeIds))
    },
    [projectId],
  )

  const removeNodesFromGroup = useCallback(
    async (nodeIds: string[]) => {
      setSnapshot(await canvasApi.removeNodesFromGroup(projectId, nodeIds))
    },
    [projectId],
  )

  const deleteNodes = useCallback(
    async (nodeIds: string[]) => {
      await canvasApi.deleteNodes(projectId, nodeIds)
      setSnapshot(await canvasApi.openSnapshot(projectId))
    },
    [projectId],
  )

  const duplicateNodes = useCallback(
    async (nodeIds: string[]) => {
      setSnapshot(await canvasApi.duplicateNodes(projectId, nodeIds))
    },
    [projectId],
  )

  const patchNodes = useCallback(
    async (nodeIds: string[], patch: Parameters<typeof canvasApi.patchNodes>[2]) => {
      setSnapshot(await canvasApi.patchNodes(projectId, nodeIds, patch))
    },
    [projectId],
  )

  const updateNodeData = useCallback(
    async (nodeId: string, data: Parameters<typeof canvasApi.updateNodeData>[2]) => {
      setSnapshot(await canvasApi.updateNodeData(projectId, nodeId, data))
    },
    [projectId],
  )

  const updateProjectSettings = useCallback(
    async (settings: CanvasProjectSettings) => {
      setSnapshot(await canvasApi.updateProjectSettings(projectId, settings))
    },
    [projectId],
  )

  const createTask = useCallback(
    async (
      request: Omit<CreateCanvasTaskRequest, 'boardId'> & {
        inputFiles?: CanvasMediaTaskInputFile[]
      },
    ) => {
      const current = snapshot
      if (!current) return
      // 多媒体 operation 走真实平台 adapter；文本类走 demo 占位
      if (isMediaOperation(request.operation)) {
        setSnapshot(await canvasApi.createMediaTask(projectId, request))
      } else {
        setSnapshot(
          await canvasApi.createTask(projectId, { ...request, boardId: current.board.id }),
        )
      }
    },
    [projectId, snapshot],
  )

  const completeDemoTask = useCallback(
    async (taskId: string) => {
      setSnapshot(await canvasApi.completeDemoTask(projectId, taskId))
    },
    [projectId],
  )

  const cancelTask = useCallback(
    async (taskId: string) => {
      setSnapshot(await canvasApi.cancelTask(projectId, taskId))
    },
    [projectId],
  )

  // ─── 多 board 操作（文档 §7.1）──────────────────────────────────────────
  const createBoard = useCallback(
    async (input?: { name?: string; templateId?: string | null }) => {
      setSnapshot(await canvasApi.createBoard(projectId, input))
    },
    [projectId],
  )

  const renameBoard = useCallback(
    async (boardId: string, name: string) => {
      setSnapshot(await canvasApi.renameBoard(projectId, boardId, name))
    },
    [projectId],
  )

  const deleteBoard = useCallback(
    async (boardId: string) => {
      setSnapshot(await canvasApi.deleteBoard(projectId, boardId))
    },
    [projectId],
  )

  const duplicateBoard = useCallback(
    async (boardId: string, name?: string) => {
      setSnapshot(await canvasApi.duplicateBoard(projectId, boardId, name))
    },
    [projectId],
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
      setSnapshot(await canvasApi.reorderBoards(projectId, orderedBoardIds))
    },
    [projectId],
  )

  const setBoardCover = useCallback(
    async (boardId: string, coverAssetId: string | null) => {
      setSnapshot(await canvasApi.setBoardCover(projectId, boardId, coverAssetId))
    },
    [projectId],
  )

  const setDefaultBoard = useCallback(
    async (boardId: string) => {
      setSnapshot(await canvasApi.setDefaultBoard(projectId, boardId))
    },
    [projectId],
  )

  const copyNodesToBoard = useCallback(
    async (nodeIds: string[], targetBoardId: string) => {
      setSnapshot(await canvasApi.copyNodesToBoard(projectId, nodeIds, targetBoardId))
    },
    [projectId],
  )

  // ─── 资产 → board（文档 §7.2）───────────────────────────────────────────
  const insertAsset = useCallback(
    async (input: { assetId: string; boardId: string; x: number; y: number }) => {
      const node = await canvasApi.insertAssetToBoard({ projectId, ...input })
      if (node) setSnapshot(await canvasApi.openSnapshot(projectId))
      return node
    },
    [projectId],
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
      setSnapshot(await canvasApi.applyTemplate({ projectId, ...input }))
    },
    [projectId],
  )

  /** 局部更新项目扩展元数据（影视等行业模式，文档 §7.10） */
  const updateProjectMetadata = useCallback(
    async (patch: Record<string, unknown>) => {
      setSnapshot(await canvasApi.updateProjectMetadata(projectId, patch))
    },
    [projectId],
  )

  return {
    snapshot,
    loading,
    refresh,
    updateNodes,
    connectNodes,
    createTextNode,
    createImageNode,
    createGroupNode,
    dissolveGroupNode,
    addNodesToGroup,
    removeNodesFromGroup,
    deleteNodes,
    duplicateNodes,
    patchNodes,
    updateNodeData,
    updateProjectSettings,
    createTask,
    completeDemoTask,
    cancelTask,
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
  }
}

/**
 * 画布工作区 UI 状态（文档 §8.5）：左侧主 tab、左下工具 tab、右侧 tab、
 * 底部栏折叠、资产选择/视图模式。这些是纯 UI 状态，不进持久化热存储
 * （需要会话恢复时再写 snapshot.uiState）。
 */
export function useCanvasWorkspaceUi(initial?: {
  leftPanelTab?: CanvasLeftPanelTab
  rightPanelTab?: CanvasRightPanelTab
}) {
  const [leftPanelTab, setLeftPanelTab] = useState<CanvasLeftPanelTab>(
    initial?.leftPanelTab ?? 'boards',
  )
  const [leftUtilityTab, setLeftUtilityTab] = useState<CanvasLeftUtilityTab>('templates')
  const [rightPanelTab, setRightPanelTab] = useState<CanvasRightPanelTab>(
    initial?.rightPanelTab ?? 'inspector',
  )
  const [bottomToolbarCollapsed, setBottomToolbarCollapsed] = useState(false)
  const [assetViewMode, setAssetViewMode] = useState<'list' | 'grid'>('list')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])

  // 左工作台整体折叠（小屏场景）
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)

  return {
    leftPanelTab,
    setLeftPanelTab,
    leftUtilityTab,
    setLeftUtilityTab,
    rightPanelTab,
    setRightPanelTab,
    bottomToolbarCollapsed,
    setBottomToolbarCollapsed,
    assetViewMode,
    setAssetViewMode,
    selectedAssetIds,
    setSelectedAssetIds,
    leftPanelCollapsed,
    setLeftPanelCollapsed,
  }
}
