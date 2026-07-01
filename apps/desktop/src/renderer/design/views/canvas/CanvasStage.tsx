import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
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
import { CanvasSelectionContext } from './canvasSelectionContext'
import { mergeFlowNodes } from './canvasStageNodeSync'
import { computeCanvasAlignmentGuides, type CanvasAlignmentGuide } from './canvasAlignmentGuides'
import { persistCanvasNodeLayoutChanges } from './canvasStageLayout'
import { CANVAS_CAPABILITIES } from './canvas.capabilities'
import { CANVAS_PIPELINE_OPS } from './canvasPipelineOps'
import { getOperationVisual } from './canvasOperationIcons'
import type {
  CanvasEdge,
  CanvasNode as SparkCanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
} from './canvas.types'

const nodeTypes = { sparkCanvasNode: CanvasNode }
const defaultNodeOrigin: NodeOrigin = [0, 0]
const INLINE_NODE_TOOLBAR_HEIGHT = 39

function minimapNodeColor(node: Node<CanvasFlowNodeData>): string {
  const type = node.data.canvasNode.type
  if (type === 'task') return '#22c55e'
  if (type === 'image') return '#3b82f6'
  if (type === 'prompt') return '#f59e0b'
  return '#94a3b8'
}

type CanvasNodeActions = CanvasFlowNodeData['actions']
type CanvasLineageSummary = CanvasFlowNodeData['lineage']
export type CanvasNodeInlineExtension = {
  nodeId: string
  toolbar?: ReactNode
  panel?: ReactNode
  extraHeight: number
  minWidth?: number
}
type CanvasStagePoint = { x: number; y: number }
type PaneContextMenuState = {
  left: number
  top: number
  openSubmenusLeft: boolean
  openSubmenusUp: boolean
  flowPosition: CanvasStagePoint
}

export type CanvasStageViewport = Viewport & {
  width: number
  height: number
}

export type CanvasStageViewportControls = {
  fitView: () => void
  zoomBy: (delta: number) => void
  panBy: (delta: { x: number; y: number }) => void
  centerNodes: (nodeIds: string[]) => boolean
  focusNodes: (
    nodeIds: string[],
    options?: {
      padding?: { top?: number; right?: number; bottom?: number; left?: number }
      preferredWidth?: number
      minZoom?: number
      maxZoom?: number
    },
  ) => boolean
}

function toFlowNode(
  node: SparkCanvasNode,
  actions: CanvasNodeActions,
  lineage: CanvasLineageSummary,
  selected: boolean,
  inlineExtension: CanvasNodeInlineExtension | null,
): Node<CanvasFlowNodeData> {
  const inlineToolbarHeight = inlineExtension?.toolbar ? INLINE_NODE_TOOLBAR_HEIGHT : 0
  const data: CanvasFlowNodeData = {
    actions,
    canvasNode: node,
    ...(lineage ? { lineage } : {}),
    ...(inlineExtension?.toolbar ? { inlineToolbar: inlineExtension.toolbar } : {}),
    ...(inlineExtension?.panel ? { inlinePanel: inlineExtension.panel } : {}),
    ...(inlineExtension ? { inlinePanelExtraHeight: inlineExtension.extraHeight } : {}),
    ...(inlineToolbarHeight > 0 ? { inlineToolbarHeight } : {}),
  }
  const renderedWidth = Math.max(node.width, inlineExtension?.minWidth ?? node.width)
  const renderedHeight = node.height + inlineToolbarHeight + (inlineExtension?.extraHeight ?? 0)
  if (inlineExtension && renderedWidth > node.width) {
    data.inlinePanelExtraWidth = renderedWidth - node.width
  }
  const flowNode: Node<CanvasFlowNodeData> = {
    id: node.id,
    type: 'sparkCanvasNode',
    position: { x: node.x, y: node.y },
    width: renderedWidth,
    height: renderedHeight,
    style: { width: renderedWidth, height: renderedHeight },
    // 节点展开内联面板时强制置顶，避免其它节点的 NodeToolbar 浮层 / 卡片遮挡展开界面。
    zIndex: inlineExtension ? 9999 : node.zIndex,
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
    // 连线统一淡色、无动画、无标签，保持画布安静（颜色由 canvas-edge-* 统一为中性灰）。
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
    if (edge.type === 'group_contains') continue
    const source = ensure(edge.sourceNodeId)
    const target = ensure(edge.targetNodeId)
    source.outgoing += 1
    target.incoming += 1
    if (edge.type === 'generated') source.generated += 1
    if (edge.type === 'used_as_input') source.usedAsInput += 1
  }
  return byNodeId
}

