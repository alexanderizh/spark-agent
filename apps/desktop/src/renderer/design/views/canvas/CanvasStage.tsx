import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  applyNodeChanges,
  useNodesInitialized,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  type NodeOrigin,
  type ReactFlowInstance,
  type Viewport,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Icons } from '../../Icons'
import { CanvasNode, type CanvasFlowNodeData } from './CanvasNode'
import { CanvasZoomControls } from './CanvasZoomControls'
import type { CanvasNodeData } from './canvas.types'
import { mergeFlowNodes } from './canvasStageNodeSync'
import { computeCanvasAlignmentGuides, type CanvasAlignmentGuide } from './canvasAlignmentGuides'
import {
  arrangeCanvasNodes,
  type CanvasAutoLayoutLink,
  type CanvasAutoLayoutMode,
  type CanvasAutoLayoutNode,
  type CanvasAutoLayoutSpacing,
} from './canvasAutoLayout'
import { persistCanvasNodeLayoutChanges } from './canvasStageLayout'
import { isOperationNode } from './canvas.capabilities'
import { canvasNodeChromeExtraHeight } from './canvasNodeChrome'
import {
  isFullBleedCanvasImageNode,
  resolveCanvasImageNodePresentationSize,
  type CanvasImageSourceDimensions,
} from './canvasImageNodePresentation'
import {
  CANVAS_NODE_META_BAR_HEIGHT,
  OPERATION_NODE_DEFAULT_SIZE,
  fitCollectionOperationNodeSize,
  fitShotScriptOperationNodeSize,
} from './canvasNodeSize'
import { readRenderableShotScriptRows } from './canvasShotScriptPresentation'
import { CANVAS_PIPELINE_MENU_GROUPS, CANVAS_PIPELINE_OPS } from './canvasPipelineOps'
import { getNodePipelineActions } from './canvasPipeline'
import {
  CANVAS_BASE_CREATE_OPERATION_GROUPS,
  CANVAS_BASE_TASK_MENU_LABEL,
  CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
  CANVAS_FUNCTIONAL_MENU_LABEL,
} from './canvasNodeGenerationMenu'
import { getOperationVisual } from './canvasOperationIcons'
import { readCharacterSubviews } from './canvasCharacterLibrary'
import { readAssetKind } from './canvasFilmAssets'
import type { CanvasPipelineAssetKind } from './canvasPipelineOps'
import {
  buildCanvasOperationRunViews,
  canvasOperationRunsFingerprint,
  type CanvasOperationRunView,
} from './canvasOperationRuns'
import {
  resolveCanvasOperationOutputState,
  resolveCanvasOperationResourceNode,
} from './canvasOperationOutputModel'
import { buildCanvasOperationProjection } from './canvasOperationProjection'
import {
  calculateCanvasContextMenuPosition,
  CANVAS_CONTEXT_MENU_STAGE_INSETS,
  shouldOpenCanvasSelectionContextMenu,
  summarizeCanvasSelectionContext,
} from './canvasContextMenuModel'
import {
  buildPendingConnectionInput,
  type PendingCanvasConnection,
} from './canvasPendingConnection'
import { shouldClearCanvasSelectionOnEscape } from './canvasSelectionKeyboard'
import { findSelectedCanvasNodeScrollRegion } from './canvasWheelInteraction'
import type {
  CanvasEdge,
  CanvasNode as SparkCanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
} from './canvas.types'

const nodeTypes = { sparkCanvasNode: CanvasNode }
const defaultNodeOrigin: NodeOrigin = [0, 0]
const INLINE_NODE_TOOLBAR_HEIGHT = 39
const CANVAS_MINIMAP_WIDTH = 196
const CANVAS_MINIMAP_HEIGHT = 124
const CANVAS_MIN_ZOOM = 0.08
const CANVAS_MAX_ZOOM = 4.5
const CANVAS_FIT_MIN_ZOOM = 0.25
const CANVAS_FIT_MAX_ZOOM = 1.8
const CANVAS_WHEEL_PAN_SPEED = 1
const CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.00075
const CANVAS_KEYBOARD_PAN_STEP = 96
const CANVAS_KEYBOARD_PAN_FAST_STEP = 260
const CANVAS_DOT_GRID_SPACING = 28
const CANVAS_DOT_GRID_OFFSET = 14
const CANVAS_DOT_HOVER_RADIUS = 5
const CANVAS_DOT_AURA_POINTS = Array.from({ length: CANVAS_DOT_HOVER_RADIUS * 2 + 1 }, (_, row) =>
  Array.from({ length: CANVAS_DOT_HOVER_RADIUS * 2 + 1 }, (_, column) => {
    const gridX = column - CANVAS_DOT_HOVER_RADIUS
    const gridY = row - CANVAS_DOT_HOVER_RADIUS
    const distance = Math.hypot(gridX, gridY)
    if (distance > CANVAS_DOT_HOVER_RADIUS + 0.35) return null
    const intensity = Math.max(0, 1 - distance / (CANVAS_DOT_HOVER_RADIUS + 0.55))
    const ring = distance <= 0.5 ? 0 : distance <= 1.65 ? 1 : 2
    const color =
      ring === 0
        ? 'rgba(246, 91, 222, 0.96)'
        : ring === 1
          ? 'rgba(208, 122, 255, 0.8)'
          : 'rgba(125, 211, 252, 0.34)'
    return {
      id: `${gridX}:${gridY}`,
      offsetX: gridX * CANVAS_DOT_GRID_SPACING,
      offsetY: gridY * CANVAS_DOT_GRID_SPACING,
      opacity: 0.28 + intensity * 0.72,
      scale: 0.68 + intensity * 0.78,
      color,
    }
  }).filter((point): point is NonNullable<typeof point> => Boolean(point)),
).flat()

function minimapNodeColor(node: Node<CanvasFlowNodeData>): string {
  const type = node.data.canvasNode.type
  if (type === 'task') return '#22c55e'
  if (type === 'image') return '#3b82f6'
  if (type === 'prompt') return '#f59e0b'
  return '#94a3b8'
}

type CanvasNodeActions = CanvasFlowNodeData['actions']
type CanvasLineageSummary = CanvasFlowNodeData['lineage']
type CanvasStagePoint = { x: number; y: number }
type MaybePromise<T> = T | Promise<T>
type CanvasStageCreateResult = SparkCanvasNode | null | undefined | void
type CanvasStageCreateAction = (
  position: CanvasStagePoint,
  pendingConnection?: PendingCanvasConnection | null,
) => MaybePromise<CanvasStageCreateResult>
export type CanvasNodeInlineExtension = {
  nodeId: string
  toolbar?: ReactNode
  panel?: ReactNode
  extraHeight: number
  minWidth?: number
}
type PaneContextMenuState = {
  left: number
  top: number
  maxHeight: number
  openSubmenusLeft: boolean
  openSubmenusUp: boolean
  anchorPoint: CanvasStagePoint
  flowPosition: CanvasStagePoint
  pendingConnection: PendingCanvasConnection | null
}

type CanvasPaneContextSubmenuProps = {
  icon: ReactNode
  label: string
  openLeft: boolean
  openUp: boolean
  children: ReactNode
}

function CanvasPaneContextSubmenu({
  icon,
  label,
  openLeft,
  openUp,
  children,
}: CanvasPaneContextSubmenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    left: number
    top: number
    maxHeight: number
    maxWidth: number
  } | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current == null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const showPanel = useCallback(() => {
    cancelClose()
    setOpen(true)
  }, [cancelClose])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      setPosition(null)
    }, 120)
  }, [cancelClose])

  useEffect(() => cancelClose, [cancelClose])

  useLayoutEffect(() => {
    if (!open) return undefined
    const trigger = triggerRef.current
    const panel = panelRef.current
    const stage = trigger?.closest<HTMLElement>('.canvas-stage')
    if (!trigger || !panel || !stage) return undefined

    const updatePosition = () => {
      const triggerRect = trigger.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const safeTop = stageRect.top + CANVAS_CONTEXT_MENU_STAGE_INSETS.top
      const safeRight = stageRect.right - CANVAS_CONTEXT_MENU_STAGE_INSETS.right
      const safeBottom = stageRect.bottom - CANVAS_CONTEXT_MENU_STAGE_INSETS.bottom
      const safeLeft = stageRect.left + CANVAS_CONTEXT_MENU_STAGE_INSETS.left
      const maxHeight = Math.max(0, Math.min(440, safeBottom - safeTop))
      const maxWidth = Math.max(0, safeRight - safeLeft)
      const panelWidth = Math.min(panel.offsetWidth, maxWidth)
      const panelHeight = Math.min(panel.scrollHeight, maxHeight)
      const preferredLeft = openLeft ? triggerRect.left - panelWidth + 4 : triggerRect.right - 4
      const preferredTop = openUp ? triggerRect.bottom - panelHeight : triggerRect.top
      const left = Math.min(Math.max(preferredLeft, safeLeft), safeRight - panelWidth)
      const top = Math.min(Math.max(preferredTop, safeTop), safeBottom - panelHeight)
      setPosition((current) =>
        current?.left === left &&
        current.top === top &&
        current.maxHeight === maxHeight &&
        current.maxWidth === maxWidth
          ? current
          : { left, top, maxHeight, maxWidth },
      )
    }

    updatePosition()
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    resizeObserver?.observe(stage)
    resizeObserver?.observe(panel)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, openLeft, openUp])

  return (
    <div
      className="canvas-pane-context-submenu"
      role="none"
      onMouseEnter={showPanel}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="canvas-pane-context-submenu-trigger"
        onFocus={showPanel}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget
          if (nextTarget instanceof HTMLElement && panelRef.current?.contains(nextTarget)) return
          scheduleClose()
        }}
      >
        {icon}
        <span>{label}</span>
        <Icons.ChevronRight size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="canvas-pane-context-submenu-panel"
            role="menu"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              maxHeight: position?.maxHeight,
              maxWidth: position?.maxWidth,
              visibility: position ? 'visible' : 'hidden',
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget
              if (nextTarget instanceof HTMLElement && panelRef.current?.contains(nextTarget))
                return
              scheduleClose()
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

