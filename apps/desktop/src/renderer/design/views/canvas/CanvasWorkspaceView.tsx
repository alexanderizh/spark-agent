import { useCallback, useMemo, useRef, useState } from 'react'
import { Button, Empty, Tag } from '@lobehub/ui'
import { Spin, message } from 'antd'
import { Icons } from '../../Icons'
import { MacWindowDragHeader } from '../../components/MacWindowDragHeader'
import { CanvasAssetDrawer } from './CanvasAssetDrawer'
import { CanvasInlineAiComposer } from './CanvasInlineAiComposer'
import { CanvasInspector } from './CanvasInspector'
import { CanvasStage, type CanvasStageViewport } from './CanvasStage'
import { CanvasTaskQueue } from './CanvasTaskQueue'
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar'
import { useCanvasWorkspace } from './canvas.store'
import type { CanvasNode, CanvasOperationType, CanvasTask } from './canvas.types'
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

function buildTaskInputFiles(nodes: CanvasNode[]) {
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

function areNodeIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
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
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false)
  const [inlineAiOpen, setInlineAiOpen] = useState(false)
  const [canvasViewport, setCanvasViewport] = useState<CanvasStageViewport | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedNodes = useMemo(
    () => snapshot?.nodes.filter((node) => selectedNodeIds.includes(node.id)) ?? [],
    [selectedNodeIds, snapshot?.nodes],
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
  }: {
    operation: CanvasOperationType
    prompt: string
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    modelParams?: Record<string, unknown>
  }) => {
    // 从选中节点派生输入文件（图生图 / 图生视频 / 语音转写 等需要参考输入）
    const inputFiles = buildTaskInputFiles(selectedNodes)

    await createTask({
      operation,
      prompt,
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
    const inputNodes = snapshot.nodes.filter((node) => task.inputNodeIds.includes(node.id))
    const taskNode = snapshot.nodes.find((node) => node.taskId === task.id)
    const inputFiles = buildTaskInputFiles(inputNodes)
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
          onToolChange={setActiveTool}
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
          />
        </aside>
      </div>
      <CanvasAssetDrawer
        open={assetDrawerOpen}
        assets={snapshot.assets}
        onClose={() => setAssetDrawerOpen(false)}
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
