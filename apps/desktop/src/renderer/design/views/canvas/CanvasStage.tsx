import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeOrigin,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Icons } from '../../Icons'
import { CanvasNode, type CanvasFlowNodeData } from './CanvasNode'
import { computeCanvasAlignmentGuides, type CanvasAlignmentGuide } from './canvasAlignmentGuides'
import { persistCanvasNodeLayoutChanges } from './canvasStageLayout'
import type { CanvasEdge, CanvasNode as SparkCanvasNode, CanvasSnapshot } from './canvas.types'

const nodeTypes = { sparkCanvasNode: CanvasNode }
const defaultNodeOrigin: NodeOrigin = [0, 0]

type CanvasNodeActions = CanvasFlowNodeData['actions']
type CanvasLineageSummary = CanvasFlowNodeData['lineage']
type CanvasStagePoint = { x: number; y: number }
type PaneContextMenuState = {
  left: number
  top: number
  flowPosition: CanvasStagePoint
}

export type CanvasStageViewport = Viewport & {
  width: number
  height: number
}

function toFlowNode(
  node: SparkCanvasNode,
  actions: CanvasNodeActions,
  lineage: CanvasLineageSummary,
  selectedCount: number,
  selected: boolean,
): Node<CanvasFlowNodeData> {
  const data: CanvasFlowNodeData = {
    actions,
    canvasNode: node,
    selectedCount,
    ...(lineage ? { lineage } : {}),
  }
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
    data,
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

function buildLineageSummaries(edges: CanvasEdge[]): Map<string, CanvasLineageSummary> {
  const byNodeId = new Map<string, NonNullable<CanvasLineageSummary>>()
  const ensure = (nodeId: string) => {
    let summary = byNodeId.get(nodeId)
    if (!summary) {
      summary = { incoming: 0, outgoing: 0, generated: 0, usedAsInput: 0 }
      byNodeId.set(nodeId, summary)
    }
    return summary
  }
  for (const edge of edges) {
    const source = ensure(edge.sourceNodeId)
    const target = ensure(edge.targetNodeId)
    source.outgoing += 1
    target.incoming += 1
    if (edge.type === 'generated') source.generated += 1
    if (edge.type === 'used_as_input') source.usedAsInput += 1
  }
  return byNodeId
}

export function CanvasStage({
  snapshot,
  activeTool,
  selectedNodeIds,
  onSelectionChange,
  onNodesPersist,
  onConnectNodes,
  onDuplicateNode,
  onDeleteNode,
  onToggleLockNode,
  onBringNodeToFront,
  onCreateGroupFromSelection,
  onAddSelectionToGroup,
  onRemoveNodeFromGroup,
  onDissolveGroup,
  onOpenAiComposer,
  onEditNode,
  onAddTextAtPosition,
  onAddImageAtPosition,
  onAddPromptAtPosition,
  onInsertAssetFromPane,
  onCreateBoardFromPane,
  onResetZoomFromPane,
  onViewportChange,
}: {
  snapshot: CanvasSnapshot
  activeTool: 'select' | 'pan'
  selectedNodeIds: string[]
  onSelectionChange: (nodeIds: string[]) => void
  onNodesPersist: (nodes: SparkCanvasNode[]) => void
  onConnectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => void
  onDuplicateNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onToggleLockNode: (nodeId: string) => void
  onBringNodeToFront: (nodeId: string) => void
  onCreateGroupFromSelection: () => void
  onAddSelectionToGroup: (groupId: string) => void
  onRemoveNodeFromGroup: (nodeId: string) => void
  onDissolveGroup: (groupId: string) => void
  onOpenAiComposer: (nodeId: string) => void
  onEditNode: (nodeId: string) => void
  onAddTextAtPosition: (position: CanvasStagePoint) => void
  onAddImageAtPosition: (position: CanvasStagePoint) => void
  /** 空白右键：新建 Prompt 节点 */
  onAddPromptAtPosition?: (position: CanvasStagePoint) => void
  /** 空白右键：从资产插入（打开资产面板） */
  onInsertAssetFromPane?: () => void
  /** 空白右键：新建 board */
  onCreateBoardFromPane?: () => void
  /** 空白右键：视图重置（适配/居中） */
  onResetZoomFromPane?: () => void
  onViewportChange?: (viewport: CanvasStageViewport) => void
}) {
  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      duplicateNode: onDuplicateNode,
      deleteNode: onDeleteNode,
      toggleLockNode: onToggleLockNode,
      bringNodeToFront: onBringNodeToFront,
      createGroupFromSelection: onCreateGroupFromSelection,
      addSelectionToGroup: onAddSelectionToGroup,
      removeNodeFromGroup: onRemoveNodeFromGroup,
      dissolveGroup: onDissolveGroup,
      openAiComposer: onOpenAiComposer,
      editNode: onEditNode,
    }),
    [
      onAddSelectionToGroup,
      onBringNodeToFront,
      onCreateGroupFromSelection,
      onDeleteNode,
      onDissolveGroup,
      onDuplicateNode,
      onEditNode,
      onOpenAiComposer,
      onRemoveNodeFromGroup,
      onToggleLockNode,
    ],
  )
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const lineageSummaries = useMemo(() => buildLineageSummaries(snapshot.edges), [snapshot.edges])
  const nodes = useMemo(
    () =>
      snapshot.nodes.map((node) =>
        toFlowNode(
          node,
          nodeActions,
          lineageSummaries.get(node.id),
          selectedNodeIds.length,
          selectedNodeIdSet.has(node.id),
        ),
      ),
    [lineageSummaries, nodeActions, selectedNodeIdSet, selectedNodeIds.length, snapshot.nodes],
  )
  const [flowNodes, setFlowNodes] = useState(nodes)
  const stageRef = useRef<HTMLDivElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node<CanvasFlowNodeData>, Edge> | null>(null)
  const flowNodesRef = useRef(nodes)
  const latestViewportRef = useRef<Viewport>(snapshot.board.viewport)
  const syncFrameRef = useRef<number | null>(null)
  const guideFrameRef = useRef<number | null>(null)
  const viewportInteractingRef = useRef(false)
  const pendingNodesSyncRef = useRef<Node<CanvasFlowNodeData>[] | null>(null)
  const [alignmentGuides, setAlignmentGuides] = useState<CanvasAlignmentGuide[]>([])
  const [paneContextMenu, setPaneContextMenu] = useState<PaneContextMenuState | null>(null)
  const edges = useMemo(() => snapshot.edges.map(toFlowEdge), [snapshot.edges])

  const notifyViewportChange = useCallback(
    (viewport = latestViewportRef.current) => {
      latestViewportRef.current = viewport
      const rect = stageRef.current?.getBoundingClientRect()
      onViewportChange?.({
        ...viewport,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      })
    },
    [onViewportChange],
  )

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

  useEffect(
    () => () => {
      if (guideFrameRef.current != null) window.cancelAnimationFrame(guideFrameRef.current)
    },
    [],
  )

  useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined
    notifyViewportChange()
    const observer = new ResizeObserver(() => notifyViewportChange())
    observer.observe(element)
    return () => observer.disconnect()
  }, [notifyViewportChange])

  const flushPendingNodesSync = useCallback(() => {
    const pendingNodes = pendingNodesSyncRef.current
    pendingNodesSyncRef.current = null
    if (pendingNodes) syncFlowNodes(pendingNodes)
  }, [syncFlowNodes])

  const handleViewportMoveStart = useCallback(() => {
    setPaneContextMenu(null)
    viewportInteractingRef.current = true
    cancelScheduledSync()
  }, [cancelScheduledSync])

  const handleViewportMoveEnd = useCallback(
    (_event?: MouseEvent | TouchEvent | null, viewport?: Viewport) => {
      viewportInteractingRef.current = false
      flushPendingNodesSync()
      if (viewport) notifyViewportChange(viewport)
    },
    [flushPendingNodesSync, notifyViewportChange],
  )

  const handleViewportMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      notifyViewportChange(viewport)
    },
    [notifyViewportChange],
  )

  const handleInit = useCallback(
    (instance: ReactFlowInstance<Node<CanvasFlowNodeData>, Edge>) => {
      flowInstanceRef.current = instance
      notifyViewportChange(instance.getViewport())
    },
    [notifyViewportChange],
  )

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) => {
      const rect = stageRef.current?.getBoundingClientRect()
      const instance = flowInstanceRef.current
      if (!rect || !instance) return

      event.preventDefault()
      event.stopPropagation()

      const menuWidth = 188
      const menuHeight = 280
      const minInset = 8
      const left = Math.min(
        Math.max(event.clientX - rect.left, minInset),
        Math.max(rect.width - menuWidth - minInset, minInset),
      )
      const top = Math.min(
        Math.max(event.clientY - rect.top, minInset),
        Math.max(rect.height - menuHeight - minInset, minInset),
      )

      setPaneContextMenu({
        left,
        top,
        flowPosition: instance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }),
      })
    },
    [],
  )

  const closePaneContextMenu = useCallback(() => {
    setPaneContextMenu(null)
  }, [])

  useEffect(() => {
    if (!paneContextMenu) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePaneContextMenu()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closePaneContextMenu)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closePaneContextMenu)
    }
  }, [closePaneContextMenu, paneContextMenu])

  const handleResetZoom = useCallback(() => {
    const instance = flowInstanceRef.current
    if (!instance) return
    const nextViewport = { ...latestViewportRef.current, zoom: 1 }
    closePaneContextMenu()
    void instance.setViewport(nextViewport, { duration: 180 })
    notifyViewportChange(nextViewport)
  }, [closePaneContextMenu, notifyViewportChange])

  const handleAddTextFromPane = useCallback(() => {
    if (!paneContextMenu) return
    const position = paneContextMenu.flowPosition
    closePaneContextMenu()
    onAddTextAtPosition(position)
  }, [closePaneContextMenu, onAddTextAtPosition, paneContextMenu])

  const handleAddImageFromPane = useCallback(() => {
    if (!paneContextMenu) return
    const position = paneContextMenu.flowPosition
    closePaneContextMenu()
    onAddImageAtPosition(position)
  }, [closePaneContextMenu, onAddImageAtPosition, paneContextMenu])

  const handleAddPromptFromPane = useCallback(() => {
    if (!paneContextMenu) return
    const position = paneContextMenu.flowPosition
    closePaneContextMenu()
    onAddPromptAtPosition?.(position)
  }, [closePaneContextMenu, onAddPromptAtPosition, paneContextMenu])

  const handleInsertAssetFromPane = useCallback(() => {
    if (!paneContextMenu) return
    closePaneContextMenu()
    onInsertAssetFromPane?.()
  }, [closePaneContextMenu, onInsertAssetFromPane, paneContextMenu])

  const handleCreateBoardFromPane = useCallback(() => {
    if (!paneContextMenu) return
    closePaneContextMenu()
    onCreateBoardFromPane?.()
  }, [closePaneContextMenu, onCreateBoardFromPane, paneContextMenu])

  const handleResetZoomFromPane = useCallback(() => {
    if (!paneContextMenu) return
    closePaneContextMenu()
    onResetZoomFromPane?.()
  }, [closePaneContextMenu, onResetZoomFromPane, paneContextMenu])

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
      if (!connection.source || !connection.target) return
      onConnectNodes({ sourceNodeId: connection.source, targetNodeId: connection.target })
    },
    [onConnectNodes],
  )

  const clearAlignmentGuides = useCallback(() => {
    if (guideFrameRef.current != null) {
      window.cancelAnimationFrame(guideFrameRef.current)
      guideFrameRef.current = null
    }
    setAlignmentGuides([])
  }, [])

  const handleNodeDrag = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      node: Node<CanvasFlowNodeData>,
      draggedNodes: Node<CanvasFlowNodeData>[],
    ) => {
      if (guideFrameRef.current != null) window.cancelAnimationFrame(guideFrameRef.current)
      const movingNodes = draggedNodes.length > 0 ? draggedNodes : [node]
      const nextNodes = flowNodesRef.current.map((flowNode) => {
        const moving = movingNodes.find((item) => item.id === flowNode.id)
        return moving ? { ...flowNode, position: moving.position } : flowNode
      })
      guideFrameRef.current = window.requestAnimationFrame(() => {
        guideFrameRef.current = null
        setAlignmentGuides(computeCanvasAlignmentGuides(nextNodes, movingNodes))
      })
    },
    [],
  )

  const handleNodeDragStop = useCallback(() => {
    clearAlignmentGuides()
  }, [clearAlignmentGuides])

  return (
    <ReactFlowProvider>
      <div
        className={`canvas-stage canvas-stage-tool-${activeTool === 'pan' ? 'pan' : 'select'}`}
        ref={stageRef}
      >
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
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onInit={handleInit}
          onPaneClick={closePaneContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onMoveStart={handleViewportMoveStart}
          onMove={handleViewportMove}
          onMoveEnd={handleViewportMoveEnd}
          onSelectionChange={({ nodes: selected }) =>
            onSelectionChange(selected.map((node) => node.id))
          }
        >
          {snapshot.board.settings.grid !== false && (
            <>
              <Background
                id="canvas-grid-minor"
                gap={24}
                lineWidth={0.7}
                color="var(--canvas-grid-minor-color)"
                variant={BackgroundVariant.Lines}
              />
              <Background
                id="canvas-grid-major"
                gap={96}
                lineWidth={1.1}
                color="var(--canvas-grid-major-color)"
                variant={BackgroundVariant.Lines}
              />
            </>
          )}
          {alignmentGuides.length > 0 && (
            <ViewportPortal>
              <div className="canvas-alignment-guides" aria-hidden>
                {alignmentGuides.map((guide) => (
                  <div
                    key={guide.id}
                    className={`canvas-alignment-guide canvas-alignment-guide-${guide.orientation} canvas-alignment-guide-${guide.kind}`}
                    style={
                      guide.orientation === 'vertical'
                        ? {
                            left: guide.position,
                            top: guide.start,
                            height: guide.end - guide.start,
                          }
                        : {
                            top: guide.position,
                            left: guide.start,
                            width: guide.end - guide.start,
                          }
                    }
                  />
                ))}
              </div>
            </ViewportPortal>
          )}
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
        {paneContextMenu && (
          <div
            className="canvas-pane-context-menu"
            style={{ left: paneContextMenu.left, top: paneContextMenu.top }}
            role="menu"
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={handleAddTextFromPane}>
              <Icons.File size={14} />
              <span>添加文本</span>
            </button>
            <button type="button" role="menuitem" onClick={handleAddImageFromPane}>
              <Icons.Image size={14} />
              <span>上传图片</span>
            </button>
            {onAddPromptAtPosition && (
              <button type="button" role="menuitem" onClick={handleAddPromptFromPane}>
                <Icons.Edit size={14} />
                <span>新建 Prompt</span>
              </button>
            )}
            <div className="canvas-pane-context-divider" />
            {onInsertAssetFromPane && (
              <button type="button" role="menuitem" onClick={handleInsertAssetFromPane}>
                <Icons.Folder size={14} />
                <span>从资产插入</span>
              </button>
            )}
            {onCreateBoardFromPane && (
              <button type="button" role="menuitem" onClick={handleCreateBoardFromPane}>
                <Icons.Plus size={14} />
                <span>新建画布</span>
              </button>
            )}
            <button type="button" role="menuitem" onClick={handleResetZoom}>
              <Icons.RotateCcw size={14} />
              <span>复原缩放比例</span>
            </button>
          </div>
        )}
      </div>
    </ReactFlowProvider>
  )
}
