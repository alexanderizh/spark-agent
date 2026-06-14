import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Tag } from '@lobehub/ui'
import { Input, InputNumber, Modal, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import { MacWindowDragHeader } from '../../components/MacWindowDragHeader'
import { CanvasAssetDrawer } from './CanvasAssetDrawer'
import { CanvasInlineAiComposer } from './CanvasInlineAiComposer'
import { CanvasInspector } from './CanvasInspector'
import { CanvasStage, type CanvasStageViewport } from './CanvasStage'
import { CanvasTaskQueue } from './CanvasTaskQueue'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import { useCanvasWorkspace } from './canvas.store'
import type { CanvasInputTransport, CanvasNode, CanvasOperationType, CanvasTask } from './canvas.types'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import './CanvasWorkspaceView.less'

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
    image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
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

function clampPosition(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function positionNodeInViewport(
  viewport: CanvasStageViewport | null,
  size: { width: number; height: number },
  fallback: { x: number; y: number },
  offset = 0,
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
      clampPosition(centerX - size.width / 2 + offset, visibleLeft + 24, visibleRight - size.width - 24),
    ),
    y: Math.round(
      clampPosition(centerY - size.height / 2 + offset, visibleTop + 24, visibleBottom - size.height - 24),
    ),
  }
}

function buildTaskInputFiles(nodes: CanvasNode[]): CanvasMediaTaskInputFile[] {
  return nodes
    .map((node) => {
      if (!node.data.url) return null
      const type =
        node.type === 'image' ? 'image' as const
          : node.type === 'audio' ? 'audio' as const
            : node.type === 'video' ? 'video' as const
              : 'file' as const
      return {
        type,
        ...(node.data.url.startsWith('data:') ? { dataUrl: node.data.url } : { url: node.data.url }),
        ...(node.data.mimeType ? { mimeType: node.data.mimeType } : {}),
      }
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)
}

async function buildCloudTaskInputFiles(
  nodes: CanvasNode[],
  inputTransport: CanvasInputTransport | undefined,
): Promise<CanvasMediaTaskInputFile[]> {
  const files = buildTaskInputFiles(nodes)
  if (files.length === 0) return files
  if (inputTransport === 'base64') {
    return Promise.all(files.map(async (file) => {
      if (file.type !== 'image' || file.dataUrl || !file.url?.startsWith('safe-file://')) return file
      return {
        ...file,
        dataUrl: await readUrlAsDataUrl(file.url),
      }
    }))
  }
  if (inputTransport !== 'cloud_url') return files
  return Promise.all(files.map(async (file, index) => {
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
      url: uploaded.aiUrl,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    }
  }))
}

function readUrlAsDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((response) => response.blob())
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.readAsDataURL(blob)
    }))
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

