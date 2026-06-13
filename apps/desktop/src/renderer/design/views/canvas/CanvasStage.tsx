import { useCallback, useMemo } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Message } from '@arco-design/web-react'
import { CanvasNode, type CanvasFlowNodeData } from './CanvasNode'
import type { CanvasEdge, CanvasNode as SparkCanvasNode, CanvasSnapshot } from './canvas.types'

const nodeTypes = { sparkCanvasNode: CanvasNode }

function toFlowNode(node: SparkCanvasNode): Node<CanvasFlowNodeData> {
  return {
    id: node.id,
    type: 'sparkCanvasNode',
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    zIndex: node.zIndex,
    draggable: !node.locked,
    selectable: !node.locked,
    data: { canvasNode: node },
  }
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

function fromFlowNodes(
  base: SparkCanvasNode[],
  flowNodes: Node<CanvasFlowNodeData>[],
): SparkCanvasNode[] {
  const flowById = new Map(flowNodes.map((node) => [node.id, node]))
  return base.map((node) => {
    const flow = flowById.get(node.id)
    if (!flow) return node
    return {
      ...node,
      x: flow.position.x,
      y: flow.position.y,
      width: typeof flow.width === 'number' ? flow.width : node.width,
      height: typeof flow.height === 'number' ? flow.height : node.height,
    }
  })
}

export function CanvasStage({
  snapshot,
  onSelectionChange,
  onNodesPersist,
}: {
  snapshot: CanvasSnapshot
  onSelectionChange: (nodeIds: string[]) => void
  onNodesPersist: (nodes: SparkCanvasNode[]) => void
}) {
  const nodes = useMemo(() => snapshot.nodes.map(toFlowNode), [snapshot.nodes])
  const edges = useMemo(() => snapshot.edges.map(toFlowEdge), [snapshot.edges])

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasFlowNodeData>>[]) => {
      const nextFlowNodes = applyNodeChanges(changes, nodes)
      onNodesPersist(fromFlowNodes(snapshot.nodes, nextFlowNodes))
    },
    [nodes, onNodesPersist, snapshot.nodes],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      void addEdge(connection, edges)
      Message.info('血缘边将在后端 API 接入后保存')
    },
    [edges],
  )

  return (
    <ReactFlowProvider>
      <div className="canvas-stage">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.24 }}
          minZoom={0.18}
          maxZoom={2.2}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          multiSelectionKeyCode={['Meta', 'Control']}
          selectionOnDrag
          onNodesChange={handleNodesChange}
          onConnect={handleConnect}
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