function CanvasPaneResourceNodeActions({
  onAddText,
  onAddImage,
  onAddDirectorStage3D,
  onAddVideoWorkbench,
  onInsertAsset,
}: {
  onAddText?: (() => void) | undefined
  onAddImage?: (() => void) | undefined
  onAddDirectorStage3D?: (() => void) | undefined
  onAddVideoWorkbench?: (() => void) | undefined
  onInsertAsset?: (() => void) | undefined
}) {
  return (
    <>
      {onAddText && (
        <button type="button" role="menuitem" onClick={onAddText}>
          <Icons.File size={14} />
          <span>添加文本</span>
        </button>
      )}
      {onAddImage && (
        <button type="button" role="menuitem" onClick={onAddImage}>
          <Icons.Image size={14} />
          <span>上传图片</span>
        </button>
      )}
      {onAddDirectorStage3D && (
        <button type="button" role="menuitem" onClick={onAddDirectorStage3D}>
          <Icons.Box size={14} />
          <span>新建 3D 导演台</span>
        </button>
      )}
      {onAddVideoWorkbench && (
        <button type="button" role="menuitem" onClick={onAddVideoWorkbench}>
          <Icons.Video size={14} />
          <span>新建视频工作台</span>
        </button>
      )}
      {onInsertAsset && (
        <button type="button" role="menuitem" onClick={onInsertAsset}>
          <Icons.Folder size={14} />
          <span>从资产选择</span>
        </button>
      )}
    </>
  )
}

export type CanvasStageViewport = Viewport & {
  width: number
  height: number
}

export type CanvasStageViewportControls = {
  getViewport: () => Viewport | null
  fitView: () => void
  zoomBy: (delta: number) => void
  panBy: (delta: { x: number; y: number }) => void
  setViewport: (viewport: Viewport, options?: { duration?: number }) => void
  arrangeNodes: (options: {
    mode: CanvasAutoLayoutMode
    spacing: CanvasAutoLayoutSpacing
    nodeIds?: string[]
  }) => Promise<boolean>
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

const OPERATION_RUN_NAV_HEIGHT = 31

function operationNodePresentationSize(
  node: SparkCanvasNode,
  runs: CanvasOperationRunView[],
): { width: number; height: number } {
  if (!isOperationNode(node)) return { width: node.width, height: node.height }
  const outputState = resolveCanvasOperationOutputState(node, runs)
  const output = outputState.primaryOutput
  const latestOutputs =
    outputState.latestRunWithOutputsIndex >= 0
      ? (runs[outputState.latestRunWithOutputsIndex]?.outputs ?? [])
      : []
  if (outputState.mode === 'collection' && latestOutputs.length > 0) {
    const fittedSize = fitCollectionOperationNodeSize(latestOutputs.length)
    return {
      width: node.width <= OPERATION_NODE_DEFAULT_SIZE.width ? fittedSize.width : node.width,
      height: node.height <= OPERATION_NODE_DEFAULT_SIZE.height ? fittedSize.height : node.height,
    }
  }
  const storyboardRows = readRenderableShotScriptRows(output?.text)
  if (storyboardRows.length > 0) {
    const fittedSize = fitShotScriptOperationNodeSize(storyboardRows.length)
    return {
      width: node.width <= OPERATION_NODE_DEFAULT_SIZE.width ? fittedSize.width : node.width,
      height: node.height <= OPERATION_NODE_DEFAULT_SIZE.height ? fittedSize.height : node.height,
    }
  }
  if (!output || (output.type !== 'image' && output.type !== 'video')) {
    return {
      width: node.width,
      height: Math.max(node.height, OPERATION_NODE_DEFAULT_SIZE.height),
    }
  }

  const fallbackAspectRatio = output.type === 'video' ? 16 / 9 : 1
  const aspectRatio =
    output.width && output.height ? output.width / output.height : fallbackAspectRatio
  const mediaHeight = Math.min(720, Math.max(160, Math.round(node.width / aspectRatio)))
  return {
    width: node.width,
    height: Math.max(
      node.height,
      mediaHeight + CANVAS_NODE_META_BAR_HEIGHT + OPERATION_RUN_NAV_HEIGHT,
    ),
  }
}

function flowNodeToAutoLayoutNode(node: Node<CanvasFlowNodeData>): CanvasAutoLayoutNode {
  const width =
    typeof node.measured?.width === 'number'
      ? node.measured.width
      : typeof node.width === 'number'
        ? node.width
        : node.data.canvasNode.width
  const height =
    typeof node.measured?.height === 'number'
      ? node.measured.height
      : typeof node.height === 'number'
        ? node.height
        : node.data.canvasNode.height
  const hasInlineExtension = Boolean(node.data.inlineToolbar || node.data.inlinePanel)
  const hasOverlayChrome = isFullBleedCanvasImageNode(node.data.canvasNode)
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width,
    height,
    headerHeight: hasInlineExtension || hasOverlayChrome ? 0 : CANVAS_NODE_META_BAR_HEIGHT,
  }
}

function toFlowNode(
  node: SparkCanvasNode,
  actions: CanvasNodeActions,
  lineage: CanvasLineageSummary,
  selected: boolean,
  inlineExtension: CanvasNodeInlineExtension | null,
  assetSubviewCount = 0,
  operationRuns: CanvasOperationRunView[] = [],
  assetKinds: CanvasPipelineAssetKind[] = [],
  isGeneratedOutput = false,
  imageSourceDimensions?: CanvasImageSourceDimensions,
): Node<CanvasFlowNodeData> {
  const inlineToolbarHeight = inlineExtension?.toolbar ? INLINE_NODE_TOOLBAR_HEIGHT : 0
  const cardChromeExtraHeight = canvasNodeChromeExtraHeight(node)
  const presentationSize =
    resolveCanvasImageNodePresentationSize(node, imageSourceDimensions) ??
    operationNodePresentationSize(node, operationRuns)
  const baseRenderedHeight = presentationSize.height + cardChromeExtraHeight
  const data: CanvasFlowNodeData = {
    actions,
    canvasNode: node,
    ...(assetKinds.length > 0 ? { assetKinds } : {}),
    ...(assetSubviewCount > 0 ? { assetSubviewCount } : {}),
    ...(operationRuns.length > 0
      ? {
          operationRuns,
          operationRunsFingerprint: canvasOperationRunsFingerprint(operationRuns),
        }
      : {}),
    ...(isGeneratedOutput ? { isGeneratedOutput: true } : {}),
    ...(baseRenderedHeight !== node.height ? { baseRenderedHeight } : {}),
    cardChromeExtraHeight,
    ...(lineage ? { lineage } : {}),
    ...(inlineExtension?.toolbar ? { inlineToolbar: inlineExtension.toolbar } : {}),
    ...(inlineExtension?.panel ? { inlinePanel: inlineExtension.panel } : {}),
    ...(inlineExtension ? { inlinePanelExtraHeight: inlineExtension.extraHeight } : {}),
    ...(inlineToolbarHeight > 0 ? { inlineToolbarHeight } : {}),
  }
  const renderedWidth = Math.max(
    presentationSize.width,
    inlineExtension?.minWidth ?? presentationSize.width,
  )
  const renderedHeight =
    baseRenderedHeight + inlineToolbarHeight + (inlineExtension?.extraHeight ?? 0)
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
    // 节点展开内联面板时强制置顶，避免其它节点卡片遮挡展开界面。
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
    interactionWidth: 36,
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

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * pageSize
  return delta
}

function clampCanvasZoom(zoom: number): number {
  return Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom))
}

function isCanvasZoomWheelEvent(event: WheelEvent): boolean {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.getModifierState('Control') ||
    event.getModifierState('Meta') ||
    event.getModifierState('OS')
  )
}

function canvasNodeWheelBoundary(event: WheelEvent): HTMLElement | null {
  if (isCanvasZoomWheelEvent(event)) return null
  return findSelectedCanvasNodeScrollRegion(event.target)
}

