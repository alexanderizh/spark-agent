import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Segmented, Tag } from '@lobehub/ui'
import { Drawer, Input, InputNumber, Modal, Spin, Tooltip, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasAssetDrawer } from './CanvasAssetDrawer'
import { CanvasInlineAiComposer } from './CanvasInlineAiComposer'
import { CanvasInspector } from './CanvasInspector'
import { CanvasStage, type CanvasStageViewport } from './CanvasStage'
import { CanvasTaskQueue } from './CanvasTaskQueue'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import { CanvasBoardSidebar } from './CanvasBoardSidebar'
import { CanvasAssetsPanel, downloadAsset } from './CanvasAssetsPanel'
import { CanvasAssetManagerPanel } from './CanvasAssetManagerPanel'
import { CanvasBottomDock } from './CanvasBottomDock'
import { CanvasHistoryPanel } from './CanvasHistoryPanel'
import { CanvasTemplatePanel } from './CanvasTemplatePanel'
import { type AddNodeMenuItem } from './CanvasAddNodeMenu'
import type { CanvasTemplate } from './canvasTemplates'
import { useCanvasWorkspace, useCanvasWorkspaceUi } from './canvas.store'
import { canvasApi, isCanvasDirty, revertProject, saveCanvas } from './canvas.api'
import { useApp } from '../../AppContext'
import type {
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasProject,
  CanvasProjectSettings,
  CanvasTask,
} from './canvas.types'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import './CanvasWorkspaceView.less'

type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
type CanvasPoint = { x: number; y: number }
type PreparedImageUpload = {
  file: File
  filePath: string
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}

const CANVAS_SIDE_PANEL_WIDTH_KEY = 'spark-canvas:side-panel-width'
const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 360
const CANVAS_SIDE_PANEL_MIN_WIDTH = 300
const CANVAS_SIDE_PANEL_MAX_WIDTH = 640
const CANVAS_SIDE_PANEL_KEYBOARD_STEP = 24
const GROUP_IMAGE_GAP = 18
const GROUP_IMAGE_PADDING_X = 28
const GROUP_IMAGE_HEADER_HEIGHT = 56
const GROUP_IMAGE_PADDING_BOTTOM = 28

function clampSidePanelWidth(width: number): number {
  return Math.min(Math.max(width, CANVAS_SIDE_PANEL_MIN_WIDTH), CANVAS_SIDE_PANEL_MAX_WIDTH)
}

function readSidePanelWidth(): number {
  if (typeof window === 'undefined') return CANVAS_SIDE_PANEL_DEFAULT_WIDTH
  try {
    const parsed = Number(window.localStorage.getItem(CANVAS_SIDE_PANEL_WIDTH_KEY))
    return Number.isFinite(parsed) ? clampSidePanelWidth(parsed) : CANVAS_SIDE_PANEL_DEFAULT_WIDTH
  } catch {
    return CANVAS_SIDE_PANEL_DEFAULT_WIDTH
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = src
  })
}

function fitImageNodeSize(width: number, height: number): { width: number; height: number } {
  const headerHeight = 36
  if (!width || !height) return { width: 320, height: 260 }
  const aspect = height / width
  let nodeWidth = Math.min(Math.max(width, 260), 420)
  let bodyHeight = Math.round(nodeWidth * aspect)
  if (bodyHeight > 680) {
    bodyHeight = 680
    nodeWidth = Math.max(220, Math.round(bodyHeight / aspect))
  }
  return {
    width: Math.round(nodeWidth),
    height: Math.max(220, bodyHeight + headerHeight),
  }
}

function fitGroupedImageNodeSize(width: number, height: number): { width: number; height: number } {
  const headerHeight = 36
  const nodeWidth = 220
  if (!width || !height) return { width: nodeWidth, height: 196 }
  const aspect = height / width
  const bodyHeight = Math.min(Math.max(Math.round(nodeWidth * aspect), 120), 260)
  return {
    width: nodeWidth,
    height: bodyHeight + headerHeight,
  }
}

function getImageGridColumns(count: number): number {
  if (count <= 1) return 1
  return Math.min(3, Math.ceil(Math.sqrt(count)))
}

function getImageGridMetrics(items: { width: number; height: number }[]): {
  columns: number
  columnWidths: number[]
  rowHeights: number[]
  width: number
  height: number
} {
  const columns = getImageGridColumns(items.length)
  const rows = Math.ceil(items.length / columns)
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)

  items.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, item.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, item.height)
  })

  return {
    columns,
    columnWidths,
    rowHeights,
    width:
      columnWidths.reduce((total, width) => total + width, 0) +
      Math.max(0, columns - 1) * GROUP_IMAGE_GAP,
    height:
      rowHeights.reduce((total, height) => total + height, 0) +
      Math.max(0, rows - 1) * GROUP_IMAGE_GAP,
  }
}

function layoutGroupedImages(
  items: PreparedImageUpload[],
  groupPosition: CanvasPoint,
): (PreparedImageUpload & CanvasPoint)[] {
  const metrics = getImageGridMetrics(items)
  const columnOffsets = metrics.columnWidths.map(
    (_, index) =>
      metrics.columnWidths.slice(0, index).reduce((total, width) => total + width, 0) +
      index * GROUP_IMAGE_GAP,
  )
  const rowOffsets = metrics.rowHeights.map(
    (_, index) =>
      metrics.rowHeights.slice(0, index).reduce((total, height) => total + height, 0) +
      index * GROUP_IMAGE_GAP,
  )

  return items.map((item, index) => {
    const column = index % metrics.columns
    const row = Math.floor(index / metrics.columns)
    return {
      ...item,
      x: Math.round(groupPosition.x + GROUP_IMAGE_PADDING_X + (columnOffsets[column] ?? 0)),
      y: Math.round(groupPosition.y + GROUP_IMAGE_HEADER_HEIGHT + (rowOffsets[row] ?? 0)),
    }
  })
}

