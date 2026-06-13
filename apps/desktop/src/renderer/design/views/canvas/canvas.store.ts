import { useCallback, useEffect, useMemo, useState } from 'react'
import { canvasApi } from './canvas.api'
import type {
  CanvasNode,
  CanvasProject,
  CanvasSnapshot,
  CreateCanvasTaskRequest,
} from './canvas.types'

export type CanvasViewMode = { mode: 'projects' } | { mode: 'workspace'; projectId: string }

export function useCanvasProjects() {
  const [projects, setProjects] = useState<CanvasProject[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
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
    async (request: Omit<CreateCanvasTaskRequest, 'boardId'>) => {
      const current = snapshot
      if (!current) return
      setSnapshot(await canvasApi.createTask(projectId, { ...request, boardId: current.board.id }))
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