function fallbackPromptForOperation(operation: CanvasOperationType): string {
  if (operation === 'image_edit') return '请基于输入图片进行自然编辑，保持主体与画面质量。'
  if (operation === 'image_to_image') return '请基于输入图片生成一个高质量变体。'
  if (operation === 'image_compose') return '请将输入图片自然合成为一张高质量图片。'
  if (operation === 'image_to_video') return '请基于输入图片生成一段自然流畅的视频。'
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
    Boolean(target.closest('[contenteditable="true"], .canvas-inline-ai-composer, .ant-modal, .ant-drawer'))
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
    createTask,
    completeDemoTask,
    cancelTask,
  } = useCanvasWorkspace(projectId)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')
  const [toolSwitchHint, setToolSwitchHint] = useState<{ tool: CanvasTool; nonce: number } | null>(null)
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false)
  const [inlineAiOpen, setInlineAiOpen] = useState(false)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [canvasViewport, setCanvasViewport] = useState<CanvasStageViewport | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeToolRef = useRef<CanvasTool>('select')

  const selectedNodes = useMemo(
    () => snapshot?.nodes.filter((node) => selectedNodeIds.includes(node.id)) ?? [],
    [selectedNodeIds, snapshot?.nodes],
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
  const canCreateGroup = selectedNodes.length >= 2 && selectedNodes.every(
    (node) => node.type !== 'group' && !node.parentNodeId,
  )
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
      if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
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
      void addNodesToGroup(targetGroupId, selectedTopLevelNodes.map((node) => node.id))
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

  const addText = async (isPrompt = false) => {
    const position = positionNodeInViewport(
      canvasViewport,
      { width: 280, height: 164 },
      {
        x: 140 + snapshot.nodes.length * 24,
        y: 120 + snapshot.nodes.length * 24,
      },
      (snapshot.nodes.length % 6) * 18,
    )
    await createTextNode({
      text: isPrompt
        ? '描述你想生成的画面、风格、主体、限制条件...'
        : '双击后续版本可直接编辑文本内容。',
      isPrompt,
      x: position.x,
      y: position.y,
    })
  }

  const uploadFirstImage = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      message.warning('请选择图片文件')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    const dimensions = await readImageDimensions(dataUrl)
    const nodeSize = fitImageNodeSize(dimensions.width, dimensions.height)
    const position = positionNodeInViewport(
      canvasViewport,
      nodeSize,
      {
        x: 220 + snapshot.nodes.length * 24,
        y: 180 + snapshot.nodes.length * 24,
      },
      (snapshot.nodes.length % 6) * 18,
    )
    await createImageNode({
      file,
      dataUrl,
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    })
  }

  const handleCreateTask = async ({
    operation,
    prompt,
    providerProfileId,
    manifestId,
    modelId,
    modelParams,
    inputTransport,
  }: {
    operation: CanvasOperationType
    prompt: string
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    modelParams?: Record<string, unknown>
    inputTransport?: CanvasInputTransport
  }) => {
    if (!(await ensureCanvasWorkflowLogin())) return
    // 从选中节点派生输入文件（图生图 / 图生视频 / 语音转写 等需要参考输入）
    const inputFiles = await buildCloudTaskInputFiles(selectedNodes, inputTransport)
    const mergedPrompt = mergePromptWithNodeContext(prompt, selectedNodes)
    const effectivePrompt = mergedPrompt || (inputFiles.length > 0 ? fallbackPromptForOperation(operation) : '')

    await createTask({
      operation,
      prompt: effectivePrompt,
      inputNodeIds: selectedNodeIds,
      inputAssetIds: selectedNodes
        .map((node) => node.assetId)
        .filter((id): id is string => Boolean(id)),
      ...(inputFiles.length > 0 ? { inputFiles } : {}),
      ...(providerProfileId != null ? { providerProfileId } : {}),
      ...(manifestId != null ? { manifestId } : {}),
      ...(modelId != null ? { modelId } : {}),
      ...(modelParams != null ? { modelParams } : {}),
      outputPlacement: {
        x: selectedNodes[0] ? selectedNodes[0].x + 360 : 360,
        y: selectedNodes[0] ? selectedNodes[0].y + 80 : 260,
      },
    })
  }

  const handleRetryTask = async (task: CanvasTask) => {
    if (!(await ensureCanvasWorkflowLogin())) return
    const inputNodes = snapshot.nodes.filter((node) => task.inputNodeIds.includes(node.id))
    const taskNode = snapshot.nodes.find((node) => node.taskId === task.id)
    const inputFiles = await buildCloudTaskInputFiles(inputNodes, task.provider === 'xai' ? 'base64' : 'cloud_url')
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
        x: taskNode ? taskNode.x + 360 : 360,
        y: taskNode ? taskNode.y + 48 : 260,
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

  return (
    <div className="canvas-workspace">
      <MacWindowDragHeader />
      <header className="canvas-workspace-header">
        <div className="canvas-workspace-topbar">
          <div className="canvas-workspace-title">
            <Button size="small" type="text" icon={<Icons.ArrowLeft size={15} />} onClick={onBack}>
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
          <div className="canvas-workspace-actions">
            <Tag color="green">
              Local draft
            </Tag>
            <Button
              size="small"
              icon={<Icons.Package size={15} />}
              onClick={() => setAssetDrawerOpen(true)}
            >
              资产
            </Button>
            <Button size="small" icon={<Icons.Download size={15} />}>
              导出
            </Button>
          </div>
        </div>
        <CanvasToolbar
          activeTool={activeTool}
          onToolChange={handleToolChange}
          onAddText={() => void addText(false)}
          onAddPrompt={() => void addText(true)}
          onUploadImage={uploadFirstImage}
          onCreateGroup={handleCreateGroup}
          onAddToGroup={() => handleAddSelectionToGroup()}
          onRemoveFromGroup={() => handleRemoveFromGroup()}
          onDissolveGroup={() => handleDissolveGroup()}
          onOpenAiComposer={() => handleOpenInlineAi()}
          onDeleteSelected={() => void deleteNodes(selectedNodeIds)}
          selectedCount={selectedNodeIds.length}
          canCreateGroup={canCreateGroup}
          canAddToGroup={canAddToGroup}
          canRemoveFromGroup={canRemoveFromGroup}
          canDissolveGroup={canDissolveGroup}
        />
      </header>

      <div className="canvas-workspace-body">
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
          onViewportChange={setCanvasViewport}
        />
        <CanvasInlineAiComposer
          open={inlineAiOpen}
          selectedNodes={selectedNodes}
          onClose={() => setInlineAiOpen(false)}
          onCreateTask={(input) => {
            void handleCreateTask(input)
            setInlineAiOpen(false)
          }}
        />
        <aside className="canvas-side-panel">
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
        </aside>
      </div>
      <CanvasAssetDrawer
        open={assetDrawerOpen}
        assets={snapshot.assets}
        onClose={() => setAssetDrawerOpen(false)}
      />
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
        style={{ display: 'none' }}
        onChange={(event) => void handleFileChange(event)}
      />
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
          width: Math.max(node.type === 'group' ? 320 : 120, Number.isFinite(width) ? width : node.width),
          height: Math.max(node.type === 'group' ? 200 : 96, Number.isFinite(height) ? height : node.height),
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
            <Input value={title} placeholder="节点标题" onChange={(event) => setTitle(event.target.value)} />
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
              <Input value={url} placeholder="https:// 或 data: URL" onChange={(event) => setUrl(event.target.value)} />
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