function clampPosition(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function positionNodeInViewport(
  viewport: CanvasStageViewport | null,
  size: { width: number; height: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || viewport.zoom <= 0) {
    return fallback
  }

  const visibleLeft = -viewport.x / viewport.zoom
  const visibleTop = -viewport.y / viewport.zoom
  const visibleRight = (viewport.width - viewport.x) / viewport.zoom
  const visibleBottom = (viewport.height - viewport.y) / viewport.zoom
  const centerX = visibleLeft + (visibleRight - visibleLeft) / 2
  const centerY = visibleTop + (visibleBottom - visibleTop) / 2

  return {
    x: Math.round(
      clampPosition(
        centerX - size.width / 2,
        visibleLeft + 24,
        visibleRight - size.width - 24,
      ),
    ),
    y: Math.round(
      clampPosition(
        centerY - size.height / 2,
        visibleTop + 24,
        visibleBottom - size.height - 24,
      ),
    ),
  }
}

function buildTaskInputFiles(
  nodes: CanvasNode[],
  inputRoles?: Record<string, CanvasTaskInputRole>,
): CanvasMediaTaskInputFile[] {
  let imageIndex = 0
  return nodes
    .map((node) => {
      if (!node.data.url) return null
      const type =
        node.type === 'image'
          ? ('image' as const)
          : node.type === 'audio'
            ? ('audio' as const)
            : node.type === 'video'
              ? ('video' as const)
              : ('file' as const)
      const currentImageIndex = node.type === 'image' ? imageIndex++ : -1
      const role =
        inputRoles?.[node.id] ??
        (currentImageIndex >= 0
          ? currentImageIndex === 0
            ? ('first_frame' as const)
            : currentImageIndex === 1
              ? ('last_frame' as const)
              : ('reference' as const)
          : ('input' as const))
      return {
        type,
        role,
        ...(node.data.url.startsWith('data:')
          ? { dataUrl: node.data.url }
          : { url: node.data.url }),
        ...(node.data.mimeType ? { mimeType: node.data.mimeType } : {}),
      }
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)
}

async function buildCloudTaskInputFiles(
  nodes: CanvasNode[],
  inputTransport: CanvasInputTransport | undefined,
  inputRoles?: Record<string, CanvasTaskInputRole>,
): Promise<CanvasMediaTaskInputFile[]> {
  const files = buildTaskInputFiles(nodes, inputRoles)
  if (files.length === 0) return files
  if (inputTransport === 'base64') {
    return Promise.all(
      files.map(async (file) => {
        if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://'))
          return file
        return {
          ...file,
          dataUrl: await readUrlAsDataUrl(file.url),
        }
      }),
    )
  }
  if (inputTransport !== 'cloud_url') return files
  return Promise.all(
    files.map(async (file, index) => {
      if (file.type !== 'image') return file
      if (file.url && /^https?:\/\//i.test(file.url)) return file
      const filePath = file.url ? decodeSafeFileUrl(file.url) : null
      const uploaded = await window.spark.invoke('auth:upload-file', {
        ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
        ...(filePath ? { filePath } : {}),
        fileName: `canvas-input-${index + 1}.${extensionFromMime(file.mimeType)}`,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      })
      return {
        type: file.type,
        ...(file.role ? { role: file.role } : {}),
        url: uploaded.aiUrl,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      }
    }),
  )
}

function readUrlAsDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.readAsDataURL(blob)
        }),
    )
}

async function ensureCanvasWorkflowLogin(): Promise<boolean> {
  try {
    await window.spark.invoke('auth:me', {})
    return true
  } catch {
    message.warning('请先登录云账户后使用画布 AI 工作流')
    return false
  }
}

function extensionFromMime(mimeType: string | undefined): string {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

function decodeSafeFileUrl(safeFileUrl: string): string | null {
  try {
    if (!safeFileUrl.startsWith('safe-file://')) return null
    const rest = safeFileUrl.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    return decodeURIComponent(escape(atob(base64 + padding)))
  } catch {
    return null
  }
}

function buildPromptContext(nodes: CanvasNode[]): string {
  return nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => node.data.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join('\n\n')
}

function mergePromptWithNodeContext(prompt: string, nodes: CanvasNode[]): string {
  const trimmedPrompt = prompt.trim()
  const context = buildPromptContext(nodes)
  if (!context) return trimmedPrompt
  if (!trimmedPrompt) return context
  if (trimmedPrompt.includes(context)) return trimmedPrompt
  return `${trimmedPrompt}\n\n画布节点内容：\n${context}`
}

function placeNodeRightOfNodes(
  nodes: CanvasNode[],
  fallback: { x: number; y: number },
  gap = 80,
): { x: number; y: number } {
  if (nodes.length === 0) return fallback
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const top = Math.min(...nodes.map((node) => node.y))
  return {
    x: Math.round(right + gap),
    y: Math.round(top),
  }
}

function expandCanvasInputNodes(selectedNodes: CanvasNode[], allNodes: CanvasNode[]): CanvasNode[] {
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const result: CanvasNode[] = []
  const seen = new Set<string>()
  const pushNode = (node: CanvasNode) => {
    if (node.hidden || seen.has(node.id)) return
    seen.add(node.id)
    result.push(node)
  }

  for (const node of selectedNodes) {
    if (node.type !== 'group') {
      pushNode(node)
      continue
    }
    const members = allNodes
      .filter((item) => item.parentNodeId === node.id && !item.hidden)
      .sort((left, right) => {
        const leftX = node.x + left.x
        const rightX = node.x + right.x
        const leftY = node.y + left.y
        const rightY = node.y + right.y
        return leftX - rightX || leftY - rightY || left.zIndex - right.zIndex
      })
    if (members.length === 0) {
      pushNode(node)
      continue
    }
    for (const member of members) {
      const latest = byId.get(member.id) ?? member
      pushNode(latest)
    }
  }

  return result
}

function resolveCanvasInputNodes(nodeIds: string[] | undefined, allNodes: CanvasNode[]): CanvasNode[] {
  if (!nodeIds || nodeIds.length === 0) return []
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const orderedNodes = nodeIds.map((id) => byId.get(id)).filter((node): node is CanvasNode => Boolean(node))
  return expandCanvasInputNodes(orderedNodes, allNodes)
}

function fallbackPromptForOperation(operation: CanvasOperationType): string {
  if (operation === 'image_edit') return '请基于输入图片进行自然编辑，保持主体与画面质量。'
  if (operation === 'image_to_image') return '请基于输入图片生成一个高质量变体。'
  if (operation === 'image_compose') return '请将输入图片自然合成为一张高质量图片。'
  if (operation === 'image_to_video') return '请基于输入图片生成一段自然流畅的视频。'
  if (operation === 'video_edit') return '请基于输入视频和参考帧进行自然视频编辑。'
  if (operation === 'audio_transcribe') return '请转写输入音频内容。'
  return ''
}

function areNodeIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable ||
    Boolean(
      target.closest(
        '[contenteditable="true"], .canvas-inline-ai-composer, .ant-modal, .ant-drawer',
      ),
    )
  )
}

function toolLabel(tool: CanvasTool): string {
  return tool === 'pan' ? '平移画布' : '选择节点'
}

