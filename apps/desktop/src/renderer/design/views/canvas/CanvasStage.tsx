import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeOrigin,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { message } from 'antd'
import { CanvasNode, type CanvasFlowNodeData } from './CanvasNode'
import { persistCanvasNodeLayoutChanges } from './canvasStageLayout'
import type { CanvasEdge, CanvasNode as SparkCanvasNode, CanvasSnapshot } from './canvas.types'

const nodeTypes = { sparkCanvasNode: CanvasNode }
const defaultNodeOrigin: NodeOrigin = [0, 0]

type CanvasNodeActions = CanvasFlowNodeData['actions']

function toFlowNode(
  node: SparkCanvasNode,
  actions: CanvasNodeActions,
  selectedCount: number,
  selected: boolean,
): Node<CanvasFlowNodeData> {
  const flowNode: Node<CanvasFlowNodeData> = {
    id: node.id,
    type: 'sparkCanvasNode',
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    style: { width: node.width, height: node.height },
    zIndex: node.zIndex,
    draggable: !node.locked,
    selectable: !node.locked,
    selected,
    data: { actions, canvasNode: node, selectedCount },
  }
  if (node.parentNodeId) {
    flowNode.parentId = node.parentNodeId
    flowNode.extent = 'parent'
  }
  return flowNode
}

function toFlowEdge(edge: CanvasEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    animated: edge.type === 'generated',
    label: edge.type === 'generated' ? 'output' : 'input',
    className: `canvas-edge-${edge.type}`,
  }
}

export function CanvasStage({
  snapshot,
  activeTool,
  selectedNodeIds,
  onSelectionChange,
  onNodesPersist,
  onDuplicateNode,
  onDeleteNode,
  onToggleLockNode,
  onBringNodeToFront,
  onCreateGroupFromSelection,
  onOpenAiComposer,
}: {
  snapshot: CanvasSnapshot
  activeTool: 'select' | 'pan'
  selectedNodeIds: string[]
  onSelectionChange: (nodeIds: string[]) => void
  onNodesPersist: (nodes: SparkCanvasNode[]) => void
  onDuplicateNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onToggleLockNode: (nodeId: string) => void
  onBringNodeToFront: (nodeId: string) => void
  onCreateGroupFromSelection: () => void
  onOpenAiComposer: (nodeId: string) => void
}) {
  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      duplicateNode: onDuplicateNode,
      deleteNode: onDeleteNode,
      toggleLockNode: onToggleLockNode,
      bringNodeToFront: onBringNodeToFront,
      createGroupFromSelection: onCreateGroupFromSelection,
      openAiComposer: onOpenAiComposer,
    }),
    [
      onBringNodeToFront,
      onCreateGroupFromSelection,
      onDeleteNode,
      onDuplicateNode,
      onOpenAiComposer,
      onToggleLockNode,
    ],
  )
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const nodes = useMemo(
    () =>
      snapshot.nodes.map((node) =>
        toFlowNode(node, nodeActions, selectedNodeIds.length, selectedNodeIdSet.has(node.id)),
      ),
    [nodeActions, selectedNodeIdSet, selectedNodeIds.length, snapshot.nodes],
  )
  const [flowNodes, setFlowNodes] = useState(nodes)
  const flowNodesRef = useRef(nodes)
  const syncFrameRef = useRef<number | null>(null)
  const viewportInteractingRef = useRef(false)
  const pendingNodesSyncRef = useRef<Node<CanvasFlowNodeData>[] | null>(null)
  const edges = useMemo(() => snapshot.edges.map(toFlowEdge), [snapshot.edges])

  const cancelScheduledSync = useCallback(() => {
    if (syncFrameRef.current == null) return
    window.cancelAnimationFrame(syncFrameRef.current)
    syncFrameRef.current = null
  }, [])

  const syncFlowNodes = useCallback(
    (nextNodes: Node<CanvasFlowNodeData>[]) => {
      cancelScheduledSync()
      syncFrameRef.current = window.requestAnimationFrame(() => {
        syncFrameRef.current = null
        flowNodesRef.current = nextNodes
        setFlowNodes(nextNodes)
      })
    },
    [cancelScheduledSync],
  )

  useEffect(() => {
    if (viewportInteractingRef.current) {
      pendingNodesSyncRef.current = nodes
      return
    }
    syncFlowNodes(nodes)
  }, [nodes, syncFlowNodes])

  useEffect(() => () => cancelScheduledSync(), [cancelScheduledSync])

  const flushPendingNodesSync = useCallback(() => {
    const pendingNodes = pendingNodesSyncRef.current
    pendingNodesSyncRef.current = null
    if (pendingNodes) syncFlowNodes(pendingNodes)
  }, [syncFlowNodes])

  const handleViewportMoveStart = useCallback(() => {
    viewportInteractingRef.current = true
    cancelScheduledSync()
  }, [cancelScheduledSync])

  const handleViewportMoveEnd = useCallback(() => {
    viewportInteractingRef.current = false
    flushPendingNodesSync()
  }, [flushPendingNodesSync])

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasFlowNodeData>>[]) => {
      const nextFlowNodes = applyNodeChanges(changes, flowNodesRef.current)
      flowNodesRef.current = nextFlowNodes
      setFlowNodes(nextFlowNodes)

      const nextPersistedNodes = persistCanvasNodeLayoutChanges(
        snapshot.nodes,
        nextFlowNodes,
        changes,
      )
      if (nextPersistedNodes) {
        onNodesPersist(nextPersistedNodes)
      }
    },
    [onNodesPersist, snapshot.nodes],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      void addEdge(connection, edges)
      message.info('血缘边将在后端 API 接入后保存')
    },
    [edges],
  )

  return (
    <ReactFlowProvider>
      <div className="canvas-stage">
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.24 }}
          minZoom={0.18}
          maxZoom={2.2}
          nodeOrigin={defaultNodeOrigin}
          onlyRenderVisibleElements
          nodesDraggable={activeTool === 'select'}
          nodesConnectable
          elementsSelectable
          panOnDrag={activeTool === 'pan'}
          multiSelectionKeyCode={['Meta', 'Control']}
          selectionOnDrag={activeTool === 'select'}
          onNodesChange={handleNodesChange}
          onConnect={handleConnect}
          onMoveStart={handleViewportMoveStart}
          onMoveEnd={handleViewportMoveEnd}
          onSelectionChange={({ nodes: selected }) =>
            onSelectionChange(selected.map((node) => node.id))
          }
        >
          <Background gap={24} size={1} color="var(--canvas-grid-color)" />
          <MiniMap
            className="canvas-minimap"
            nodeColor={(node) => {
              const type = (node.data as CanvasFlowNodeData).canvasNode.type
              if (type === 'task') return '#22c55e'
              if (type === 'image') return '#3b82f6'
              if (type === 'prompt') return '#f59e0b'
              return '#94a3b8'
            }}
          />
          <Controls className="canvas-controls" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  )
}