/** 两个选中 id 集合是否相等（用于判断「选中态是否由外部真正变化」） */
function selectedIdSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/** 顺序 id 列表是否相同（避免 setState([]) 每次传入新引用触发无限重渲染） */
function sameIdList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

export function CanvasStage({
  snapshot,
  activeTool,
  selectedNodeIds,
  onSelectionChange,
  onNodesPersist,
  onConnectNodes,
  onDeleteEdges,
  onDuplicateNode,
  onDeleteNode,
  onDownloadMediaNode,
  onToggleLockNode,
  onBringNodeToFront,
  onMergeGroupToImage,
  onCreateGroupFromSelection,
  onAddSelectionToGroup,
  onRemoveNodeFromGroup,
  onDissolveGroup,
  onOpenAiComposer,
  onEditNode,
  onSaveNodeToLibrary,
  onAnnotateImage,
  onSplitGridImage,
  onPreviewPanorama,
  onCreateOperationChild,
  onPipelineAction,
  onSetProductionState,
  onAddTextAtPosition,
  onAddImageAtPosition,
  onAddPromptAtPosition,
  onAddDirectorStageAtPosition,
  onInsertAssetFromPane,
  onCreateBoardFromPane,
  onCreateOperationAtPosition,
  onCreatePipelineAtPosition,
  onNodeSelectIntent,
  onViewportChange,
  onViewportControlsChange,
  onInlinePanelResize,
  nodeInlineExtension,
}: {
  snapshot: CanvasSnapshot
  activeTool: 'select' | 'pan'
  selectedNodeIds: string[]
  onSelectionChange: (nodeIds: string[]) => void
  onNodesPersist: (nodes: SparkCanvasNode[]) => void
  onConnectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => void
  onDeleteEdges: (edgeIds: string[]) => void
  onDuplicateNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onDownloadMediaNode: (nodeId: string) => void
  onToggleLockNode: (nodeId: string) => void
  onBringNodeToFront: (nodeId: string) => void
  onMergeGroupToImage: (groupId: string) => void
  onCreateGroupFromSelection: () => void
  onAddSelectionToGroup: (groupId: string) => void
  onRemoveNodeFromGroup: (nodeId: string) => void
  onDissolveGroup: (groupId: string) => void
  onOpenAiComposer: (nodeId: string) => void
  onEditNode: (nodeId: string) => void
  onSaveNodeToLibrary: (nodeId: string) => void
  onAnnotateImage: (nodeId: string) => void
  onSplitGridImage: (nodeId: string) => void
  /** 360 全景产物节点右键 → 全景预览 */
  onPreviewPanorama: (nodeId: string) => void
  onCreateOperationChild: (
    parentId: string,
    operation: import('./canvas.types').CanvasOperationType,
    options?: { title?: string; prompt?: string; modelParams?: Record<string, unknown> },
  ) => void
  onPipelineAction: (nodeId: string, actionId: string) => void
  onSetProductionState: (
    nodeId: string,
    state: import('./canvas.types').CanvasProductionState,
  ) => void
  onAddTextAtPosition: (position: CanvasStagePoint) => void
  onAddImageAtPosition: (position: CanvasStagePoint) => void
  /** 空白右键：新建 Prompt 节点 */
  onAddPromptAtPosition?: (position: CanvasStagePoint) => void
  /** 空白右键：新建 3D 导演台节点 */
  onAddDirectorStageAtPosition?: (position: CanvasStagePoint) => void
  /** 空白右键：从资产插入（打开资产面板） */
  onInsertAssetFromPane?: () => void
  /** 空白右键：新建 board */
  onCreateBoardFromPane?: () => void
  /** 空白右键：创建 AI 操作节点（无上游，由用户后续连线） */
  onCreateOperationAtPosition?: (operation: CanvasOperationType, position: CanvasStagePoint) => void
  /** 空白右键：创建流水线编排节点（提取角色/场景、转剧本、生成分镜脚本等） */
  onCreatePipelineAtPosition?: (actionId: string, position: CanvasStagePoint) => void
  /** 用户明确点击某个节点，用于恢复被手动关闭的节点面板 */
  onNodeSelectIntent?: (nodeId: string) => void
  onViewportChange?: (viewport: CanvasStageViewport) => void
  onViewportControlsChange?: (controls: CanvasStageViewportControls | null) => void
  onInlinePanelResize?: (nodeId: string, extraHeight: number) => void
  nodeInlineExtension?: CanvasNodeInlineExtension | null
}) {
  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      duplicateNode: onDuplicateNode,
      deleteNode: onDeleteNode,
      downloadMedia: onDownloadMediaNode,
      toggleLockNode: onToggleLockNode,
      bringNodeToFront: onBringNodeToFront,
      mergeGroupToImage: onMergeGroupToImage,
      createGroupFromSelection: onCreateGroupFromSelection,
      addSelectionToGroup: onAddSelectionToGroup,
      removeNodeFromGroup: onRemoveNodeFromGroup,
      dissolveGroup: onDissolveGroup,
      openAiComposer: onOpenAiComposer,
      editNode: onEditNode,
      saveToLibrary: onSaveNodeToLibrary,
      annotateImage: onAnnotateImage,
      splitGridImage: onSplitGridImage,
      previewPanorama: onPreviewPanorama,
      createOperationChild: onCreateOperationChild,
      pipelineAction: onPipelineAction,
      setProductionState: onSetProductionState,
    }),
    [
      onAddSelectionToGroup,
      onBringNodeToFront,
      onCreateGroupFromSelection,
      onDeleteNode,
      onDownloadMediaNode,
      onDissolveGroup,
      onDuplicateNode,
      onEditNode,
      onMergeGroupToImage,
      onOpenAiComposer,
      onAnnotateImage,
      onSplitGridImage,
      onPreviewPanorama,
      onRemoveNodeFromGroup,
      onCreateOperationChild,
      onPipelineAction,
      onSetProductionState,
      onSaveNodeToLibrary,
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
          selectedNodeIdSet.has(node.id),
          nodeInlineExtension?.nodeId === node.id ? nodeInlineExtension : null,
        ),
      ),
    [lineageSummaries, nodeActions, nodeInlineExtension, selectedNodeIdSet, snapshot.nodes],
  )
  const [flowNodes, setFlowNodes] = useState(nodes)
  const stageRef = useRef<HTMLDivElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node<CanvasFlowNodeData>, Edge> | null>(null)
  const flowNodesRef = useRef(nodes)
  const latestViewportRef = useRef<Viewport>(snapshot.board.viewport)
  const syncFrameRef = useRef<number | null>(null)
  const guideFrameRef = useRef<number | null>(null)
  const viewportInteractingRef = useRef(false)
  const nodeDragStateRef = useRef<{ nodeId: string | null; dragging: boolean; endedAt: number }>({
    nodeId: null,
    dragging: false,
    endedAt: 0,
  })
  const pendingNodesSyncRef = useRef<Node<CanvasFlowNodeData>[] | null>(null)
  // 记录上一次「已应用到画布」的外部选中集合，用于区分：
  // - 选中态确实由外部变化（用户点选落定 / 程序化选中）→ 用外部值覆盖
  // - 仅快照内容刷新（任务轮询、尺寸测量等）→ 保留 ReactFlow 实时选中态，避免被旧值冲掉
  const prevSelectedIdSetRef = useRef(selectedNodeIdSet)
  const [alignmentGuides, setAlignmentGuides] = useState<CanvasAlignmentGuide[]>([])
  const [paneContextMenu, setPaneContextMenu] = useState<PaneContextMenuState | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [edgeContextMenu, setEdgeContextMenu] = useState<{
    edgeId: string
    left: number
    top: number
  } | null>(null)
  const edges = useMemo(
    () => snapshot.edges.filter((edge) => edge.type !== 'group_contains').map(toFlowEdge),
    [snapshot.edges],
  )

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

  useEffect(() => {
    if (!onViewportControlsChange) return
    const resolveNodeBounds = (nodeIds: string[]) => {
      const nodeIdSet = new Set(nodeIds)
      const nodesToCenter = flowNodesRef.current.filter((item) => nodeIdSet.has(item.id))
      if (nodesToCenter.length === 0) return null
      return nodesToCenter.reduce(
        (acc, node) => {
          const width = typeof node.width === 'number' ? node.width : 0
          const height = typeof node.height === 'number' ? node.height : 0
          return {
            minX: Math.min(acc.minX, node.position.x),
            minY: Math.min(acc.minY, node.position.y),
            maxX: Math.max(acc.maxX, node.position.x + width),
            maxY: Math.max(acc.maxY, node.position.y + height),
          }
        },
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        },
      )
    }
    onViewportControlsChange({
      fitView: () => {
        void flowInstanceRef.current?.fitView({ padding: 0.2, minZoom: 0.55, maxZoom: 1.15, duration: 260 })
      },
      zoomBy: (delta: number) => {
        const instance = flowInstanceRef.current
        if (!instance) return
        const current = latestViewportRef.current
        const nextZoom = Math.max(0.2, Math.min(2, current.zoom + delta))
        const nextViewport = { ...current, zoom: nextZoom }
        void instance.setViewport(nextViewport, { duration: 180 })
        notifyViewportChange(nextViewport)
      },
      panBy: (delta: { x: number; y: number }) => {
        const instance = flowInstanceRef.current
        if (!instance) return
        const current = latestViewportRef.current
        const nextViewport = { ...current, x: current.x + delta.x, y: current.y + delta.y }
        void instance.setViewport(nextViewport, { duration: 160 })
        notifyViewportChange(nextViewport)
      },
      centerNodes: (nodeIds: string[]) => {
        const bounds = resolveNodeBounds(nodeIds)
        if (!bounds) return false
        const zoom = latestViewportRef.current.zoom || 1
        flowInstanceRef.current?.setCenter(
          bounds.minX + (bounds.maxX - bounds.minX) / 2,
          bounds.minY + (bounds.maxY - bounds.minY) / 2,
          { zoom, duration: 260 },
        )
        return true
      },
      focusNodes: (nodeIds, options) => {
        const bounds = resolveNodeBounds(nodeIds)
        const rect = stageRef.current?.getBoundingClientRect()
        if (!bounds || !rect || rect.width <= 0 || rect.height <= 0) return false

        const padding = {
          top: options?.padding?.top ?? 92,
          right: options?.padding?.right ?? 48,
          bottom: options?.padding?.bottom ?? 360,
          left: options?.padding?.left ?? 48,
        }
        const availableWidth = Math.max(160, rect.width - padding.left - padding.right)
        const availableHeight = Math.max(160, rect.height - padding.top - padding.bottom)
        const width = Math.max(1, bounds.maxX - bounds.minX)
        const height = Math.max(1, bounds.maxY - bounds.minY)
        const minZoom = options?.minZoom ?? 0.55
        const maxZoom = options?.maxZoom ?? 1.15
        const preferredWidth = options?.preferredWidth ?? 520
        const preferredZoom = preferredWidth / width
        const fitZoom = Math.min(availableWidth / width, availableHeight / height)
        const zoom = Math.max(minZoom, Math.min(maxZoom, preferredZoom, fitZoom))

        const desiredCenterX = padding.left + availableWidth / 2
        const desiredCenterY = padding.top + availableHeight / 2
        const screenDeltaX = desiredCenterX - rect.width / 2
        const screenDeltaY = desiredCenterY - rect.height / 2
        const centerX = bounds.minX + width / 2 - screenDeltaX / zoom
        const centerY = bounds.minY + height / 2 - screenDeltaY / zoom
        flowInstanceRef.current?.setCenter(centerX, centerY, { zoom, duration: 280 })
        return true
      },
    })
    return () => onViewportControlsChange(null)
  }, [notifyViewportChange, onViewportControlsChange])

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
        const merged = mergeFlowNodes(flowNodesRef.current, nextNodes)
        flowNodesRef.current = merged
        setFlowNodes(merged)
      })
    },
    [cancelScheduledSync],
  )

  useEffect(() => {
    const selectionChangedExternally = !selectedIdSetsEqual(
      prevSelectedIdSetRef.current,
      selectedNodeIdSet,
    )
    prevSelectedIdSetRef.current = selectedNodeIdSet

    // 选中态没有外部变化时，仅做内容同步并保留 ReactFlow 实时选中态：
    // nodes memo 里烤进去的 selected 可能比 ReactFlow 内部状态慢一拍（外部 selectedNodeIds
    // 是异步 setState），直接覆盖会把刚点亮的节点冲灭，进而触发 onSelectionChange([]) 把选中清空。
    const nextNodes = selectionChangedExternally
      ? nodes
      : (() => {
          const liveSelected = new Set(
            flowNodesRef.current.filter((node) => node.selected).map((node) => node.id),
          )
          return nodes.map((node) =>
            node.selected === liveSelected.has(node.id)
              ? node
              : { ...node, selected: liveSelected.has(node.id) },
          )
        })()

    if (viewportInteractingRef.current) {
      pendingNodesSyncRef.current = nextNodes
      return
    }
    syncFlowNodes(nextNodes)
  }, [nodes, selectedNodeIdSet, syncFlowNodes])

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
    setEdgeContextMenu(null)
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

      const menuWidth = 320
      const menuHeight = 520
      const minInset = 8
      const rawLeft = event.clientX - rect.left
      const rawTop = event.clientY - rect.top
      const left = Math.min(
        Math.max(rawLeft, minInset),
        Math.max(rect.width - menuWidth - minInset, minInset),
      )
      const top = Math.min(
        Math.max(rawTop, minInset),
        Math.max(rect.height - menuHeight - minInset, minInset),
      )

      setPaneContextMenu({
        left,
        top,
        openSubmenusLeft: rawLeft > rect.width - 420,
        openSubmenusUp: rawTop > rect.height / 2,
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

  const handlePaneClick = useCallback(() => {
    closePaneContextMenu()
    setEdgeContextMenu(null)
  }, [closePaneContextMenu])

  useEffect(() => {
    if (!paneContextMenu && !edgeContextMenu) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePaneContextMenu()
        setEdgeContextMenu(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closePaneContextMenu)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closePaneContextMenu)
    }
  }, [closePaneContextMenu, edgeContextMenu, paneContextMenu])

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

  const handleAddDirectorStageFromPane = useCallback(() => {
    if (!paneContextMenu) return
    const position = paneContextMenu.flowPosition
    closePaneContextMenu()
    onAddDirectorStageAtPosition?.(position)
  }, [closePaneContextMenu, onAddDirectorStageAtPosition, paneContextMenu])

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

  const handleCreateOperationFromPane = useCallback(
    (operation: CanvasOperationType) => {
      if (!paneContextMenu) return
      const position = paneContextMenu.flowPosition
      closePaneContextMenu()
      onCreateOperationAtPosition?.(operation, position)
    },
    [closePaneContextMenu, onCreateOperationAtPosition, paneContextMenu],
  )

  const handleCreatePipelineFromPane = useCallback(
    (actionId: string) => {
      if (!paneContextMenu) return
      const position = paneContextMenu.flowPosition
      closePaneContextMenu()
      onCreatePipelineAtPosition?.(actionId, position)
    },
    [closePaneContextMenu, onCreatePipelineAtPosition, paneContextMenu],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasFlowNodeData>>[]) => {
      const nextFlowNodes = applyNodeChanges(changes, flowNodesRef.current)
      flowNodesRef.current = nextFlowNodes
      setFlowNodes(nextFlowNodes)

      const inlineDimensionDone = changes.some(
        (change) =>
          change.type === 'dimensions' &&
          change.id === nodeInlineExtension?.nodeId &&
          change.resizing === false,
      )
      if (inlineDimensionDone && nodeInlineExtension) {
        const flowNode = nextFlowNodes.find((node) => node.id === nodeInlineExtension.nodeId)
        const baseNode = snapshot.nodes.find((node) => node.id === nodeInlineExtension.nodeId)
        const measuredHeight =
          typeof flowNode?.measured?.height === 'number'
            ? flowNode.measured.height
            : typeof flowNode?.height === 'number'
              ? flowNode.height
              : null
        if (baseNode && measuredHeight != null) {
          const toolbarHeight = flowNode?.data.inlineToolbarHeight ?? 0
          const nextExtraHeight = Math.max(
            280,
            Math.round(measuredHeight - baseNode.height - toolbarHeight),
          )
          onInlinePanelResize?.(baseNode.id, nextExtraHeight)
        }
      }

      const nextPersistedNodes = persistCanvasNodeLayoutChanges(
        snapshot.nodes,
        nextFlowNodes,
        changes,
      )
      if (nextPersistedNodes) {
        onNodesPersist(nextPersistedNodes)
      }
    },
    [nodeInlineExtension, onInlinePanelResize, onNodesPersist, snapshot.nodes],
  )

  const deleteSelectedEdges = useCallback(() => {
    if (selectedEdgeIds.length === 0) return
    onDeleteEdges(selectedEdgeIds)
    setSelectedEdgeIds((previous) => (previous.length === 0 ? previous : []))
    setEdgeContextMenu(null)
  }, [onDeleteEdges, selectedEdgeIds])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedEdgeIds.length === 0 || isEditableEventTarget(event.target)) return
      event.preventDefault()
      deleteSelectedEdges()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelectedEdges, selectedEdgeIds.length])

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

  const handleNodeDragStart = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node<CanvasFlowNodeData>) => {
      nodeDragStateRef.current = { nodeId: node.id, dragging: true, endedAt: 0 }
      setPaneContextMenu(null)
    },
    [],
  )

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node<CanvasFlowNodeData>) => {
      nodeDragStateRef.current = { nodeId: node.id, dragging: false, endedAt: Date.now() }
      clearAlignmentGuides()
    },
    [clearAlignmentGuides],
  )

  const handleEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedEdgeIds([edge.id])
    setEdgeContextMenu({
      edgeId: edge.id,
      left: event.clientX - rect.left,
      top: event.clientY - rect.top,
    })
  }, [])

  const handleNodeClick = useCallback(
    (event: ReactMouseEvent, node: Node<CanvasFlowNodeData>) => {
      const dragState = nodeDragStateRef.current
      if (
        dragState.dragging ||
        (dragState.nodeId === node.id && Date.now() - dragState.endedAt < 220)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) return
      onNodeSelectIntent?.(node.id)
    },
    [onNodeSelectIntent],
  )

  const handleSelectionChange = useCallback(
    ({
      nodes: selected,
      edges: selectedEdges,
    }: {
      nodes: Node<CanvasFlowNodeData>[]
      edges: Edge[]
    }) => {
      onSelectionChange(selected.map((node) => node.id))
      const nextEdgeIds = selectedEdges.map((edge) => edge.id)
      setSelectedEdgeIds((previous) => (sameIdList(previous, nextEdgeIds) ? previous : nextEdgeIds))
      if (selectedEdges.length === 0) setEdgeContextMenu(null)
    },
    [onSelectionChange],
  )

  return (
    <ReactFlowProvider>
      <CanvasSelectionContext.Provider value={selectedNodeIds.length}>
        <div
          className={`canvas-stage canvas-stage-tool-${activeTool === 'pan' ? 'pan' : 'select'}${
            snapshot.board.settings.grid === true ? '' : ' canvas-stage-grid-off'
          }`}
          ref={stageRef}
        >
          <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.55, maxZoom: 1.15 }}
          minZoom={0.25}
          maxZoom={2.4}
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
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onInit={handleInit}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          onMoveStart={handleViewportMoveStart}
          onMove={handleViewportMove}
          onMoveEnd={handleViewportMoveEnd}
          onNodeClick={handleNodeClick}
          onEdgeContextMenu={handleEdgeContextMenu}
          onSelectionChange={handleSelectionChange}
        >
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
          <MiniMap className="canvas-minimap" nodeColor={minimapNodeColor} />
          <Controls className="canvas-controls" />
        </ReactFlow>
        {selectedEdgeIds.length > 0 && (
          <button type="button" className="canvas-edge-delete-button" onClick={deleteSelectedEdges}>
            删除连线
          </button>
        )}
        {edgeContextMenu && (
          <div
            className="canvas-edge-context-menu"
            style={{ left: edgeContextMenu.left, top: edgeContextMenu.top }}
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDeleteEdges([edgeContextMenu.edgeId])
                setSelectedEdgeIds((previous) => (previous.length === 0 ? previous : []))
                setEdgeContextMenu(null)
              }}
            >
              <Icons.Trash size={14} />
              <span>删除连线</span>
            </button>
          </div>
        )}
        {paneContextMenu && (
          <div
            className={`canvas-pane-context-menu${
              paneContextMenu.openSubmenusLeft ? ' canvas-pane-context-menu-submenus-left' : ''
            }${paneContextMenu.openSubmenusUp ? ' canvas-pane-context-menu-submenus-up' : ''}`}
            style={{ left: paneContextMenu.left, top: paneContextMenu.top }}
            role="menu"
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="canvas-pane-context-section-title">资源内容节点</div>
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
            {onAddDirectorStageAtPosition && (
              <button type="button" role="menuitem" onClick={handleAddDirectorStageFromPane}>
                <Icons.Play size={14} />
                <span>新建 3D 导演台</span>
              </button>
            )}
            {onInsertAssetFromPane && (
              <button type="button" role="menuitem" onClick={handleInsertAssetFromPane}>
                <Icons.Folder size={14} />
                <span>从资产选择</span>
              </button>
            )}
            <div className="canvas-pane-context-divider" />
            <div className="canvas-pane-context-section-title">任务节点</div>
            {onCreatePipelineAtPosition && (
              <div className="canvas-pane-context-submenu" role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="canvas-pane-context-submenu-trigger"
                >
                  <Icons.Workflow size={14} />
                  <span>剧本流水线</span>
                  <Icons.ChevronRight size={14} />
                </button>
                <div className="canvas-pane-context-submenu-panel" role="menu">
                  {CANVAS_PIPELINE_OPS.filter(
                    (op) => op.appliesToText && (op.kind === 'text' || op.kind === 'extract'),
                  ).map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleCreatePipelineFromPane(op.id)}
                    >
                      <Icons.Workflow size={14} />
                      <span>{op.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {onCreateOperationAtPosition && (
              <div className="canvas-pane-context-submenu" role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="canvas-pane-context-submenu-trigger"
                >
                  <Icons.Sparkles size={14} />
                  <span>AI 操作</span>
                  <Icons.ChevronRight size={14} />
                </button>
                <div className="canvas-pane-context-submenu-panel" role="menu">
                  {CANVAS_CAPABILITIES.map((capability) => {
                    const visual = getOperationVisual(capability.operation)
                    return (
                      <button
                        key={capability.id}
                        type="button"
                        role="menuitem"
                        className={`canvas-pane-context-op ${visual.colorClass}`}
                        onClick={() => handleCreateOperationFromPane(capability.operation)}
                      >
                        <span className="canvas-pane-context-op-icon">{visual.icon}</span>
                        <span>{capability.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="canvas-pane-context-divider" />
            <div className="canvas-pane-context-section-title">画布</div>
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
      </CanvasSelectionContext.Provider>
    </ReactFlowProvider>
  )
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable ||
    Boolean(
      target.closest('[contenteditable="true"], .ant-modal, .ant-drawer, .canvas-operation-panel'),
    )
  )
}