export function CanvasWorkspaceView({
  projectId,
  onBack,
}: {
  projectId: string
  onBack: () => void
}) {
  const {
    snapshot,
    loading,
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
    setDefaultBoard,
    copyNodesToBoard,
    // 资产
    insertAsset,
    refresh,
    applyTemplate,
  } = useCanvasWorkspace(projectId)
  // 工作台 UI 状态
  const {
    leftPanelTab,
    setLeftPanelTab,
    bottomToolbarCollapsed,
    setBottomToolbarCollapsed,
    leftPanelCollapsed,
    setLeftPanelCollapsed,
  } = useCanvasWorkspaceUi()
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')
  const [toolSwitchHint, setToolSwitchHint] = useState<{ tool: CanvasTool; nonce: number } | null>(
    null,
  )
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false)
  const [inlineAiOpen, setInlineAiOpen] = useState(false)
  const [sidePanelTab, setSidePanelTab] = useState<'details' | 'project'>('details')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const canvasViewportRef = useRef<CanvasStageViewport | null>(null)
  const [sidePanelWidth, setSidePanelWidth] = useState(readSidePanelWidth)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePositionRef = useRef<CanvasPoint | null>(null)
  const activeToolRef = useRef<CanvasTool>('select')
  const { registerNavGuard } = useApp()
  const [dirty, setDirty] = useState(() => isCanvasDirty())
  const [saving, setSaving] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const savingRef = useRef(false)
  const leaveResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null)
  const sidePanelStyle = useMemo(
    () =>
      ({
        '--canvas-side-panel-width': `${sidePanelWidth}px`,
      }) as CSSProperties,
    [sidePanelWidth],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_SIDE_PANEL_WIDTH_KEY, String(sidePanelWidth))
    } catch {
      // Ignore storage failures; the current session still keeps the resized panel.
    }
  }, [sidePanelWidth])

  useEffect(
    () => () => {
      document.body.classList.remove('canvas-side-panel-resizing')
    },
    [],
  )

  const updateSidePanelWidth = useCallback((width: number) => {
    setSidePanelWidth(Math.round(clampSidePanelWidth(width)))
  }, [])

  const handleSidePanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidePanelWidth
      const body = document.body
      body.classList.add('canvas-side-panel-resizing')

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateSidePanelWidth(startWidth + startX - moveEvent.clientX)
      }

      const handlePointerUp = () => {
        body.classList.remove('canvas-side-panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [sidePanelWidth, updateSidePanelWidth],
  )

  const handleSidePanelResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        updateSidePanelWidth(sidePanelWidth + CANVAS_SIDE_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        updateSidePanelWidth(sidePanelWidth - CANVAS_SIDE_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'Home') {
        event.preventDefault()
        updateSidePanelWidth(CANVAS_SIDE_PANEL_MIN_WIDTH)
      } else if (event.key === 'End') {
        event.preventDefault()
        updateSidePanelWidth(CANVAS_SIDE_PANEL_MAX_WIDTH)
      }
    },
    [sidePanelWidth, updateSidePanelWidth],
  )

  const doSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    try {
      const ok = await saveCanvas()
      if (ok) {
        message.success('画布已保存')
      } else {
        message.error('保存失败，请查看控制台日志')
      }
      return ok
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  // 监听 dirty 变化，刷新「未保存」徽标
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ dirty?: boolean }>).detail
      setDirty(Boolean(detail?.dirty))
    }
    window.addEventListener('canvas:dirty', handler as EventListener)
    return () => window.removeEventListener('canvas:dirty', handler as EventListener)
  }, [])

  // Ctrl / Cmd + S 手动保存（不在输入框内时）
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 's') return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      void doSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doSave])

  // 离开确认：返回用户选择（'save' 表示弹窗内已完成落库）
  const askLeave = useCallback((): Promise<'save' | 'discard' | 'cancel'> => {
    return new Promise((resolve) => {
      leaveResolveRef.current = resolve
      setLeaveOpen(true)
    })
  }, [])

  // 注册导航守卫：侧边栏切换视图时若 dirty，先弹离开确认
  useEffect(() => {
    registerNavGuard(async () => {
      if (!isCanvasDirty()) return true
      const choice = await askLeave()
      if (choice === 'cancel') return false
      if (choice === 'discard') await revertProject(projectId)
      return true
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, askLeave, projectId])

  const handleBackWithGuard = useCallback(async () => {
    if (!isCanvasDirty()) {
      onBack()
      return
    }
    const choice = await askLeave()
    if (choice === 'cancel') return
    if (choice === 'discard') await revertProject(projectId)
    onBack()
  }, [askLeave, onBack, projectId])

  const onLeaveSave = useCallback(async () => {
    const ok = await doSave()
    if (!ok) return // 保存失败：保持弹窗打开，不离开
    setLeaveOpen(false)
    leaveResolveRef.current?.('save')
    leaveResolveRef.current = null
  }, [doSave])
  const onLeaveDiscard = useCallback(() => {
    setLeaveOpen(false)
    leaveResolveRef.current?.('discard')
    leaveResolveRef.current = null
  }, [])
  const onLeaveCancel = useCallback(() => {
    setLeaveOpen(false)
    leaveResolveRef.current?.('cancel')
    leaveResolveRef.current = null
  }, [])

  const selectedNodes = useMemo(
    () => snapshot?.nodes.filter((node) => selectedNodeIds.includes(node.id)) ?? [],
    [selectedNodeIds, snapshot?.nodes],
  )
  const aiInputNodes = useMemo(
    () => expandCanvasInputNodes(selectedNodes, snapshot?.nodes ?? []),
    [selectedNodes, snapshot?.nodes],
  )
  const editingNode = useMemo(
    () => snapshot?.nodes.find((node) => node.id === editingNodeId) ?? null,
    [editingNodeId, snapshot?.nodes],
  )
  const selectedGroups = useMemo(
    () => selectedNodes.filter((node) => node.type === 'group'),
    [selectedNodes],
  )
  const selectedTopLevelNodes = useMemo(
    () => selectedNodes.filter((node) => node.type !== 'group' && !node.parentNodeId),
    [selectedNodes],
  )
  const selectedGroupedNodes = useMemo(
    () => selectedNodes.filter((node) => Boolean(node.parentNodeId)),
    [selectedNodes],
  )
  const canCreateGroup =
    selectedNodes.length >= 2 &&
    selectedNodes.every((node) => node.type !== 'group' && !node.parentNodeId)
  const canAddToGroup = selectedGroups.length === 1 && selectedTopLevelNodes.length > 0
  const canRemoveFromGroup = selectedGroupedNodes.length > 0
  const canDissolveGroup = selectedGroups.length === 1
  const toolSwitchHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    activeToolRef.current = activeTool
  }, [activeTool])

  const showToolSwitchHint = useCallback((tool: CanvasTool) => {
    setToolSwitchHint({ tool, nonce: Date.now() })
    if (toolSwitchHintTimerRef.current != null) clearTimeout(toolSwitchHintTimerRef.current)
    toolSwitchHintTimerRef.current = setTimeout(() => {
      setToolSwitchHint(null)
      toolSwitchHintTimerRef.current = null
    }, 1500)
  }, [])

  const handleToolChange = useCallback((tool: CanvasTool) => {
    activeToolRef.current = tool
    setActiveTool(tool)
  }, [])

  const togglePointerTool = useCallback(() => {
    const nextTool: CanvasTool = activeToolRef.current === 'pan' ? 'select' : 'pan'
    activeToolRef.current = nextTool
    setActiveTool(nextTool)
    showToolSwitchHint(nextTool)
  }, [showToolSwitchHint])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      togglePointerTool()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (toolSwitchHintTimerRef.current != null) clearTimeout(toolSwitchHintTimerRef.current)
    }
  }, [togglePointerTool])

  const handleSelectionChange = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds((previousIds) =>
      areNodeIdsEqual(previousIds, nodeIds) ? previousIds : nodeIds,
    )
  }, [])

  const handleCanvasViewportChange = useCallback((viewport: CanvasStageViewport) => {
    canvasViewportRef.current = viewport
  }, [])

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeIds((previousIds) => previousIds.filter((id) => id !== nodeId))
      void deleteNodes([nodeId])
    },
    [deleteNodes],
  )

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      void duplicateNodes([nodeId])
    },
    [duplicateNodes],
  )

  const handleToggleLockNode = useCallback(
    (nodeId: string) => {
      const node = snapshot?.nodes.find((item) => item.id === nodeId)
      if (!node) return
      void patchNodes([nodeId], { locked: !node.locked })
    },
    [patchNodes, snapshot?.nodes],
  )

  const handleBringNodeToFront = useCallback(
    (nodeId: string) => {
      const nodes = snapshot?.nodes ?? []
      const maxZ = Math.max(0, ...nodes.map((node) => node.zIndex))
      void patchNodes([nodeId], { zIndex: maxZ + 1 })
    },
    [patchNodes, snapshot?.nodes],
  )

  const handleCreateGroup = useCallback(() => {
    if (selectedTopLevelNodes.length < 2) return
    void createGroupNode(selectedTopLevelNodes.map((node) => node.id))
  }, [createGroupNode, selectedTopLevelNodes])

  const handleAddSelectionToGroup = useCallback(
    (groupId?: string) => {
      const targetGroupId = groupId ?? selectedGroups[0]?.id
      if (!targetGroupId || selectedTopLevelNodes.length === 0) return
      void addNodesToGroup(
        targetGroupId,
        selectedTopLevelNodes.map((node) => node.id),
      )
    },
    [addNodesToGroup, selectedGroups, selectedTopLevelNodes],
  )

  const handleRemoveFromGroup = useCallback(
    (nodeIds?: string[]) => {
      const targetNodeIds = nodeIds ?? selectedGroupedNodes.map((node) => node.id)
      if (targetNodeIds.length === 0) return
      void removeNodesFromGroup(targetNodeIds)
    },
    [removeNodesFromGroup, selectedGroupedNodes],
  )

  const handleDissolveGroup = useCallback(
    (groupId?: string) => {
      const targetGroupId = groupId ?? selectedGroups[0]?.id
      if (!targetGroupId) return
      void dissolveGroupNode(targetGroupId)
    },
    [dissolveGroupNode, selectedGroups],
  )

  const handleOpenInlineAi = useCallback(
    (nodeId?: string) => {
      if (nodeId && !selectedNodeIds.includes(nodeId)) {
        setSelectedNodeIds([nodeId])
      }
      setInlineAiOpen(true)
    },
    [selectedNodeIds],
  )

  const handleEditNode = useCallback((nodeId: string) => {
    setSelectedNodeIds([nodeId])
    setEditingNodeId(nodeId)
  }, [])

  const handleSaveNodeEdit = useCallback(
    async (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => {
      await patchNodes([node.id], patch)
      await updateNodeData(node.id, data)
      setEditingNodeId(null)
    },
    [patchNodes, updateNodeData],
  )

  // ─── 节点创建动作（useCallback，必须在 early return 之前）────────────────
  // 这些被 handleAddNodeItem / Stage / BottomDock 等多处引用，统一在 hooks 区定义。
  const addText = useCallback(
    async (preferredPosition?: CanvasPoint) => {
      const position = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(
            canvasViewportRef.current,
            { width: 280, height: 164 },
            { x: 140, y: 120 },
          )
      await createTextNode({
        text: '双击后续版本可直接编辑文本内容。',
        x: position.x,
        y: position.y,
      })
    },
    [createTextNode],
  )

  const uploadFirstImage = useCallback((preferredPosition?: CanvasPoint) => {
    pendingImagePositionRef.current = preferredPosition
      ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
      : null
    fileInputRef.current?.click()
  }, [])

  const handleSwitchBoard = useCallback(
    async (boardId: string) => {
      if (!snapshot || boardId === snapshot.board.id) return
      const vp = canvasViewportRef.current
      const viewport = vp ? { x: vp.x, y: vp.y, zoom: vp.zoom } : undefined
      await switchBoard(boardId, viewport)
      setSelectedNodeIds([])
    },
    [snapshot, switchBoard],
  )

  const handleInsertAsset = useCallback(
    async (assetId: string) => {
      if (!snapshot) return
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 280, height: 200 },
        { x: 220, y: 180 },
      )
      await insertAsset({
        assetId,
        boardId: snapshot.board.id,
        x: position.x,
        y: position.y,
      })
      message.success('已插入资产到当前视口')
    },
    [insertAsset, snapshot],
  )

  /** 应用模板：在当前视口中心生成节点组合（文档 §7.8） */
  const handleApplyTemplate = useCallback(
    async (template: CanvasTemplate) => {
      if (!snapshot) return
      const position = positionNodeInViewport(
        canvasViewportRef.current,
        { width: 480, height: 320 },
        { x: 200, y: 160 },
      )
      await applyTemplate({
        boardId: snapshot.board.id,
        originX: position.x,
        originY: position.y,
        nodes: template.nodes,
        ...(template.edges ? { edges: template.edges } : {}),
      })
      setTemplateOpen(false)
    },
    [applyTemplate, snapshot],
  )

  const referencedAssetIds = useMemo(
    () =>
      new Set(
        (snapshot?.nodes ?? [])
          .map((node) => node.assetId)
          .filter((id): id is string => Boolean(id)),
      ),
    [snapshot?.nodes],
  )

  const handleLocateAsset = useCallback(
    (assetId: string) => {
      if (!snapshot) return
      const node = snapshot.nodes.find((item) => item.assetId === assetId)
      if (node) {
        setSelectedNodeIds([node.id])
        message.info(`已定位到节点：${node.title ?? node.type}`)
      }
    },
    [snapshot],
  )

  const handleAddNodeItem = useCallback(
    (item: AddNodeMenuItem) => {
      // 内容节点：文本 / prompt 直接创建
      if (item.nodeType === 'text' || item.nodeType === 'prompt') {
        void addText()
        return
      }
      // 图片走上传链路
      if (item.action === 'upload_image' || item.nodeType === 'image') {
        uploadFirstImage()
        return
      }
      // 资源入口
      if (item.action === 'insert_asset') {
        setLeftPanelTab('assets')
        return
      }
      if (item.action === 'from_history' || item.action === 'from_template') {
        message.info('该入口将在后续阶段开放')
        return
      }
      // AI 工作节点：打开 inline AI composer 并预选 operation
      if (item.operation) {
        setInlineAiOpen(true)
      }
    },
    [addText, uploadFirstImage, setLeftPanelTab],
  )

  const handleFitView = useCallback(() => {
    message.info('适配屏幕：可双击画布或使用缩放控制')
  }, [])
  const handleResetZoom = useCallback(() => {
    // 复用现有 pane 菜单的 resetZoom 行为近似
  }, [])
  const handleToggleGrid = useCallback(() => {
    if (!snapshot) return
    const next = snapshot.board.settings.grid !== false ? false : true
    void canvasApi
      .updateBoardSettings(projectId, snapshot.board.id, { grid: next })
      .then(() => {
        void refresh()
      })
      .catch(() => {})
  }, [snapshot, projectId, refresh])

  if (loading) {
    return (
      <div className="canvas-workspace canvas-workspace-loading">
        <Spin tip="正在加载画布..." />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="canvas-workspace canvas-workspace-loading">
        <Empty description="画布不存在" />
      </div>
    )
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    const preferredPosition = pendingImagePositionRef.current
    pendingImagePositionRef.current = null
    event.target.value = ''
    if (selectedFiles.length === 0) return

    const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      message.warning('请选择图片文件')
      return
    }
    if (imageFiles.length < selectedFiles.length) {
      message.warning('已跳过非图片文件')
    }

    try {
      const shouldGroup = imageFiles.length > 1
      const preparedImages: PreparedImageUpload[] = []
      for (const file of imageFiles) {
        const dataUrl = await readFileAsDataUrl(file)
        const dimensions = await readImageDimensions(dataUrl)
        const savedImage = await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          mimeType: file.type,
          suggestedBaseName: file.name.replace(/\.[^.]+$/, ''),
          storageScope: 'canvas',
          ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
        })
        const nodeSize = shouldGroup
          ? fitGroupedImageNodeSize(dimensions.width, dimensions.height)
          : fitImageNodeSize(dimensions.width, dimensions.height)
        preparedImages.push({
          file,
          filePath: savedImage.filePath,
          width: nodeSize.width,
          height: nodeSize.height,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        })
      }

      if (preparedImages.length === 1) {
        const [image] = preparedImages
        if (!image) return
        const position = preferredPosition
          ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
          : positionNodeInViewport(
              canvasViewportRef.current,
              { width: image.width, height: image.height },
              {
                x: 220,
                y: 180,
              },
            )
        const node = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: position.x,
          y: position.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (node) setSelectedNodeIds([node.id])
        return
      }

      const gridMetrics = getImageGridMetrics(preparedImages)
      const groupSize = {
        width: Math.max(360, gridMetrics.width + GROUP_IMAGE_PADDING_X * 2),
        height: Math.max(
          220,
          GROUP_IMAGE_HEADER_HEIGHT + gridMetrics.height + GROUP_IMAGE_PADDING_BOTTOM,
        ),
      }
      const groupPosition = preferredPosition
        ? { x: Math.round(preferredPosition.x), y: Math.round(preferredPosition.y) }
        : positionNodeInViewport(
            canvasViewportRef.current,
            groupSize,
            {
              x: 220,
              y: 180,
            },
          )
      const placedImages = layoutGroupedImages(preparedImages, groupPosition)
      const createdNodeIds: string[] = []
      for (const image of placedImages) {
        const node = await createImageNode({
          file: image.file,
          filePath: image.filePath,
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
          imageWidth: image.imageWidth,
          imageHeight: image.imageHeight,
        })
        if (node) createdNodeIds.push(node.id)
      }
      if (createdNodeIds.length > 1) {
        const nextSnapshot = await createGroupNode(createdNodeIds)
        const createdIdSet = new Set(createdNodeIds)
        const groupNode = nextSnapshot?.nodes.find((node) => {
          if (node.type !== 'group') return false
          const childIds = nextSnapshot.nodes
            .filter((child) => child.parentNodeId === node.id)
            .map((child) => child.id)
          return (
            createdNodeIds.every((id) => childIds.includes(id)) &&
            childIds.every((id) => createdIdSet.has(id))
          )
        })
        setSelectedNodeIds(groupNode ? [groupNode.id] : createdNodeIds)
        message.success(`已添加 ${createdNodeIds.length} 张图片并成组`)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加图片失败')
    }
  }

  const handleCreateTask = async ({
    operation,
    prompt,
    negativePrompt,
    inputNodeIds,
    providerProfileId,
    manifestId,
    modelId,
    modelParams,
    inputTransport,
    inputRoles,
  }: {
    operation: CanvasOperationType
    prompt: string
    negativePrompt?: string
    inputNodeIds?: string[]
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    modelParams?: Record<string, unknown>
    inputTransport?: CanvasInputTransport
    inputRoles?: Record<string, CanvasTaskInputRole>
  }) => {
    if (!(await ensureCanvasWorkflowLogin())) return
    // 从选中节点派生输入文件（图生图 / 图生视频 / 语音转写 等需要参考输入）
    const taskInputNodes =
      inputNodeIds && inputNodeIds.length > 0
        ? resolveCanvasInputNodes(inputNodeIds, snapshot.nodes)
        : aiInputNodes
    const inputFiles = await buildCloudTaskInputFiles(taskInputNodes, inputTransport, inputRoles)
    const mergedPrompt = mergePromptWithNodeContext(prompt, taskInputNodes)
    const effectivePrompt =
      mergedPrompt || (inputFiles.length > 0 ? fallbackPromptForOperation(operation) : '')
    const placement = placeNodeRightOfNodes(
      taskInputNodes.length > 0 ? taskInputNodes : selectedNodes,
      {
        x: 360,
        y: 260,
      },
    )

    await createTask({
      operation,
      prompt: effectivePrompt,
      ...(negativePrompt != null && negativePrompt.trim().length > 0
        ? { negativePrompt: negativePrompt.trim() }
        : {}),
      inputNodeIds: taskInputNodes.map((node) => node.id),
      inputAssetIds: taskInputNodes
        .map((node) => node.assetId)
        .filter((id): id is string => Boolean(id)),
      ...(inputFiles.length > 0 ? { inputFiles } : {}),
      ...(providerProfileId != null ? { providerProfileId } : {}),
      ...(manifestId != null ? { manifestId } : {}),
      ...(modelId != null ? { modelId } : {}),
      ...(modelParams != null ? { modelParams } : {}),
      outputPlacement: {
        x: placement.x,
        y: placement.y,
      },
    })
  }

  const handleRetryTask = async (task: CanvasTask) => {
    if (!(await ensureCanvasWorkflowLogin())) return
    const inputNodes = expandCanvasInputNodes(
      snapshot.nodes.filter((node) => task.inputNodeIds.includes(node.id)),
      snapshot.nodes,
    )
    const taskNode = snapshot.nodes.find((node) => node.taskId === task.id)
    const inputFiles = await buildCloudTaskInputFiles(
      inputNodes,
      task.provider === 'xai' ? 'base64' : 'cloud_url',
    )
    const placement = placeNodeRightOfNodes(taskNode ? [taskNode] : inputNodes, {
      x: 360,
      y: 260,
    })
    await createTask({
      operation: task.operation,
      prompt: task.prompt ?? '',
      inputNodeIds: task.inputNodeIds,
      inputAssetIds: task.inputAssetIds,
      ...(inputFiles.length > 0 ? { inputFiles } : {}),
      ...(task.providerProfileId != null ? { providerProfileId: task.providerProfileId } : {}),
      ...(task.manifestId != null ? { manifestId: task.manifestId } : {}),
      ...(task.modelId != null ? { modelId: task.modelId } : {}),
      modelParams: task.modelParams ?? {},
      outputPlacement: {
        x: placement.x,
        y: placement.y,
      },
    })
  }

  const handleToggleLock = async () => {
    if (selectedNodes.length === 0) return
    const shouldLock = selectedNodes.some((node) => !node.locked)
    await patchNodes(selectedNodeIds, { locked: shouldLock })
  }

  const handleBringToFront = async () => {
    if (selectedNodes.length === 0) return
    const maxZ = Math.max(0, ...snapshot.nodes.map((node) => node.zIndex))
    await patchNodes(selectedNodeIds, { zIndex: maxZ + 1 })
  }

  const handleExportProject = async () => {
    try {
      const result = await canvasApi.exportProjectPackage(projectId)
      if (result.exported) message.success('Canvas 项目包已导出')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出 Canvas 项目失败')
    }
  }

  const handleOpenProjectFolder = async () => {
    try {
      const result = await canvasApi.openProjectFolder(projectId)
      if (!result.opened) message.error(result.error || '打开项目文件夹失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开项目文件夹失败')
    }
  }

  return (
    <div className="canvas-workspace">
      <header
        className="canvas-workspace-header"
        onDoubleClick={() => {
          if (window.spark?.platform === 'darwin') {
            window.spark?.invoke('window:maximize', {}).catch(() => {})
          }
        }}
      >
        <div className="canvas-workspace-header-row">
          <div className="canvas-workspace-title">
            <Button
              size="small"
              type="text"
              icon={<Icons.ArrowLeft size={15} />}
              onClick={() => void handleBackWithGuard()}
            >
              项目
            </Button>
            <div className="canvas-workspace-heading">
              <h2>{snapshot.project.title}</h2>
              <span className="canvas-workspace-meta">
                {snapshot.nodes.length} 节点 / {snapshot.assets.length} 素材 /{' '}
                {snapshot.tasks.length} 任务
              </span>
            </div>
          </div>
          {/* board 切换条（文档 §7.1：项目内多 board 切换） */}
          <div className="canvas-board-switcher">
            {(snapshot.boards ?? [snapshot.board]).map((board) => (
              <button
                key={board.id}
                type="button"
                className={`canvas-board-switcher-chip${board.id === snapshot.board.id ? ' active' : ''}`}
                onClick={() => void handleSwitchBoard(board.id)}
                title={board.name}
              >
                {board.name}
              </button>
            ))}
            <Tooltip title="新建画布">
              <Button
                size="small"
                type="text"
                icon={<Icons.Plus size={14} />}
                onClick={() => void createBoard()}
              />
            </Tooltip>
          </div>
        </div>
        <CanvasToolbar
          saveState={{ dirty, saving }}
          onSave={() => void doSave()}
          onOpenAssets={() => setAssetDrawerOpen(true)}
          onExport={() => void handleExportProject()}
        />
      </header>

      <div
        className={`canvas-workspace-body${leftPanelCollapsed ? ' canvas-left-panel-collapsed' : ''}`}
        style={sidePanelStyle}
      >
        <aside
          className={`canvas-left-workbench${leftPanelCollapsed ? ' canvas-left-workbench-collapsed' : ''}`}
        >
          <div className="canvas-left-workbench-tabs">
            {!leftPanelCollapsed && (
              <>
                <button
                  type="button"
                  className={`canvas-left-workbench-tab${leftPanelTab === 'boards' ? ' active' : ''}`}
                  onClick={() => setLeftPanelTab('boards')}
                >
                  画布
                </button>
                <button
                  type="button"
                  className={`canvas-left-workbench-tab${leftPanelTab === 'assets' ? ' active' : ''}`}
                  onClick={() => setLeftPanelTab('assets')}
                >
                  资产
                </button>
                <button
                  type="button"
                  className={`canvas-left-workbench-tab${leftPanelTab === 'asset_manager' ? ' active' : ''}`}
                  onClick={() => setLeftPanelTab('asset_manager')}
                >
                  资产管理
                </button>
              </>
            )}
            <Tooltip title={leftPanelCollapsed ? '展开工作台' : '收起工作台'}>
              <button
                type="button"
                className="canvas-left-workbench-tab canvas-left-workbench-toggle"
                onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
                aria-label={leftPanelCollapsed ? '展开工作台' : '收起工作台'}
              >
                <Icons.PanelLeft size={14} />
              </button>
            </Tooltip>
          </div>
          {!leftPanelCollapsed && (
            <div className="canvas-left-workbench-content">
              {leftPanelTab === 'boards' && (
                <CanvasBoardSidebar
                  snapshot={snapshot}
                  activeBoardId={snapshot.board.id}
                  onSelectBoard={(boardId) => void handleSwitchBoard(boardId)}
                  onCreateBoard={(input) => void createBoard(input)}
                  onRenameBoard={(boardId, name) => void renameBoard(boardId, name)}
                  onDeleteBoard={(boardId) => void deleteBoard(boardId)}
                  onDuplicateBoard={(boardId) => void duplicateBoard(boardId)}
                  onSetDefaultBoard={(boardId) => void setDefaultBoard(boardId)}
                />
              )}
              {leftPanelTab === 'assets' && (
                <CanvasAssetsPanel
                  assets={snapshot.assets}
                  referencedAssetIds={referencedAssetIds}
                  onInsertAsset={(assetId) => void handleInsertAsset(assetId)}
                  onLocateAsset={handleLocateAsset}
                  onDownloadAsset={(asset) => downloadAsset(asset)}
                />
              )}
              {leftPanelTab === 'asset_manager' && (
                <CanvasAssetManagerPanel
                  assets={snapshot.assets}
                  nodes={snapshot.nodes}
                  tasks={snapshot.tasks}
                  onInsertAssets={(assetIds) => {
                    for (const assetId of assetIds) void handleInsertAsset(assetId)
                  }}
                  onRemoveReferences={async (assetIds) => {
                    // 移除引用 = 删除引用这些资产的节点（不删资产文件，文档 §11.3 两段式）
                    const targetAssetSet = new Set(assetIds)
                    const nodeIds = snapshot.nodes
                      .filter((node) => node.assetId && targetAssetSet.has(node.assetId))
                      .map((node) => node.id)
                    if (nodeIds.length > 0) {
                      await deleteNodes(nodeIds)
                    }
                  }}
                />
              )}
            </div>
          )}
          {!leftPanelCollapsed && (
            <div className="canvas-left-workbench-footer">
              <button type="button" className="canvas-left-utility-btn" onClick={() => setHistoryOpen(true)}>
                <Icons.Clock size={16} />
                <span>历史</span>
              </button>
              <button type="button" className="canvas-left-utility-btn" onClick={() => void handleOpenProjectFolder()}>
                <Icons.Folder size={16} />
                <span>目录</span>
              </button>
              <button type="button" className="canvas-left-utility-btn" onClick={() => setTemplateOpen(true)}>
                <Icons.Layers size={16} />
                <span>模板</span>
              </button>
              <button type="button" className="canvas-left-utility-btn" onClick={() => message.info('帮助与快捷键')}>
                <Icons.HelpCircle size={16} />
                <span>帮助</span>
              </button>
            </div>
          )}
        </aside>

        <div className="canvas-stage-area">
        {toolSwitchHint && (
          <div
            key={toolSwitchHint.nonce}
            className={`canvas-tool-switch-hint canvas-tool-switch-hint-${toolSwitchHint.tool}`}
            role="status"
            aria-live="polite"
          >
            <span className="canvas-tool-switch-key">Tab</span>
            <span>已切换为 {toolLabel(toolSwitchHint.tool)}</span>
          </div>
        )}
        <CanvasStage
          snapshot={snapshot}
          activeTool={activeTool === 'pan' ? 'pan' : 'select'}
          selectedNodeIds={selectedNodeIds}
          onSelectionChange={handleSelectionChange}
          onNodesPersist={(nodes) => void updateNodes(nodes)}
          onConnectNodes={(input) => void connectNodes(input)}
          onDuplicateNode={handleDuplicateNode}
          onDeleteNode={handleDeleteNode}
          onToggleLockNode={handleToggleLockNode}
          onBringNodeToFront={handleBringNodeToFront}
          onCreateGroupFromSelection={handleCreateGroup}
          onAddSelectionToGroup={handleAddSelectionToGroup}
          onRemoveNodeFromGroup={(nodeId) => handleRemoveFromGroup([nodeId])}
          onDissolveGroup={handleDissolveGroup}
          onOpenAiComposer={handleOpenInlineAi}
          onEditNode={handleEditNode}
          onAddTextAtPosition={(position) => void addText(position)}
          onAddImageAtPosition={uploadFirstImage}
          onAddPromptAtPosition={(position) => void addText(position)}
          onInsertAssetFromPane={() => setLeftPanelTab('assets')}
          onCreateBoardFromPane={() => void createBoard()}
          onResetZoomFromPane={handleResetZoom}
          onViewportChange={handleCanvasViewportChange}
        />
        <CanvasBottomDock
          activeTool={activeTool}
          onToolChange={handleToolChange}
          onAddNodeItem={handleAddNodeItem}
          onOpenAiComposer={() => handleOpenInlineAi()}
          onFitView={handleFitView}
          onResetZoom={handleResetZoom}
          onToggleGrid={handleToggleGrid}
          gridVisible={snapshot.board.settings.grid !== false}
          collapsed={bottomToolbarCollapsed}
          onToggleCollapsed={() => setBottomToolbarCollapsed(!bottomToolbarCollapsed)}
        />
        <CanvasInlineAiComposer
          open={inlineAiOpen}
          selectedNodes={aiInputNodes}
          allNodes={snapshot.nodes}
          {...(snapshot.project.settings ? { projectSettings: snapshot.project.settings } : {})}
          onUploadImage={() => uploadFirstImage()}
          onClose={() => setInlineAiOpen(false)}
          onCreateTask={(input) => {
            void handleCreateTask(input)
            setInlineAiOpen(false)
          }}
        />
        </div>
        <aside className="canvas-side-panel" style={{ width: sidePanelWidth }}>
          <div
            aria-label="调整右侧面板宽度"
            aria-orientation="vertical"
            aria-valuemax={CANVAS_SIDE_PANEL_MAX_WIDTH}
            aria-valuemin={CANVAS_SIDE_PANEL_MIN_WIDTH}
            aria-valuenow={sidePanelWidth}
            className="canvas-side-panel-resize-handle"
            onDoubleClick={() => updateSidePanelWidth(CANVAS_SIDE_PANEL_DEFAULT_WIDTH)}
            onKeyDown={handleSidePanelResizeKeyDown}
            onPointerDown={handleSidePanelResizeStart}
            role="separator"
            tabIndex={0}
            title="拖拽调整面板宽度"
          />
          <div className="canvas-side-tabs">
            <Segmented
              value={sidePanelTab}
              onChange={(value) => setSidePanelTab(value as 'details' | 'project')}
              options={[
                { label: '属性', value: 'details' },
                { label: '项目信息', value: 'project' },
              ]}
            />
          </div>
          {sidePanelTab === 'details' ? (
            <div className="canvas-side-panel-content">
              <CanvasTaskQueue
                tasks={snapshot.tasks}
                nodes={snapshot.nodes}
                assets={snapshot.assets}
                onCompleteDemoTask={(taskId) => void completeDemoTask(taskId)}
                onCancelTask={(taskId) => void cancelTask(taskId)}
                onRetryTask={(task) => void handleRetryTask(task)}
                onSelectNode={(nodeId) => setSelectedNodeIds([nodeId])}
              />
              <CanvasInspector
                selectedNodes={selectedNodes}
                nodes={snapshot.nodes}
                edges={snapshot.edges}
                assets={snapshot.assets}
                tasks={snapshot.tasks}
                onDuplicate={() => void duplicateNodes(selectedNodeIds)}
                onToggleLock={() => void handleToggleLock()}
                onBringToFront={() => void handleBringToFront()}
                onCreateGroup={handleCreateGroup}
                onAddToGroup={() => handleAddSelectionToGroup()}
                onRemoveFromGroup={() => handleRemoveFromGroup()}
                onDissolveGroup={() => handleDissolveGroup()}
                canCreateGroup={canCreateGroup}
                canAddToGroup={canAddToGroup}
                canRemoveFromGroup={canRemoveFromGroup}
                canDissolveGroup={canDissolveGroup}
                onSaveText={(node, text) => {
                  void updateNodeData(node.id, { ...node.data, text })
                }}
                onPatchNode={(node, patch) => {
                  void patchNodes([node.id], patch)
                }}
              />
            </div>
          ) : (
            <CanvasProjectInfoPanel
              key={`${snapshot.project.id}:${snapshot.project.updatedAt}:project-info`}
              project={snapshot.project}
              onOpenProjectFolder={handleOpenProjectFolder}
              onSave={(settings) => updateProjectSettings(settings)}
            />
          )}
        </aside>
      </div>
      <CanvasAssetDrawer
        open={assetDrawerOpen}
        assets={snapshot.assets}
        onClose={() => setAssetDrawerOpen(false)}
      />
      <Drawer
        title="历史记录"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={360}
        styles={{ body: { padding: 0 } }}
      >
        <CanvasHistoryPanel
          assets={snapshot.assets}
          tasks={snapshot.tasks}
          onInsertAsset={(assetId) => void handleInsertAsset(assetId)}
          onLocateTaskNode={(taskId) => {
            const node = snapshot.nodes.find((n) => n.taskId === taskId)
            if (node) {
              setSelectedNodeIds([node.id])
              message.info(`已定位到任务节点：${node.title ?? node.type}`)
            }
          }}
          onRetryTask={(taskId) => {
            const task = snapshot.tasks.find((t) => t.id === taskId)
            if (task) void handleRetryTask(task)
          }}
        />
      </Drawer>
      <Drawer
        title="模板中心"
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        width={360}
        styles={{ body: { padding: 0 } }}
      >
        <CanvasTemplatePanel onApply={(template) => void handleApplyTemplate(template)} />
      </Drawer>
      <CanvasNodeEditModal
        node={editingNode}
        open={Boolean(editingNode)}
        onClose={() => setEditingNodeId(null)}
        onSave={handleSaveNodeEdit}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => void handleFileChange(event)}
      />
      <Modal
        open={leaveOpen}
        title="画布有未保存的改动"
        closable={false}
        maskClosable={false}
        footer={[
          <Button key="discard" danger onClick={onLeaveDiscard}>
            不保存
          </Button>,
          <Button key="cancel" onClick={onLeaveCancel}>
            取消
          </Button>,
          <Button key="save" type="primary" loading={saving} onClick={() => void onLeaveSave()}>
            保存并离开
          </Button>,
        ]}
      >
        离开前是否保存当前画布？未保存的改动不会写入应用数据库，离开后即丢失。
      </Modal>
    </div>
  )
}

