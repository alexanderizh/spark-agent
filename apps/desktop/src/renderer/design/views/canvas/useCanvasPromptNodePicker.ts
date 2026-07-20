import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { CanvasNode } from './canvas.types'

type CanvasPromptNodePickSession = {
  ownerNodeId: string
  onPick(node: CanvasNode): void
}

export function useCanvasPromptNodePicker({
  nodes,
  activeOperationNodeId,
  setSelectedNodeIds,
}: {
  nodes: readonly CanvasNode[]
  activeOperationNodeId: string | null
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>
}) {
  const nodesRef = useRef(nodes)
  const sessionRef = useRef<CanvasPromptNodePickSession | null>(null)
  const pendingSelectionRestoreRef = useRef<string | null>(null)
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ownerNodeId, setOwnerNodeId] = useState<string | null>(null)
  nodesRef.current = nodes

  const cancel = useCallback((expectedOwnerNodeId?: string) => {
    const session = sessionRef.current
    if (!session || (expectedOwnerNodeId && session.ownerNodeId !== expectedOwnerNodeId)) return
    sessionRef.current = null
    pendingSelectionRestoreRef.current = null
    setOwnerNodeId(null)
  }, [])

  const start = useCallback(
    (nextOwnerNodeId: string, onPick: (node: CanvasNode) => void) => {
      sessionRef.current = { ownerNodeId: nextOwnerNodeId, onPick }
      pendingSelectionRestoreRef.current = null
      setOwnerNodeId(nextOwnerNodeId)
      setSelectedNodeIds([nextOwnerNodeId])
    },
    [setSelectedNodeIds],
  )

  const interceptSelectionChange = useCallback((): boolean => {
    const session = sessionRef.current
    const restoreOwnerNodeId = session?.ownerNodeId ?? pendingSelectionRestoreRef.current
    if (!restoreOwnerNodeId) return false
    pendingSelectionRestoreRef.current = null
    setSelectedNodeIds([restoreOwnerNodeId])
    return true
  }, [setSelectedNodeIds])

  const interceptNodeSelect = useCallback(
    (nodeId: string): boolean => {
      const session = sessionRef.current
      if (!session) return false
      if (nodeId === session.ownerNodeId) return true
      const node = nodesRef.current.find((item) => item.id === nodeId && !item.hidden)
      if (!node) return true

      sessionRef.current = null
      pendingSelectionRestoreRef.current = session.ownerNodeId
      if (restoreTimerRef.current != null) clearTimeout(restoreTimerRef.current)
      restoreTimerRef.current = setTimeout(() => {
        pendingSelectionRestoreRef.current = null
        restoreTimerRef.current = null
      }, 0)
      setOwnerNodeId(null)
      setSelectedNodeIds([session.ownerNodeId])
      session.onPick(node)
      return true
    },
    [setSelectedNodeIds],
  )

  useEffect(() => {
    if (ownerNodeId && activeOperationNodeId !== ownerNodeId) cancel(ownerNodeId)
  }, [activeOperationNodeId, cancel, ownerNodeId])

  useEffect(() => {
    if (!ownerNodeId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel(ownerNodeId)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [cancel, ownerNodeId])

  useEffect(
    () => () => {
      if (restoreTimerRef.current != null) clearTimeout(restoreTimerRef.current)
    },
    [],
  )

  return {
    ownerNodeId,
    start,
    cancel,
    interceptSelectionChange,
    interceptNodeSelect,
  }
}
