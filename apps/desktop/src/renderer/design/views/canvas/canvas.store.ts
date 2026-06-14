import { useCallback, useEffect, useMemo, useState } from 'react'
import { canvasApi, isMediaOperation } from './canvas.api'
import type {
  CanvasNode,
  CanvasProject,
  CanvasSnapshot,
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await canvasApi.openSnapshot(projectId))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    const unsubscribe = window.spark.on('stream:canvas:media-task', (payload: CanvasMediaTaskStreamPayload) => {
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
    })
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

  const createTextNode = useCallback(
    async (input: { text: string; isPrompt?: boolean; x: number; y: number }) => {
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
    async (input: { file: File; dataUrl: string; x: number; y: number }) => {
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
      setSnapshot(await canvasApi.createGroupNode(projectId, nodeIds))
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

  const createTask = useCallback(
    async (request: Omit<CreateCanvasTaskRequest, 'boardId'> & {
      inputFiles?: CanvasMediaTaskInputFile[]
    }) => {
      const current = snapshot
      if (!current) return
      // 多媒体 operation 走真实平台 adapter；文本类走 demo 占位
      if (isMediaOperation(request.operation)) {
        setSnapshot(await canvasApi.createMediaTask(projectId, request))
      } else {
        setSnapshot(await canvasApi.createTask(projectId, { ...request, boardId: current.board.id }))
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

  return {
    snapshot,
    loading,
    refresh,
    updateNodes,
    createTextNode,
    createImageNode,
    createGroupNode,
    deleteNodes,
    duplicateNodes,
    patchNodes,
    updateNodeData,
    createTask,
    completeDemoTask,
  }
}