function CanvasProjectInfoPanel({
  project,
  onOpenProjectFolder,
  onSave,
}: {
  project: CanvasProject
  onOpenProjectFolder: () => Promise<void>
  onSave: (settings: CanvasProjectSettings) => Promise<void>
}) {
  const [prompt, setPrompt] = useState(project.settings?.prompt ?? '')
  const [negativePrompt, setNegativePrompt] = useState(project.settings?.negativePrompt ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ prompt, negativePrompt })
      message.success('项目提示词已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存项目提示词失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="canvas-side-panel-content canvas-side-panel-content-project">
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>项目基础信息</h3>
          <Tag color={project.status === 'active' ? 'green' : 'default'} bordered>
            {project.status}
          </Tag>
        </div>
        <div className="canvas-project-info-grid">
          <CanvasProjectInfoItem label="项目名" value={project.title} />
          <CanvasProjectInfoItem label="节点" value={project.nodeCount} />
          <CanvasProjectInfoItem label="素材" value={project.assetCount} />
          <CanvasProjectInfoItem label="任务" value={project.taskCount} />
        </div>
        <div className="canvas-project-folder-card canvas-project-folder-card-inline">
          <div className="canvas-project-folder-info">
            <span>项目文件夹</span>
            <Tooltip title={project.rootPath || '默认位置'} placement="topLeft">
              <strong>{project.rootPath || '默认位置'}</strong>
            </Tooltip>
          </div>
          <Button
            size="small"
            icon={<Icons.Folder size={14} />}
            onClick={() => void onOpenProjectFolder()}
          >
            打开
          </Button>
        </div>
      </section>
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>AI 提示词设置</h3>
          <Tag color={prompt.trim() || negativePrompt.trim() ? 'blue' : 'default'} bordered>
            {prompt.trim() || negativePrompt.trim() ? '已配置' : '未配置'}
          </Tag>
        </div>
        <div className="canvas-form-row">
          <label>项目统一提示词</label>
          <Input.TextArea
            value={prompt}
            rows={6}
            placeholder="例如：统一品牌语气、画面风格、构图偏好、输出格式等"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className="canvas-form-row">
          <label>反向提示词</label>
          <Input.TextArea
            value={negativePrompt}
            rows={5}
            placeholder="例如：不要出现的元素、不能做的动作、需要规避的风格或内容"
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </div>
        <div className="canvas-project-prompt-actions">
          <Button
            size="small"
            onClick={() => {
              setPrompt(project.settings?.prompt ?? '')
              setNegativePrompt(project.settings?.negativePrompt ?? '')
            }}
          >
            重置
          </Button>
          <Button size="small" type="primary" loading={saving} onClick={() => void save()}>
            保存设置
          </Button>
        </div>
      </section>
    </div>
  )
}

function CanvasProjectInfoItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="canvas-project-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CanvasNodeEditModal({
  node,
  open,
  onClose,
  onSave,
}: {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [width, setWidth] = useState(280)
  const [height, setHeight] = useState(180)
  const [text, setText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messageText, setMessageText] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!node) return
    setSaving(false)
    setTitle(node.title ?? '')
    setX(Math.round(node.x))
    setY(Math.round(node.y))
    setWidth(Math.round(node.width))
    setHeight(Math.round(node.height))
    setText(node.data.text ?? '')
    setPrompt(node.data.prompt ?? '')
    setMessageText(node.data.message ?? '')
    setUrl(node.data.url ?? '')
  }, [node])

  const save = async () => {
    if (!node) return
    setSaving(true)
    try {
      const nextData: CanvasNode['data'] = { ...node.data }
      if (node.type === 'text' || node.type === 'prompt' || node.type === 'group') {
        nextData.text = text
      }
      if (node.type === 'task') {
        nextData.prompt = prompt
      }
      if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
        nextData.url = url.trim()
      }
      if (node.type !== 'text' && node.type !== 'prompt') {
        nextData.message = messageText
      }

      await onSave(
        node,
        {
          title: title.trim().length > 0 ? title.trim() : null,
          x: Number.isFinite(x) ? x : node.x,
          y: Number.isFinite(y) ? y : node.y,
          width: Math.max(
            node.type === 'group' ? 320 : 120,
            Number.isFinite(width) ? width : node.width,
          ),
          height: Math.max(
            node.type === 'group' ? 200 : 96,
            Number.isFinite(height) ? height : node.height,
          ),
        },
        nextData,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存节点失败')
      setSaving(false)
    }
  }

  return (
    <Modal
      className="canvas-node-edit-modal"
      title="编辑节点"
      open={open}
      width={560}
      destroyOnHidden
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      onOk={() => void save()}
      onCancel={onClose}
    >
      {node && (
        <div className="canvas-node-edit-dialog">
          <div className="canvas-node-edit-dialog-head">
            <Tag color="default" bordered>
              {node.type}
            </Tag>
            <span>{node.id}</span>
          </div>
          <label className="canvas-node-edit-field canvas-node-edit-field-wide">
            <span>标题</span>
            <Input
              value={title}
              placeholder="节点标题"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="canvas-node-edit-grid">
            <NodeEditNumberField label="X" value={x} onChange={setX} />
            <NodeEditNumberField label="Y" value={y} onChange={setY} />
            <NodeEditNumberField label="宽" value={width} min={120} onChange={setWidth} />
            <NodeEditNumberField label="高" value={height} min={96} onChange={setHeight} />
          </div>
          {(node.type === 'text' || node.type === 'prompt' || node.type === 'group') && (
            <label className="canvas-node-edit-field canvas-node-edit-field-wide">
              <span>{node.type === 'group' ? '组说明' : '内容'}</span>
              <Input.TextArea
                value={text}
                rows={node.type === 'group' ? 3 : 7}
                placeholder="输入节点内容"
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          )}
          {node.type === 'task' && (
            <label className="canvas-node-edit-field canvas-node-edit-field-wide">
              <span>任务指令</span>
              <Input.TextArea
                value={prompt}
                rows={4}
                placeholder="任务使用的 prompt"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
          )}
          {(node.type === 'image' || node.type === 'video' || node.type === 'audio') && (
            <label className="canvas-node-edit-field canvas-node-edit-field-wide">
              <span>媒体 URL</span>
              <Input
                value={url}
                placeholder="https:// 或 data: URL"
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          )}
          {node.type !== 'text' && node.type !== 'prompt' && (
            <label className="canvas-node-edit-field canvas-node-edit-field-wide">
              <span>备注 / 展示文本</span>
              <Input.TextArea
                value={messageText}
                rows={3}
                placeholder="节点内展示的辅助文本"
                onChange={(event) => setMessageText(event.target.value)}
              />
            </label>
          )}
        </div>
      )}
    </Modal>
  )
}

function NodeEditNumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string
  value: number
  min?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="canvas-node-edit-field">
      <span>{label}</span>
      <InputNumber
        value={value}
        step={1}
        controls={false}
        {...(min !== undefined ? { min } : {})}
        onChange={(next) => {
          if (typeof next === 'number') onChange(next)
        }}
      />
    </label>
  )
}