function CanvasStageInner({
  snapshot,
  activeTool,
  selectedNodeIds,
  onSelectionChange,
  onNodesPersist,
  onUpdateNodeData,
  onConnectNodes,
  onDeleteEdges,
  onDuplicateNode,
  onDeleteNode,
  onDownloadMediaNode,
  onToggleLockNode,
  onBringNodeToFront,
  onMergeGroupToImage,
  onMergeSelectionToImage,
  onCreateGroupFromSelection,
  onAddSelectionToGroup,
  onRemoveNodeFromGroup,
  onDissolveGroup,
  onDuplicateSelectedNodes,
  onToggleLockSelectedNodes,
  onBringSelectedNodesToFront,
  onAddNodesToAgent,
  /** 单节点右键：把该节点加入画布 Agent 对话引用列表（节点富菜单入口） */
  onAddNodeToAgent,
  onRunOperationNode,
  onConfigureSelectedTasks,
  onSubmitSelectedTasks,
  onOpenAiComposer,
  onEditNode,
  onSaveNodeToLibrary,
  onAnnotateImage,
  onSplitGridImage,
  onSplitStoryboard,
  onExtractCharacterSubview,
  onPreviewPanorama,
  onEditVideo,
  onExpandOperationOutputs,
  onCreateOperationChild,
  onPipelineAction,
  onSetProductionState,
  onAddTextAtPosition,
  onAddImageAtPosition,
  onDropFiles,
  onAddDirectorStage3DAtPosition,
  onAddVideoWorkbenchAtPosition,
  onInsertAssetFromPane,
  onDeleteSelectedNodes,
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
  onNodesPersist: (nodes: SparkCanvasNode[]) => MaybePromise<void>
  onUpdateNodeData?: (nodeId: string, data: Partial<CanvasNodeData>) => void
  onConnectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => MaybePromise<void>
  onDeleteEdges: (edgeIds: string[]) => void
  onDuplicateNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onDownloadMediaNode: (nodeId: string) => void
  onToggleLockNode: (nodeId: string) => void
  onBringNodeToFront: (nodeId: string) => void
  onMergeGroupToImage: (groupId: string) => void
  onMergeSelectionToImage: () => void
  onCreateGroupFromSelection: () => void
  onAddSelectionToGroup: (groupId: string) => void
  onRemoveNodeFromGroup: (nodeId: string) => void
  onDissolveGroup: (groupId: string) => void
  onDuplicateSelectedNodes?: () => void
  onToggleLockSelectedNodes?: () => void
  onBringSelectedNodesToFront?: () => void
  /** 右键选中节点 → 加入画布 Agent 对话的引用列表 */
  onAddNodesToAgent?: () => void
  /** 单节点右键 → 加入画布 Agent 对话（节点富菜单入口） */
  onAddNodeToAgent?: (nodeId: string) => void
  /** 单节点右键 → 使用已保存配置提交任务 */
  onRunOperationNode?: (nodeId: string) => void
  /** 多选任务节点右键 → 打开批量配置面板 */
  onConfigureSelectedTasks?: (nodeIds: string[]) => void
  /** 多选任务节点右键 → 校验并批量提交 */
  onSubmitSelectedTasks?: (nodeIds: string[]) => void
  onOpenAiComposer: (nodeId: string) => void
  onEditNode: (nodeId: string) => void
  onSaveNodeToLibrary: (nodeId: string) => void
  onAnnotateImage: (nodeId: string) => void
  onSplitGridImage: (nodeId: string) => void
  onSplitStoryboard: (nodeId: string) => void
  onExtractCharacterSubview?: (nodeId: string) => void
  /** 360 全景产物节点右键 → 全景预览 */
  onPreviewPanorama: (nodeId: string) => void
  /** 视频节点右键 → 视频编辑（打开视频工作台） */
  onEditVideo: (nodeId: string) => void
  /** 多产物操作节点右键 → 展开最近一次运行的全部产物 */
  onExpandOperationOutputs: (nodeId: string) => void
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
  onAddTextAtPosition: CanvasStageCreateAction
  onAddImageAtPosition: CanvasStageCreateAction
  /** 拖入外部文件落到画布上（图片/视频/音频/文本），位置已转为 flow 坐标 */
  onDropFiles?: (position: CanvasStagePoint, files: File[]) => void
  /** 空白右键：新建真·3D 导演台节点 */
  onAddDirectorStage3DAtPosition?: CanvasStageCreateAction
  /** 空白右键或拖线菜单：新建视频工作台节点 */
  onAddVideoWorkbenchAtPosition?: CanvasStageCreateAction
  /** 空白右键：从资产插入（打开资产面板） */
  onInsertAssetFromPane?: (
    position: CanvasStagePoint,
    pendingConnection?: PendingCanvasConnection | null,
  ) => void
  /** 空白右键：删除当前选中的节点 */
  onDeleteSelectedNodes?: () => void
  /** 空白右键：创建 AI 操作节点（无上游，由用户后续连线） */
  onCreateOperationAtPosition?: (
    operation: CanvasOperationType,
    position: CanvasStagePoint,
    options?: { openPanel?: boolean },
  ) => MaybePromise<CanvasStageCreateResult>
  /** 空白右键：创建流水线编排节点（提取角色/场景、转剧本、生成分镜脚本等） */
  onCreatePipelineAtPosition?: (
    actionId: string,
    position: CanvasStagePoint,
    options?: { openPanel?: boolean; sourceNodeId?: string },
  ) => MaybePromise<CanvasStageCreateResult>
  /** 用户明确点击某个节点，用于恢复被手动关闭的节点面板 */
  onNodeSelectIntent?: (nodeId: string) => void
  onViewportChange?: (viewport: CanvasStageViewport) => void
  onViewportControlsChange?: (controls: CanvasStageViewportControls | null) => void
  onInlinePanelResize?: (nodeId: string, extraHeight: number) => void
  nodeInlineExtension?: CanvasNodeInlineExtension | null
}) {
  const nodesInitialized = useNodesInitialized()
  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({
      duplicateNode: onDuplicateNode,
      deleteNode: onDeleteNode,
      downloadMedia: onDownloadMediaNode,
      toggleLockNode: onToggleLockNode,
      bringNodeToFront: onBringNodeToFront,
      mergeGroupToImage: onMergeGroupToImage,
      mergeSelectionToImage: onMergeSelectionToImage,
      createGroupFromSelection: onCreateGroupFromSelection,
      addSelectionToGroup: onAddSelectionToGroup,
      removeNodeFromGroup: onRemoveNodeFromGroup,
      dissolveGroup: onDissolveGroup,
      ...(onAddNodeToAgent ? { addNodeToAgent: onAddNodeToAgent } : {}),
      ...(onRunOperationNode ? { runOperationNode: onRunOperationNode } : {}),
      openAiComposer: onOpenAiComposer,
      editNode: onEditNode,
      saveToLibrary: onSaveNodeToLibrary,
      annotateImage: onAnnotateImage,
      splitGridImage: onSplitGridImage,
      splitStoryboard: onSplitStoryboard,
      ...(onExtractCharacterSubview ? { extractCharacterSubview: onExtractCharacterSubview } : {}),
      previewPanorama: onPreviewPanorama,
      ...(onEditVideo ? { editVideo: onEditVideo } : {}),
      expandOperationOutputs: onExpandOperationOutputs,
      createOperationChild: onCreateOperationChild,
      pipelineAction: onPipelineAction,
      setProductionState: onSetProductionState,
      ...(onUpdateNodeData ? { updateNodeData: onUpdateNodeData } : {}),
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
      onMergeSelectionToImage,
      onOpenAiComposer,
      onAnnotateImage,
      onExtractCharacterSubview,
      onSplitGridImage,
      onSplitStoryboard,
      onPreviewPanorama,
      onEditVideo,
      onExpandOperationOutputs,
      onRemoveNodeFromGroup,
      onAddNodeToAgent,
      onRunOperationNode,
      onCreateOperationChild,
      onPipelineAction,
      onSetProductionState,
      onSaveNodeToLibrary,
      onToggleLockNode,
      onUpdateNodeData,
    ],
  )
  const operationProjection = useMemo(
    () => buildCanvasOperationProjection(snapshot.nodes, snapshot.edges),
    [snapshot.edges, snapshot.nodes],
  )
  const selectedNodeIdSet = useMemo(
    () =>
      new Set(
        selectedNodeIds.map(
          (nodeId) => operationProjection.producerByOutputNodeId.get(nodeId) ?? nodeId,
        ),
      ),
    [operationProjection.producerByOutputNodeId, selectedNodeIds],
  )
  const snapshotNodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node] as const)),
    [snapshot.nodes],
  )
  const selectedContext = useMemo(
    () =>
      summarizeCanvasSelectionContext(
        Array.from(selectedNodeIdSet)
          .map((nodeId) => snapshotNodeById.get(nodeId))
          .filter((node): node is SparkCanvasNode => Boolean(node)),
      ),
    [selectedNodeIdSet, snapshotNodeById],
  )
  const lineageSummaries = useMemo(
    () => buildLineageSummaries(operationProjection.visibleEdges),
    [operationProjection.visibleEdges],
  )
  const assetById = useMemo(
    () => new Map(snapshot.assets.map((asset) => [asset.id, asset] as const)),
    [snapshot.assets],
  )
  const assetSubviewCountById = useMemo(
    () =>
      new Map(
        snapshot.assets.map(
          (asset) => [asset.id, readCharacterSubviews(asset.metadata).length] as const,
        ),
      ),
    [snapshot.assets],
  )
  const generatedOutputNodeIds = useMemo(
    () =>
      new Set(
        snapshot.edges.filter((edge) => edge.type === 'generated').map((edge) => edge.targetNodeId),
      ),
    [snapshot.edges],
  )
  const operationRunsByNodeId = useMemo(
    () =>
      new Map(
        snapshot.nodes.map(
          (node) => [node.id, buildCanvasOperationRunViews(node, snapshot)] as const,
        ),
      ),
    [snapshot],
  )
  const assetKindsByNodeId = useMemo(() => {
    const result = new Map<string, CanvasPipelineAssetKind[]>()
    const readPipelineKind = (assetId: string | undefined): CanvasPipelineAssetKind | undefined => {
      const asset = assetId ? assetById.get(assetId) : undefined
      const kind = asset ? readAssetKind(asset) : null
      return kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'effect'
        ? kind
        : undefined
    }

    for (const node of snapshot.nodes) {
      const kinds = new Set<CanvasPipelineAssetKind>()
      const directKind = readPipelineKind(node.assetId ?? undefined)
      if (directKind) kinds.add(directKind)
      if (isOperationNode(node)) {
        const latestRun = operationRunsByNodeId.get(node.id)?.find((run) => run.outputs.length > 0)
        for (const output of latestRun?.outputs ?? []) {
          const kind = readPipelineKind(
            output.assetId ?? snapshotNodeById.get(output.nodeId ?? '')?.assetId ?? undefined,
          )
          if (kind) kinds.add(kind)
        }
      }
      if (kinds.size > 0) result.set(node.id, [...kinds])
    }
    return result
  }, [assetById, operationRunsByNodeId, snapshot.nodes, snapshotNodeById])
  const nodes = useMemo(
    () =>
      operationProjection.visibleNodes.map((node) =>
        toFlowNode(
          node,
          nodeActions,
          lineageSummaries.get(node.id),
          false,
          nodeInlineExtension?.nodeId === node.id ? nodeInlineExtension : null,
          node.assetId ? (assetSubviewCountById.get(node.assetId) ?? 0) : 0,
          operationRunsByNodeId.get(node.id) ?? [],
          assetKindsByNodeId.get(node.id) ?? [],
          generatedOutputNodeIds.has(node.id),
          node.assetId ? assetById.get(node.assetId) : undefined,
        ),
      ),
    [
      assetSubviewCountById,
      assetById,
      assetKindsByNodeId,
      generatedOutputNodeIds,
      lineageSummaries,
      nodeActions,
      nodeInlineExtension,
      operationRunsByNodeId,
      operationProjection.visibleNodes,
    ],
  )
  const boardId = snapshot.board.id
  const boardViewport = useMemo<Viewport>(
    () => ({
      x: snapshot.board.viewport.x,
      y: snapshot.board.viewport.y,
      zoom: snapshot.board.viewport.zoom,
    }),
    [snapshot.board.viewport.x, snapshot.board.viewport.y, snapshot.board.viewport.zoom],
  )
  const [flowNodes, setFlowNodes] = useState(() =>
    nodes.map((node) => (selectedNodeIdSet.has(node.id) ? { ...node, selected: true } : node)),
  )
  const [dropActive, setDropActive] = useState(false)
  const dragDepthRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const paneContextMenuRef = useRef<HTMLDivElement>(null)
  const edgeContextMenuRef = useRef<HTMLDivElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node<CanvasFlowNodeData>, Edge> | null>(null)
  const flowNodesRef = useRef(flowNodes)
  const latestViewportRef = useRef<Viewport>(boardViewport)
  const appliedBoardViewportRef = useRef(boardId)
  const syncFrameRef = useRef<number | null>(null)
  const nodeRenderFrameRef = useRef<number | null>(null)
  const viewportNotifyFrameRef = useRef<number | null>(null)
  const pendingViewportNotificationRef = useRef<Viewport | null>(null)
  const wheelPanFrameRef = useRef<number | null>(null)
  const wheelPanDeltaRef = useRef({ x: 0, y: 0 })
  const wheelZoomFrameRef = useRef<number | null>(null)
  const pendingWheelZoomRef = useRef<{ delta: number; clientX: number; clientY: number } | null>(
    null,
  )
  const guideFrameRef = useRef<number | null>(null)
  const pendingGuideDragRef = useRef<Node<CanvasFlowNodeData>[] | null>(null)
  const pointerAuraFrameRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const viewportInteractingRef = useRef(false)
  const pendingConnectionRef = useRef<PendingCanvasConnection | null>(null)
  const suppressNextPaneClickRef = useRef(false)
  const nodeDragStateRef = useRef<{ nodeId: string | null; dragging: boolean; endedAt: number }>({
    nodeId: null,
    dragging: false,
    endedAt: 0,
  })
  const nodeResizingRef = useRef(false)
  const pendingNodesSyncRef = useRef<Node<CanvasFlowNodeData>[] | null>(null)
  const prevSelectedIdSetRef = useRef(selectedNodeIdSet)
  const [alignmentGuides, setAlignmentGuides] = useState<CanvasAlignmentGuide[]>([])
  const [paneContextMenu, setPaneContextMenu] = useState<PaneContextMenuState | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [minimapOpen, setMinimapOpen] = useState(true)
  const [edgeContextMenu, setEdgeContextMenu] = useState<{
    edgeId: string
    left: number
    top: number
    maxHeight: number
    anchorPoint: CanvasStagePoint
  } | null>(null)
  /**
   * 牵线到空白处时，菜单应以连线起点节点为上下文展示后续流水线操作。
   * 没有牵线上下文时保留空白画布原有的通用文本/抽取操作。
   */
  const panePipelineOperations = useMemo(() => {
    const sourceNode = paneContextMenu?.pendingConnection
      ? snapshotNodeById.get(paneContextMenu.pendingConnection.sourceNodeId)
      : undefined
    if (!sourceNode) {
      return CANVAS_PIPELINE_OPS.filter(
        (op) => op.appliesToText && (op.kind === 'text' || op.kind === 'extract'),
      )
    }
    const contentNode = isOperationNode(sourceNode)
      ? resolveCanvasOperationResourceNode(sourceNode, snapshot) ?? sourceNode
      : sourceNode
    return getNodePipelineActions(contentNode, {
      assetKinds: assetKindsByNodeId.get(sourceNode.id) ?? [],
    })
  }, [assetKindsByNodeId, paneContextMenu, snapshot, snapshotNodeById])
  const panePipelineOperationGroups = useMemo(
    () =>
      CANVAS_PIPELINE_MENU_GROUPS.map((group) => ({
        ...group,
        actions: panePipelineOperations.filter((action) => action.kind === group.id),
      })).filter((group) => group.actions.length > 0),
    [panePipelineOperations],
  )
  const edges = useMemo(
    () =>
      operationProjection.visibleEdges
        .filter((edge) => edge.type !== 'group_contains')
        .map(toFlowEdge),
    [operationProjection.visibleEdges],
  )

  const notifyViewportChange = useCallback(
    (viewport = latestViewportRef.current) => {
      latestViewportRef.current = viewport
      pendingViewportNotificationRef.current = viewport
      if (viewportNotifyFrameRef.current != null) return
      viewportNotifyFrameRef.current = window.requestAnimationFrame(() => {
        viewportNotifyFrameRef.current = null
        const nextViewport = pendingViewportNotificationRef.current ?? latestViewportRef.current
        pendingViewportNotificationRef.current = null
        const rect = stageRef.current?.getBoundingClientRect()
        onViewportChange?.({
          ...nextViewport,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        })
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
      getViewport: () => {
        const instance = flowInstanceRef.current
        if (!instance) return null
        const viewport = instance.getViewport()
        latestViewportRef.current = viewport
        return viewport
      },
      fitView: () => {
        void flowInstanceRef.current?.fitView({
          padding: 0.2,
          minZoom: CANVAS_FIT_MIN_ZOOM,
          maxZoom: CANVAS_FIT_MAX_ZOOM,
          duration: 260,
        })
      },
      zoomBy: (delta: number) => {
        const instance = flowInstanceRef.current
        if (!instance) return
        const current = latestViewportRef.current
        const nextZoom = clampCanvasZoom(current.zoom + delta)
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
      setViewport: (viewport, options) => {
        const instance = flowInstanceRef.current
        if (!instance) return
        void instance.setViewport(viewport, options)
        notifyViewportChange(viewport)
      },
      arrangeNodes: async ({ mode, spacing, nodeIds }) => {
        if (!nodesInitialized) return false

        const currentFlowNodes = flowNodesRef.current
        const liveSelectedIds = new Set(
          currentFlowNodes.filter((node) => node.selected).map((node) => node.id),
        )
        const requestedIds = new Set(nodeIds ?? [])
        const partialLayout = requestedIds.size > 1
        const targetIds = partialLayout && liveSelectedIds.size > 1 ? liveSelectedIds : requestedIds
        const movableNodes = currentFlowNodes.filter((node) => {
          if (node.data.canvasNode.locked) return false
          if (partialLayout) return targetIds.has(node.id)
          return true
        })
        if (movableNodes.length === 0) return false

        const movableIds = new Set(movableNodes.map((node) => node.id))
        const arrangedNodeIds = partialLayout
          ? Array.from(targetIds).filter((nodeId) => movableIds.has(nodeId))
          : []
        const positionsById = new Map<string, { x: number; y: number }>()
        const parentKeys = new Set(movableNodes.map((node) => node.parentId ?? ''))

        for (const parentKey of parentKeys) {
          const nodesInScope = movableNodes.filter((node) => (node.parentId ?? '') === parentKey)
          const nodeIdsInScope = new Set(nodesInScope.map((node) => node.id))
          const obstacles = currentFlowNodes.filter(
            (node) => (node.parentId ?? '') === parentKey && !movableIds.has(node.id),
          )
          const linksInScope: CanvasAutoLayoutLink[] = operationProjection.visibleEdges
            .filter(
              (edge) =>
                edge.type !== 'group_contains' &&
                nodeIdsInScope.has(edge.sourceNodeId) &&
                nodeIdsInScope.has(edge.targetNodeId),
            )
            .map((edge) => ({
              sourceId: edge.sourceNodeId,
              targetId: edge.targetNodeId,
            }))
          const positions = arrangeCanvasNodes(nodesInScope.map(flowNodeToAutoLayoutNode), {
            mode,
            spacing,
            links: linksInScope,
            obstacles: obstacles.map(flowNodeToAutoLayoutNode),
          })
          positions.forEach((position) => positionsById.set(position.id, position))
        }

        const nextFlowNodes = currentFlowNodes.map((node) => {
          const position = positionsById.get(node.id)
          return position ? { ...node, position: { x: position.x, y: position.y } } : node
        })
        const nextPersistedNodes = snapshot.nodes.map((node) => {
          const position = positionsById.get(node.id)
          return position ? { ...node, x: position.x, y: position.y } : node
        })

        flowNodesRef.current = nextFlowNodes
        setFlowNodes(nextFlowNodes)
        await onNodesPersist(nextPersistedNodes)
        window.requestAnimationFrame(() => {
          if (partialLayout) {
            if (arrangedNodeIds.length === 0) return
            window.requestAnimationFrame(() => {
              void flowInstanceRef.current?.fitView({
                nodes: arrangedNodeIds.map((id) => ({ id })),
                padding: 0.24,
                minZoom: CANVAS_FIT_MIN_ZOOM,
                maxZoom: CANVAS_FIT_MAX_ZOOM,
                duration: 280,
              })
            })
            return
          }

          void flowInstanceRef.current?.fitView({
            padding: 0.2,
            minZoom: CANVAS_FIT_MIN_ZOOM,
            maxZoom: CANVAS_FIT_MAX_ZOOM,
            duration: 260,
          })
        })
        return true
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
        const minZoom = options?.minZoom ?? CANVAS_FIT_MIN_ZOOM
        const maxZoom = options?.maxZoom ?? CANVAS_FIT_MAX_ZOOM
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
  }, [
    nodesInitialized,
    notifyViewportChange,
    onNodesPersist,
    onViewportControlsChange,
    operationProjection.visibleEdges,
    snapshot.nodes,
  ])

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
        // Snapshot/content refreshes must never overwrite React Flow's live
        // selection. External/programmatic selection is handled separately.
        const liveSelected = new Set(
          flowNodesRef.current.filter((node) => node.selected).map((node) => node.id),
        )
        const selectionSafeNodes = nextNodes.map((node) => {
          const selected = liveSelected.has(node.id)
          return node.selected === selected ? node : { ...node, selected }
        })
        const merged = mergeFlowNodes(flowNodesRef.current, selectionSafeNodes)
        flowNodesRef.current = merged
        setFlowNodes(merged)
      })
    },
    [cancelScheduledSync],
  )

  // React Flow can emit several node changes in one pointer task. Batch the
  // controlled `nodes` prop update to one paint while keeping the ref current
  // immediately, so persistence and alignment calculations still see the
  // latest position.
  const scheduleFlowNodesRender = useCallback(() => {
    if (nodeRenderFrameRef.current != null) return
    nodeRenderFrameRef.current = window.requestAnimationFrame(() => {
      nodeRenderFrameRef.current = null
      setFlowNodes(flowNodesRef.current)
    })
  }, [])

  useEffect(() => {
    if (viewportInteractingRef.current || nodeResizingRef.current) {
      pendingNodesSyncRef.current = nodes
      return
    }
    syncFlowNodes(nodes)
  }, [nodes, syncFlowNodes])

  useEffect(() => {
    const previousSelected = prevSelectedIdSetRef.current
    if (selectedIdSetsEqual(previousSelected, selectedNodeIdSet)) return
    prevSelectedIdSetRef.current = selectedNodeIdSet

    const changedSelectionIds = new Set<string>()
    previousSelected.forEach((nodeId) => {
      if (!selectedNodeIdSet.has(nodeId)) changedSelectionIds.add(nodeId)
    })
    selectedNodeIdSet.forEach((nodeId) => {
      if (!previousSelected.has(nodeId)) changedSelectionIds.add(nodeId)
    })
    if (changedSelectionIds.size === 0) return

    let changed = false
    const nextNodes = flowNodesRef.current.map((node) => {
      if (!changedSelectionIds.has(node.id)) return node
      const selected = selectedNodeIdSet.has(node.id)
      if (node.selected === selected) return node
      changed = true
      return { ...node, selected }
    })
    if (!changed) return
    flowNodesRef.current = nextNodes
    setFlowNodes(nextNodes)
  }, [selectedNodeIdSet])

  useEffect(
    () => () => {
      cancelScheduledSync()
      if (nodeRenderFrameRef.current != null) {
        window.cancelAnimationFrame(nodeRenderFrameRef.current)
        nodeRenderFrameRef.current = null
      }
      if (viewportNotifyFrameRef.current != null) {
        window.cancelAnimationFrame(viewportNotifyFrameRef.current)
      }
      if (wheelPanFrameRef.current != null) window.cancelAnimationFrame(wheelPanFrameRef.current)
      if (wheelZoomFrameRef.current != null) window.cancelAnimationFrame(wheelZoomFrameRef.current)
      if (guideFrameRef.current != null) window.cancelAnimationFrame(guideFrameRef.current)
      if (pointerAuraFrameRef.current != null) {
        window.cancelAnimationFrame(pointerAuraFrameRef.current)
      }
    },
    [cancelScheduledSync],
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

  const handleMinimapClick = useCallback(
    (_event: ReactMouseEvent, position: XYPosition) => {
      const instance = flowInstanceRef.current
      if (!instance) return
      setPaneContextMenu(null)
      setEdgeContextMenu(null)
      void instance.setCenter(position.x, position.y, {
        zoom: latestViewportRef.current.zoom,
        duration: 160,
      })
    },
    [],
  )

  const handleInit = useCallback(
    (instance: ReactFlowInstance<Node<CanvasFlowNodeData>, Edge>) => {
      flowInstanceRef.current = instance
      const viewport = boardViewport
      latestViewportRef.current = viewport
      void instance.setViewport(viewport, { duration: 0 })
      notifyViewportChange(viewport)
    },
    [boardViewport, notifyViewportChange],
  )

  useEffect(() => {
    if (appliedBoardViewportRef.current === boardId) return
    appliedBoardViewportRef.current = boardId
    const viewport = boardViewport
    latestViewportRef.current = viewport
    const instance = flowInstanceRef.current
    if (!instance) return
    void instance.setViewport(viewport, { duration: 0 })
    notifyViewportChange(viewport)
  }, [boardId, boardViewport, notifyViewportChange])

  const openPaneContextMenuAt = useCallback(
    (
      point: { clientX: number; clientY: number },
      pendingConnection: PendingCanvasConnection | null = null,
    ) => {
      const rect = stageRef.current?.getBoundingClientRect()
      const instance = flowInstanceRef.current
      if (!rect || !instance) return false

      const rawLeft = point.clientX - rect.left
      const rawTop = point.clientY - rect.top
      const menuPosition = calculateCanvasContextMenuPosition({
        point: { x: rawLeft, y: rawTop },
        container: { width: rect.width, height: rect.height },
        menu: { width: 280, height: 520 },
        submenu: { width: 300 },
        inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
      })

      // 画布菜单与连线菜单共享同一交互层，任何时刻只保留一个右键菜单。
      setEdgeContextMenu(null)
      setPaneContextMenu({
        left: menuPosition.left,
        top: menuPosition.top,
        maxHeight: menuPosition.maxHeight,
        openSubmenusLeft: menuPosition.openSubmenusLeft,
        openSubmenusUp: menuPosition.openSubmenusUp,
        anchorPoint: { x: rawLeft, y: rawTop },
        flowPosition: instance.screenToFlowPosition({
          x: point.clientX,
          y: point.clientY,
        }),
        pendingConnection,
      })
      return true
    },
    [],
  )

  useLayoutEffect(() => {
    const menu = paneContextMenuRef.current
    const stage = stageRef.current
    const anchorPoint = paneContextMenu?.anchorPoint
    if (!menu || !stage || !anchorPoint) return undefined

    const updatePosition = () => {
      const rect = stage.getBoundingClientRect()
      const menuPosition = calculateCanvasContextMenuPosition({
        point: anchorPoint,
        container: { width: rect.width, height: rect.height },
        menu: { width: menu.offsetWidth, height: menu.scrollHeight },
        submenu: { width: 300 },
        inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
      })
      setPaneContextMenu((current) => {
        if (!current) return current
        if (
          current.left === menuPosition.left &&
          current.top === menuPosition.top &&
          current.maxHeight === menuPosition.maxHeight &&
          current.openSubmenusLeft === menuPosition.openSubmenusLeft &&
          current.openSubmenusUp === menuPosition.openSubmenusUp
        ) {
          return current
        }
        return {
          ...current,
          left: menuPosition.left,
          top: menuPosition.top,
          maxHeight: menuPosition.maxHeight,
          openSubmenusLeft: menuPosition.openSubmenusLeft,
          openSubmenusUp: menuPosition.openSubmenusUp,
        }
      })
    }

    updatePosition()
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    resizeObserver?.observe(stage)
    resizeObserver?.observe(menu)
    window.addEventListener('resize', updatePosition)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePosition)
    }
  }, [paneContextMenu?.anchorPoint])

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) => {
      event.preventDefault()
      event.stopPropagation()
      openPaneContextMenuAt(event)
    },
    [openPaneContextMenuAt],
  )

  const handleStageContextMenuCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target
      const nodeElement =
        target instanceof Element ? target.closest<HTMLElement>('[data-canvas-node-id]') : null
      const ignoreSelectionMenu =
        target instanceof Element &&
        Boolean(
          target.closest(
            '.react-flow__edge, .react-flow__controls, .react-flow__minimap, .canvas-minimap, .canvas-minimap-toggle, .canvas-edge-context-menu, .canvas-pane-context-menu',
          ),
        )
      if (ignoreSelectionMenu) return
      const targetNodeId = nodeElement?.dataset.canvasNodeId ?? null
      if (
        !shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds,
          targetNodeId,
          isEditableTarget: isEditableEventTarget(event.target),
        })
      ) {
        // 节点自己的 Dropdown 在后续冒泡阶段打开；先关闭画布/连线菜单，
        // 避免“先开画布菜单，再右键节点”时两个菜单叠在一起。
        if (nodeElement) {
          setPaneContextMenu(null)
          setEdgeContextMenu(null)
        }
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation?.()
      openPaneContextMenuAt(event)
    },
    [openPaneContextMenuAt, selectedNodeIds],
  )

  const closePaneContextMenu = useCallback(() => {
    setPaneContextMenu(null)
  }, [])

  const handlePaneClick = useCallback(() => {
    if (suppressNextPaneClickRef.current) {
      suppressNextPaneClickRef.current = false
      return
    }
    closePaneContextMenu()
    setEdgeContextMenu(null)
  }, [closePaneContextMenu])

  const handleStageWheel = useCallback(
    (event: WheelEvent) => {
      const instance = flowInstanceRef.current
      const stage = stageRef.current
      if (!instance || !stage) return
      if (canvasNodeWheelBoundary(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      closePaneContextMenu()
      setEdgeContextMenu(null)

      const rect = stage.getBoundingClientRect()
      const verticalDelta = normalizeWheelDelta(event.deltaY, event.deltaMode, rect.height)
      const horizontalDelta = normalizeWheelDelta(event.deltaX, event.deltaMode, rect.width)

      if (isCanvasZoomWheelEvent(event)) {
        const zoomDelta =
          Math.abs(verticalDelta) >= Math.abs(horizontalDelta) ? verticalDelta : horizontalDelta
        const pendingZoom = pendingWheelZoomRef.current
        pendingWheelZoomRef.current = {
          delta: (pendingZoom?.delta ?? 0) + zoomDelta,
          clientX: event.clientX,
          clientY: event.clientY,
        }
        if (wheelZoomFrameRef.current != null) return
        wheelZoomFrameRef.current = window.requestAnimationFrame(() => {
          wheelZoomFrameRef.current = null
          const zoomInput = pendingWheelZoomRef.current
          pendingWheelZoomRef.current = null
          if (!zoomInput?.delta) return
          const stage = stageRef.current
          if (!stage) return
          const rect = stage.getBoundingClientRect()
          const current = latestViewportRef.current
          const nextZoom = clampCanvasZoom(
            current.zoom * Math.exp(-zoomInput.delta * CANVAS_WHEEL_ZOOM_SENSITIVITY),
          )
          if (nextZoom === current.zoom) return
          const localX = zoomInput.clientX - rect.left
          const localY = zoomInput.clientY - rect.top
          const flowX = (localX - current.x) / current.zoom
          const flowY = (localY - current.y) / current.zoom
          const nextViewport = {
            x: localX - flowX * nextZoom,
            y: localY - flowY * nextZoom,
            zoom: nextZoom,
          }
          latestViewportRef.current = nextViewport
          void instance.setViewport(nextViewport, { duration: 0 })
          notifyViewportChange(nextViewport)
        })
        return
      }

      const shiftHorizontalDelta =
        Math.abs(horizontalDelta) > Math.abs(verticalDelta) ? horizontalDelta : verticalDelta
      wheelPanDeltaRef.current.x +=
        (event.shiftKey ? shiftHorizontalDelta : horizontalDelta) * CANVAS_WHEEL_PAN_SPEED
      wheelPanDeltaRef.current.y += event.shiftKey ? 0 : verticalDelta * CANVAS_WHEEL_PAN_SPEED

      if (wheelPanFrameRef.current != null) return
      wheelPanFrameRef.current = window.requestAnimationFrame(() => {
        wheelPanFrameRef.current = null
        const delta = wheelPanDeltaRef.current
        wheelPanDeltaRef.current = { x: 0, y: 0 }
        if (!delta.x && !delta.y) return
        const current = latestViewportRef.current
        const nextViewport = {
          ...current,
          x: current.x - delta.x,
          y: current.y - delta.y,
        }
        latestViewportRef.current = nextViewport
        void instance.setViewport(nextViewport, { duration: 0 })
        notifyViewportChange(nextViewport)
      })
    },
    [closePaneContextMenu, notifyViewportChange],
  )

  // React's delegated wheel listener may be passive in Electron/Chromium.
  // Register this capture listener explicitly as non-passive so custom canvas
  // pan/zoom can safely call preventDefault without a console warning.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    stage.addEventListener('wheel', handleStageWheel, { capture: true, passive: false })
    return () => stage.removeEventListener('wheel', handleStageWheel, true)
  }, [handleStageWheel])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const hasOpenContextMenu = Boolean(paneContextMenu || edgeContextMenu)
      if (hasOpenContextMenu) {
        closePaneContextMenu()
        setEdgeContextMenu(null)
        return
      }
      if (
        !shouldClearCanvasSelectionOnEscape({
          key: event.key,
          selectedNodeCount: selectedNodeIds.length,
          hasOpenContextMenu,
          editableTarget: isEditableEventTarget(event.target),
        })
      )
        return
      event.preventDefault()
      onSelectionChange([])
      setSelectedEdgeIds((previous) => (previous.length === 0 ? previous : []))
    }
    window.addEventListener('keydown', handleKeyDown)
    if (paneContextMenu) window.addEventListener('blur', closePaneContextMenu)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (paneContextMenu) window.removeEventListener('blur', closePaneContextMenu)
    }
  }, [
    closePaneContextMenu,
    edgeContextMenu,
    onSelectionChange,
    paneContextMenu,
    selectedNodeIds.length,
  ])

  const handleResetZoom = useCallback(() => {
    const instance = flowInstanceRef.current
    if (!instance) return
    const nextViewport = { ...latestViewportRef.current, zoom: 1 }
    closePaneContextMenu()
    void instance.setViewport(nextViewport, { duration: 180 })
    notifyViewportChange(nextViewport)
  }, [closePaneContextMenu, notifyViewportChange])

  const connectPendingConnectionToNode = useCallback(
    async (
      node: CanvasStageCreateResult,
      pendingConnection = paneContextMenu?.pendingConnection,
    ) => {
      const input = buildPendingConnectionInput(pendingConnection ?? null, node ?? null)
      if (!input) return
      await onConnectNodes(input)
    },
    [onConnectNodes, paneContextMenu?.pendingConnection],
  )

  const runPaneCreateAction = useCallback(
    async (action: CanvasStageCreateAction) => {
      if (!paneContextMenu) return
      const position = paneContextMenu.flowPosition
      const pendingConnection = paneContextMenu.pendingConnection
      closePaneContextMenu()
      const created = await action(position, pendingConnection)
      await connectPendingConnectionToNode(created, pendingConnection)
    },
    [closePaneContextMenu, connectPendingConnectionToNode, paneContextMenu],
  )

  const handleAddTextFromPane = useCallback(() => {
    void runPaneCreateAction(onAddTextAtPosition)
  }, [onAddTextAtPosition, runPaneCreateAction])

  const handleAddImageFromPane = useCallback(() => {
    void runPaneCreateAction(onAddImageAtPosition)
  }, [onAddImageAtPosition, runPaneCreateAction])

  const handleAddDirectorStage3DFromPane = useCallback(() => {
    if (!onAddDirectorStage3DAtPosition) return
    void runPaneCreateAction(onAddDirectorStage3DAtPosition)
  }, [onAddDirectorStage3DAtPosition, runPaneCreateAction])

  const handleAddVideoWorkbenchFromPane = useCallback(() => {
    if (!onAddVideoWorkbenchAtPosition) return
    void runPaneCreateAction(onAddVideoWorkbenchAtPosition)
  }, [onAddVideoWorkbenchAtPosition, runPaneCreateAction])

  const handleInsertAssetFromPane = useCallback(() => {
    if (!paneContextMenu) return
    const position = paneContextMenu.flowPosition
    const pendingConnection = paneContextMenu.pendingConnection
    closePaneContextMenu()
    onInsertAssetFromPane?.(position, pendingConnection)
  }, [closePaneContextMenu, onInsertAssetFromPane, paneContextMenu])

  const handleCreateOperationFromPane = useCallback(
    async (operation: CanvasOperationType) => {
      if (!paneContextMenu) return
      const position = paneContextMenu.flowPosition
      const pendingConnection = paneContextMenu.pendingConnection
      closePaneContextMenu()
      const created = await onCreateOperationAtPosition?.(operation, position, {
        // 连线创建完成后还会异步写入边和选中态；此时自动开面板会被后续状态同步关掉。
        openPanel: pendingConnection == null,
      })
      await connectPendingConnectionToNode(created, pendingConnection)
    },
    [
      closePaneContextMenu,
      connectPendingConnectionToNode,
      onCreateOperationAtPosition,
      paneContextMenu,
    ],
  )

  const handleCreatePipelineFromPane = useCallback(
    async (actionId: string) => {
      if (!paneContextMenu) return
      const position = paneContextMenu.flowPosition
      const pendingConnection = paneContextMenu.pendingConnection
      closePaneContextMenu()
      const created = await onCreatePipelineAtPosition?.(actionId, position, {
        openPanel: pendingConnection == null,
        ...(pendingConnection ? { sourceNodeId: pendingConnection.sourceNodeId } : {}),
      })
      await connectPendingConnectionToNode(created, pendingConnection)
    },
    [
      closePaneContextMenu,
      connectPendingConnectionToNode,
      onCreatePipelineAtPosition,
      paneContextMenu,
    ],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CanvasFlowNodeData>>[]) => {
      const resizingStarted = changes.some(
        (change) => change.type === 'dimensions' && change.resizing === true,
      )
      const resizingEnded = changes.some(
        (change) => change.type === 'dimensions' && change.resizing === false,
      )
      if (resizingStarted) nodeResizingRef.current = true

      const nextFlowNodes = applyNodeChanges(changes, flowNodesRef.current)
      flowNodesRef.current = nextFlowNodes
      // Selection and dragging are one continuous gesture in React Flow.
      // Both must reach the controlled `nodes` prop in the same event turn;
      // deferring either one leaves a brief stale-selection window that makes
      // the first pointer move feel sticky.
      const hasInteractionChange = changes.some(
        (change) => change.type === 'select' || change.type === 'position',
      )
      if (hasInteractionChange) {
        if (nodeRenderFrameRef.current != null) {
          window.cancelAnimationFrame(nodeRenderFrameRef.current)
          nodeRenderFrameRef.current = null
        }
        setFlowNodes(nextFlowNodes)
      } else {
        scheduleFlowNodesRender()
      }

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

      if (resizingEnded) {
        nodeResizingRef.current = false
        pendingNodesSyncRef.current = null
      }
    },
    [
      nodeInlineExtension,
      onInlinePanelResize,
      onNodesPersist,
      scheduleFlowNodesRender,
      snapshot.nodes,
    ],
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'ArrowUp' &&
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowLeft' &&
        event.key !== 'ArrowRight'
      ) {
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (paneContextMenu || edgeContextMenu || isEditableEventTarget(event.target)) return

      const instance = flowInstanceRef.current
      if (!instance) return
      event.preventDefault()
      event.stopPropagation()

      const step = event.shiftKey ? CANVAS_KEYBOARD_PAN_FAST_STEP : CANVAS_KEYBOARD_PAN_STEP
      const current = latestViewportRef.current
      const nextViewport = {
        ...current,
        x: current.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        y: current.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
      }
      latestViewportRef.current = nextViewport
      void instance.setViewport(nextViewport, { duration: 80 })
      notifyViewportChange(nextViewport)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [edgeContextMenu, notifyViewportChange, paneContextMenu])

  const handleConnect = useCallback(
    (connection: Connection) => {
      pendingConnectionRef.current = null
      if (!connection.source || !connection.target) return
      void onConnectNodes({ sourceNodeId: connection.source, targetNodeId: connection.target })
    },
    [onConnectNodes],
  )

  const handleConnectStart = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleType: HandleType | null },
    ) => {
      pendingConnectionRef.current =
        params.nodeId && params.handleType === 'source' ? { sourceNodeId: params.nodeId } : null
    },
    [],
  )

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const pendingConnection = pendingConnectionRef.current
      pendingConnectionRef.current = null
      if (!pendingConnection || connectionState.isValid || connectionState.toNode) return
      const point = getClientPoint(event)
      if (!point) return
      event.preventDefault()
      suppressNextPaneClickRef.current = true
      openPaneContextMenuAt(point, pendingConnection)
    },
    [openPaneContextMenuAt],
  )

  const clearAlignmentGuides = useCallback(() => {
    if (guideFrameRef.current != null) {
      window.cancelAnimationFrame(guideFrameRef.current)
      guideFrameRef.current = null
    }
    pendingGuideDragRef.current = null
    setAlignmentGuides([])
  }, [])

  const handleNodeDrag = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      node: Node<CanvasFlowNodeData>,
      draggedNodes: Node<CanvasFlowNodeData>[],
    ) => {
      pendingGuideDragRef.current = draggedNodes.length > 0 ? draggedNodes : [node]
      if (guideFrameRef.current != null) return
      guideFrameRef.current = window.requestAnimationFrame(() => {
        guideFrameRef.current = null
        const movingNodes = pendingGuideDragRef.current ?? []
        pendingGuideDragRef.current = null
        if (movingNodes.length === 0) return
        const movingById = new Map(movingNodes.map((item) => [item.id, item]))
        const nextNodes = flowNodesRef.current.map((flowNode) => {
          const moving = movingById.get(flowNode.id)
          return moving ? { ...flowNode, position: moving.position } : flowNode
        })
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
    const anchorPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const menuPosition = calculateCanvasContextMenuPosition({
      point: anchorPoint,
      container: { width: rect.width, height: rect.height },
      menu: { width: 160, height: 56 },
      inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
    })
    setPaneContextMenu(null)
    setSelectedEdgeIds([edge.id])
    setEdgeContextMenu({
      edgeId: edge.id,
      left: menuPosition.left,
      top: menuPosition.top,
      maxHeight: menuPosition.maxHeight,
      anchorPoint,
    })
  }, [])

  useLayoutEffect(() => {
    const menu = edgeContextMenuRef.current
    const stage = stageRef.current
    const anchorPoint = edgeContextMenu?.anchorPoint
    if (!menu || !stage || !anchorPoint) return undefined

    const updatePosition = () => {
      const rect = stage.getBoundingClientRect()
      const menuPosition = calculateCanvasContextMenuPosition({
        point: anchorPoint,
        container: { width: rect.width, height: rect.height },
        menu: { width: menu.offsetWidth, height: menu.scrollHeight },
        inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
      })
      setEdgeContextMenu((current) => {
        if (!current) return current
        if (
          current.left === menuPosition.left &&
          current.top === menuPosition.top &&
          current.maxHeight === menuPosition.maxHeight
        ) {
          return current
        }
        return {
          ...current,
          left: menuPosition.left,
          top: menuPosition.top,
          maxHeight: menuPosition.maxHeight,
        }
      })
    }

    updatePosition()
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    resizeObserver?.observe(stage)
    resizeObserver?.observe(menu)
    window.addEventListener('resize', updatePosition)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updatePosition)
    }
  }, [edgeContextMenu?.anchorPoint])

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

  const handleNodeDoubleClick = useCallback(
    (event: ReactMouseEvent, node: Node<CanvasFlowNodeData>) => {
      event.stopPropagation()
      onEditNode(node.id)
    },
    [onEditNode],
  )

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node<CanvasFlowNodeData>) => {
      // 多选(≥2)且点中的节点在选区内时弹批量面板菜单；单选交给节点 Dropdown。
      if (selectedNodeIds.length < 2 || !selectedNodeIdSet.has(node.id)) {
        setPaneContextMenu(null)
        setEdgeContextMenu(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      openPaneContextMenuAt(event)
    },
    [openPaneContextMenuAt, selectedNodeIdSet, selectedNodeIds.length],
  )

  const handleStageDoubleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const nodeElement = target.closest<HTMLElement>('[data-canvas-node-id]')
      const nodeId = nodeElement?.dataset.canvasNodeId
      if (!nodeId) return
      event.preventDefault()
      event.stopPropagation()
      onEditNode(nodeId)
    },
    [onEditNode],
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

  const handleStagePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (nodeDragStateRef.current.dragging || viewportInteractingRef.current) return
    pendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    if (pointerAuraFrameRef.current != null) return
    pointerAuraFrameRef.current = window.requestAnimationFrame(() => {
      pointerAuraFrameRef.current = null
      const point = pendingPointerRef.current
      pendingPointerRef.current = null
      const stage = stageRef.current
      if (!stage || !point) return
      const rect = stage.getBoundingClientRect()
      const localX = point.clientX - rect.left
      const localY = point.clientY - rect.top
      const anchorX =
        Math.round((localX - CANVAS_DOT_GRID_OFFSET) / CANVAS_DOT_GRID_SPACING) *
          CANVAS_DOT_GRID_SPACING +
        CANVAS_DOT_GRID_OFFSET
      const anchorY =
        Math.round((localY - CANVAS_DOT_GRID_OFFSET) / CANVAS_DOT_GRID_SPACING) *
          CANVAS_DOT_GRID_SPACING +
        CANVAS_DOT_GRID_OFFSET
      stage.style.setProperty('--canvas-dot-hover-x', `${anchorX}px`)
      stage.style.setProperty('--canvas-dot-hover-y', `${anchorY}px`)
      stage.dataset.pointerActive = 'true'
    })
  }, [])

  const handleStagePointerLeave = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    pendingPointerRef.current = null
    if (pointerAuraFrameRef.current != null) {
      window.cancelAnimationFrame(pointerAuraFrameRef.current)
      pointerAuraFrameRef.current = null
    }
    delete stage.dataset.pointerActive
  }, [])

  // ─── 外部文件拖拽到画布 ──────────────────────────────────────────────────
  // 画布是一个 HTML5 drop 目标：dragover 必须 preventDefault 才能触发 drop；
  // enter/leave 用计数器处理嵌套子元素，避免抖动。坐标沿用右键菜单的
  // screenToFlowPosition，保证落点与视觉一致。
  const handleStageDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!onDropFiles) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    },
    [onDropFiles],
  )

  const handleStageDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!onDropFiles) return
      event.preventDefault()
      dragDepthRef.current += 1
      if (dragDepthRef.current === 1) setDropActive(true)
    },
    [onDropFiles],
  )

  const handleStageDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!onDropFiles) return
      event.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDropActive(false)
    },
    [onDropFiles],
  )

  const handleStageDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!onDropFiles) return
      event.preventDefault()
      dragDepthRef.current = 0
      setDropActive(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      const instance = flowInstanceRef.current
      const position: CanvasStagePoint = instance
        ? instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: event.clientX, y: event.clientY }
      onDropFiles(position, files)
    },
    [onDropFiles],
  )

  return (
    <>
      <div
        className={`canvas-stage canvas-stage-tool-${activeTool === 'pan' ? 'pan' : 'select'}${
          snapshot.board.settings.grid === true ? '' : ' canvas-stage-grid-off'
        }${dropActive ? ' canvas-stage-drop-active' : ''}`}
        ref={stageRef}
        onPointerMove={handleStagePointerMove}
        onPointerLeave={handleStagePointerLeave}
        onDoubleClickCapture={handleStageDoubleClickCapture}
        onContextMenuCapture={handleStageContextMenuCapture}
        onDragOver={handleStageDragOver}
        onDragEnter={handleStageDragEnter}
        onDragLeave={handleStageDragLeave}
        onDrop={handleStageDrop}
      >
        <div className="canvas-stage-dot-aura" aria-hidden>
          {CANVAS_DOT_AURA_POINTS.map((point) => (
            <span
              key={point.id}
              style={
                {
                  '--canvas-dot-offset-x': `${point.offsetX}px`,
                  '--canvas-dot-offset-y': `${point.offsetY}px`,
                  '--canvas-dot-opacity': point.opacity,
                  '--canvas-dot-scale': point.scale,
                  '--canvas-dot-color': point.color,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultViewport={boardViewport}
          minZoom={CANVAS_MIN_ZOOM}
          maxZoom={CANVAS_MAX_ZOOM}
          nodeOrigin={defaultNodeOrigin}
          onlyRenderVisibleElements
          // 连接热区略大于可见锚点，方便从节点边缘开始牵线并降低误操作。
          connectionRadius={32}
          nodesDraggable={activeTool === 'select' && nodesInitialized}
          nodesConnectable
          elementsSelectable
          panOnDrag={activeTool === 'pan'}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          zoomActivationKeyCode="Control"
          multiSelectionKeyCode={['Meta', 'Control']}
          selectionMode={SelectionMode.Partial}
          selectionOnDrag={activeTool === 'select' && nodesInitialized}
          onNodesChange={handleNodesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          connectionLineStyle={{ strokeWidth: 3 }}
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
          onNodeContextMenu={handleNodeContextMenu}
          onNodeDoubleClick={handleNodeDoubleClick}
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
          {minimapOpen && (
            <MiniMap
              className="canvas-minimap"
              style={{ width: CANVAS_MINIMAP_WIDTH, height: CANVAS_MINIMAP_HEIGHT }}
              pannable
              onClick={handleMinimapClick}
              ariaLabel="小地图：点击或拖动可视区域以移动画布"
              nodeColor={minimapNodeColor}
              nodeBorderRadius={8}
              nodeStrokeWidth={0}
              bgColor="rgba(20, 20, 20, 0.78)"
              maskColor="rgba(255, 255, 255, 0.08)"
              maskStrokeColor="rgba(255, 255, 255, 0.18)"
              maskStrokeWidth={1}
            />
          )}
          <CanvasZoomControls className="canvas-controls" />
        </ReactFlow>
        <button
          type="button"
          className={`canvas-minimap-toggle${minimapOpen ? ' is-open' : ''}`}
          aria-label={minimapOpen ? '收起小地图' : '展开小地图'}
          title={minimapOpen ? '收起小地图' : '展开小地图'}
          onClick={() => setMinimapOpen((open) => !open)}
        >
          {minimapOpen ? <Icons.Minimize size={18} /> : <Icons.Map size={18} />}
        </button>
        {selectedEdgeIds.length > 0 && (
          <button type="button" className="canvas-edge-delete-button" onClick={deleteSelectedEdges}>
            删除连线
          </button>
        )}
        {edgeContextMenu && (
          <div
            ref={edgeContextMenuRef}
            className="canvas-edge-context-menu"
            style={{
              left: edgeContextMenu.left,
              top: edgeContextMenu.top,
              maxHeight: edgeContextMenu.maxHeight,
            }}
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
            ref={paneContextMenuRef}
            className={`canvas-pane-context-menu${
              paneContextMenu.openSubmenusLeft ? ' canvas-pane-context-menu-submenus-left' : ''
            }${paneContextMenu.openSubmenusUp ? ' canvas-pane-context-menu-submenus-up' : ''}`}
            style={{
              left: paneContextMenu.left,
              top: paneContextMenu.top,
              maxHeight: paneContextMenu.maxHeight,
            }}
            role="menu"
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {selectedNodeIds.length > 0 && (
              <>
                <div className="canvas-pane-context-section-title">选中节点</div>
                {(onConfigureSelectedTasks || onSubmitSelectedTasks) && (
                  <>
                    {onConfigureSelectedTasks && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!selectedContext.canBatchConfigureTasks}
                        title={selectedContext.batchTaskConfigureDisabledReason ?? undefined}
                        onClick={() => {
                          closePaneContextMenu()
                          onConfigureSelectedTasks(selectedContext.batchTaskNodeIds)
                        }}
                      >
                        <Icons.Sliders size={14} />
                        <span>批量配置参数…</span>
                      </button>
                    )}
                    {onSubmitSelectedTasks && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!selectedContext.canBatchSubmitTasks}
                        title={selectedContext.batchTaskSubmitDisabledReason ?? undefined}
                        onClick={() => {
                          closePaneContextMenu()
                          onSubmitSelectedTasks(selectedContext.batchTaskNodeIds)
                        }}
                      >
                        <Icons.Play size={14} />
                        <span>批量提交运行</span>
                      </button>
                    )}
                    <div className="canvas-pane-context-divider" />
                  </>
                )}
                {onAddNodesToAgent && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      onAddNodesToAgent()
                    }}
                  >
                    <Icons.MessageSquarePlus size={14} />
                    <span>
                      添加到 Agent 对话
                      {selectedNodeIds.length > 1 ? `（${selectedNodeIds.length}）` : ''}
                    </span>
                  </button>
                )}
                {onDuplicateSelectedNodes && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      onDuplicateSelectedNodes()
                    }}
                  >
                    <Icons.Copy size={14} />
                    <span>
                      复制选中节点
                      {selectedNodeIds.length > 1 ? `（${selectedNodeIds.length}）` : ''}
                    </span>
                  </button>
                )}
                {selectedContext.canCreateGroup && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      onCreateGroupFromSelection()
                    }}
                  >
                    <Icons.Layers size={14} />
                    <span>创建组</span>
                  </button>
                )}
                {selectedContext.canMergeSelectionToImage && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      onMergeSelectionToImage()
                    }}
                  >
                    <Icons.Image size={14} />
                    <span>合并为组合图</span>
                  </button>
                )}
                {selectedContext.canAddToGroup && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      const groupId = selectedContext.selectedGroupIds[0]
                      if (groupId) onAddSelectionToGroup(groupId)
                    }}
                  >
                    <Icons.Plus size={14} />
                    <span>加入选中的组</span>
                  </button>
                )}
                {selectedContext.canRemoveFromGroup && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      selectedContext.groupedNodeIds.forEach((nodeId) =>
                        onRemoveNodeFromGroup(nodeId),
                      )
                    }}
                  >
                    <Icons.ArrowUp size={14} />
                    <span>移出组</span>
                  </button>
                )}
                {selectedContext.canDissolveGroup && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      const groupId = selectedContext.selectedGroupIds[0]
                      if (groupId) onDissolveGroup(groupId)
                    }}
                  >
                    <Icons.FolderOpen size={14} />
                    <span>解散组</span>
                  </button>
                )}
                {(onDeleteSelectedNodes ||
                  (selectedNodeIds.length === 1 &&
                    (onToggleLockSelectedNodes || onBringSelectedNodesToFront))) && (
                  <div className="canvas-pane-context-divider" />
                )}
                {selectedNodeIds.length === 1 && onToggleLockSelectedNodes && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      onToggleLockSelectedNodes()
                    }}
                  >
                    <Icons.Lock size={14} />
                    <span>锁定 / 解锁</span>
                  </button>
                )}
                {selectedNodeIds.length === 1 && onBringSelectedNodesToFront && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePaneContextMenu()
                      onBringSelectedNodesToFront()
                    }}
                  >
                    <Icons.Layers size={14} />
                    <span>置于顶层</span>
                  </button>
                )}
                {onDeleteSelectedNodes && (
                  <button
                    type="button"
                    role="menuitem"
                    className="canvas-menu-item-danger"
                    onClick={() => {
                      closePaneContextMenu()
                      onDeleteSelectedNodes()
                    }}
                  >
                    <Icons.Trash size={14} />
                    <span>
                      删除选中节点
                      {selectedNodeIds.length > 1 ? `（${selectedNodeIds.length}）` : ''}
                    </span>
                  </button>
                )}
              </>
            )}
            <div className="canvas-pane-context-section-title">任务节点</div>
            {onCreatePipelineAtPosition && (
              <CanvasPaneContextSubmenu
                icon={<Icons.Workflow size={14} />}
                label={CANVAS_FUNCTIONAL_MENU_LABEL}
                openLeft={paneContextMenu.openSubmenusLeft}
                openUp={paneContextMenu.openSubmenusUp}
              >
                <CanvasPaneResourceNodeActions
                  onAddImage={handleAddImageFromPane}
                  onAddDirectorStage3D={
                    onAddDirectorStage3DAtPosition
                      ? handleAddDirectorStage3DFromPane
                      : undefined
                  }
                  onAddVideoWorkbench={
                    onAddVideoWorkbenchAtPosition ? handleAddVideoWorkbenchFromPane : undefined
                  }
                  onInsertAsset={onInsertAssetFromPane ? handleInsertAssetFromPane : undefined}
                />
                <div className="canvas-pane-context-divider" />
                {panePipelineOperationGroups.map((group) => (
                  <div key={group.id} className="canvas-pane-context-group">
                    <div className="canvas-pane-context-section-title">{group.label}</div>
                    {group.actions.map((op) => (
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
                ))}
                <div className="canvas-pane-context-section-title">通用视觉工具</div>
                {CANVAS_FUNCTIONAL_CREATE_OPERATIONS.map((item) => {
                  const visual = getOperationVisual(item.operation)
                  return (
                    <button
                      key={item.operation}
                      type="button"
                      role="menuitem"
                      className={`canvas-pane-context-op ${visual.colorClass}`}
                      onClick={() => handleCreateOperationFromPane(item.operation)}
                    >
                      <span className="canvas-pane-context-op-icon">{visual.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </CanvasPaneContextSubmenu>
            )}
            {onCreateOperationAtPosition && (
              <CanvasPaneContextSubmenu
                icon={<Icons.Sparkles size={14} />}
                label={CANVAS_BASE_TASK_MENU_LABEL}
                openLeft={paneContextMenu.openSubmenusLeft}
                openUp={paneContextMenu.openSubmenusUp}
              >
                <CanvasPaneResourceNodeActions
                  onAddText={handleAddTextFromPane}
                />
                <div className="canvas-pane-context-divider" />
                {CANVAS_BASE_CREATE_OPERATION_GROUPS.map((group) => (
                  <div key={group.id} className="canvas-pane-context-group">
                    <div className="canvas-pane-context-section-title">{group.label}</div>
                    {group.items.map((item) => {
                      const visual = getOperationVisual(item.operation)
                      return (
                        <button
                          key={item.operation}
                          type="button"
                          role="menuitem"
                          className={`canvas-pane-context-op ${visual.colorClass}`}
                          onClick={() => handleCreateOperationFromPane(item.operation)}
                        >
                          <span className="canvas-pane-context-op-icon">{visual.icon}</span>
                          <span>{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </CanvasPaneContextSubmenu>
            )}
            <div className="canvas-pane-context-divider" />
            <div className="canvas-pane-context-section-title">画布</div>
            <button type="button" role="menuitem" onClick={handleResetZoom}>
              <Icons.RotateCcw size={14} />
              <span>复原缩放比例</span>
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export function CanvasStage(props: ComponentProps<typeof CanvasStageInner>) {
  return (
    <ReactFlowProvider>
      <CanvasStageInner {...props} />
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

function getClientPoint(
  event: MouseEvent | TouchEvent,
): { clientX: number; clientY: number } | null {
  if ('clientX' in event) return { clientX: event.clientX, clientY: event.clientY }
  const touch = event.changedTouches[0] ?? event.touches[0]
  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null
}
