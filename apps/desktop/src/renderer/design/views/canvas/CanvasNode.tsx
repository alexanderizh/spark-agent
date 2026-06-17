import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Progress } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import { isOperationNode, nodeOperation } from './canvas.capabilities'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'
import type { CanvasOperationType } from './canvas.types'

/** 操作节点图标：按 operation 类型映射 */
function operationNodeIcon(operation: CanvasOperationType | null): React.ReactNode {
  if (!operation) return <Icons.Sparkles size={13} />
  if (operation.startsWith('text_to_image') || operation === 'image_to_image' || operation === 'image_edit' || operation === 'image_compose') {
    return <Icons.Image size={13} />
  }
  if (operation.includes('video')) {
    return <Icons.Play size={13} />
  }
  if (operation.includes('audio')) {
    return <Icons.File size={13} />
  }
  return <Icons.Sparkles size={13} />
}

function operationStatusLabel(status: SparkCanvasNode['data']['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
  lineage?: {
    incoming: number
    outgoing: number
    generated: number
    usedAsInput: number
  }
  selectedCount: number
  actions: {
    duplicateNode: (nodeId: string) => void
    editNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => void
    toggleLockNode: (nodeId: string) => void
    bringNodeToFront: (nodeId: string) => void
    createGroupFromSelection: () => void
    addSelectionToGroup: (groupId: string) => void
    removeNodeFromGroup: (nodeId: string) => void
    dissolveGroup: (groupId: string) => void
    openAiComposer: (nodeId: string) => void
    saveToLibrary: (nodeId: string) => void
    createOperationChild: (parentId: string, operation: import("./canvas.types").CanvasOperationType) => void
  }
}

const typeColor: Record<SparkCanvasNode['type'], string> = {
  image: 'blue',
  audio: 'cyan',
  video: 'purple',
  text: 'default',
  prompt: 'orange',
  task: 'green',
  group: 'default',
  // 类型化 AI 操作节点（文档 §7.10 升级：每个 operation 一个独立 node type）
  text_to_image: 'green',
  image_to_image: 'green',
  image_edit: 'green',
  image_compose: 'green',
  text_generate: 'green',
  text_rewrite: 'green',
  prompt_optimize: 'green',
  text_to_video: 'green',
  image_to_video: 'green',
  video_edit: 'green',
  text_to_audio: 'green',
  audio_transcribe: 'green',
}

export const CanvasNode = memo(function CanvasNode({ data, selected }: NodeProps) {
  const { actions, canvasNode: node, lineage, selectedCount } = data as CanvasFlowNodeData
  const displayType = node.type === 'prompt' ? 'text' : node.type
  const title = node.type === 'prompt' && (!node.title || node.title === 'Prompt')
    ? 'Text note'
    : node.title ?? displayType
  const locked = Boolean(node.locked)
  const isGroup = node.type === 'group'
  const isTask = isOperationNode(node)
  const isGroupedChild = Boolean(node.parentNodeId)
  const hasLineage = Boolean(lineage && (lineage.incoming > 0 || lineage.outgoing > 0))
  const imageSrc = node.data.thumbnailUrl ?? node.data.url
  const normalizedImageSrc = imageSrc ? normalizeEduAssetUrl(imageSrc) : ''
  const normalizedAudioSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''
  const normalizedVideoSrc = node.data.url ? normalizeEduAssetUrl(node.data.url) : ''

  const menu = {
    className: 'canvas-node-context-menu',
    items: [
      ...(isTask
        ? [
            // 任务节点专用菜单（文档 §7.6）：基于输入重新运行 / AI 操作
            { type: 'divider' as const },
            { key: 'rerun', label: (<span className="canvas-menu-item"><Icons.Sparkles size={14} /> 基于输入重新运行</span>), onClick: () => actions.openAiComposer(node.id) },
            { type: 'divider' as const },
          ]
        : []),
      { key: 'duplicate', label: (<span className="canvas-menu-item"><Icons.Copy size={14} /> 复制节点</span>), onClick: () => actions.duplicateNode(node.id) },
      { key: 'edit', label: (<span className="canvas-menu-item"><Icons.Edit size={14} /> 编辑节点</span>), onClick: () => actions.editNode(node.id) },
      ...(isTask
        ? []
        : [{ key: 'ai', label: (<span className="canvas-menu-item"><Icons.Sparkles size={14} /> AI 操作</span>), onClick: () => actions.openAiComposer(node.id) }]),
      ...(isTask ? [] : [{ key: 'add-operation', label: (<span className="canvas-menu-item"><Icons.Plus size={14} /> 新增 AI 操作 ▸</span>), children: [
        { key: 'op-text_to_image', label: '文生图', onClick: () => actions.createOperationChild(node.id, 'text_to_image') },
        { key: 'op-image_edit', label: '图生图', onClick: () => actions.createOperationChild(node.id, 'image_edit') },
        { key: 'op-image_compose', label: '多图合成', onClick: () => actions.createOperationChild(node.id, 'image_compose') },
        { key: 'op-text_generate', label: '文本生成', onClick: () => actions.createOperationChild(node.id, 'text_generate') },
        { key: 'op-text_rewrite', label: '文本改写', onClick: () => actions.createOperationChild(node.id, 'text_rewrite') },
        { key: 'op-prompt_optimize', label: 'Prompt 优化', onClick: () => actions.createOperationChild(node.id, 'prompt_optimize') },
        { key: 'op-text_to_video', label: '文生视频', onClick: () => actions.createOperationChild(node.id, 'text_to_video') },
        { key: 'op-image_to_video', label: '图生视频', onClick: () => actions.createOperationChild(node.id, 'image_to_video') },
        { key: 'op-text_to_audio', label: '文生音频', onClick: () => actions.createOperationChild(node.id, 'text_to_audio') },
        { key: 'op-audio_transcribe', label: '语音转写', onClick: () => actions.createOperationChild(node.id, 'audio_transcribe') },
      ] }]),
      ...(isTask ? [] : [{ key: 'group', disabled: selectedCount < 2, label: (<span className="canvas-menu-item"><Icons.Layers size={14} /> 创建组</span>), onClick: () => actions.createGroupFromSelection() }]),
      { key: 'save-to-library', label: (<span className="canvas-menu-item"><Icons.Folder size={14} /> 保存到资源库…</span>), onClick: () => actions.saveToLibrary(node.id) },
      ...(isGroup
        ? [
            { key: 'add-to-group', disabled: selectedCount < 2, label: (<span className="canvas-menu-item"><Icons.Plus size={14} /> 加入选中节点</span>), onClick: () => actions.addSelectionToGroup(node.id) },
            { key: 'dissolve-group', label: (<span className="canvas-menu-item"><Icons.FolderOpen size={14} /> 解散组</span>), onClick: () => actions.dissolveGroup(node.id) },
          ]
        : []),
      ...(isGroupedChild
        ? [
            { key: 'remove-from-group', label: (<span className="canvas-menu-item"><Icons.ArrowUp size={14} /> 移出组</span>), onClick: () => actions.removeNodeFromGroup(node.id) },
          ]
        : []),
      { key: 'lock', label: (<span className="canvas-menu-item"><Icons.Lock size={14} /> {locked ? '解锁节点' : '锁定节点'}</span>), onClick: () => actions.toggleLockNode(node.id) },
      { key: 'front', label: (<span className="canvas-menu-item"><Icons.Layers size={14} /> 置于顶层</span>), onClick: () => actions.bringNodeToFront(node.id) },
      { key: 'delete', label: (<span className="canvas-menu-item canvas-menu-item-danger"><Icons.Trash size={14} /> 删除节点</span>), onClick: () => actions.deleteNode(node.id) },
    ],
  }

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft">
      <div
        className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}`}
        onDoubleClick={(event) => {
          event.stopPropagation()
          actions.editNode(node.id)
        }}
      >
        <NodeResizer
          color="var(--primary)"
          isVisible={selected && !locked}
          minWidth={isGroup ? 320 : 180}
          minHeight={isGroup ? 200 : 112}
          handleClassName="canvas-node-resize-handle"
          lineClassName="canvas-node-resize-line"
        />
        <Handle type="target" position={Position.Left} className="canvas-node-handle" />
        <div className="canvas-node-head">
          <div className="canvas-node-title">
            {node.type === 'image' && <Icons.Image size={14} />}
            {node.type === 'audio' && <Icons.Play size={14} />}
            {(node.type === 'text' || node.type === 'prompt') && <Icons.File size={14} />}
            {isOperationNode(node) ? (
              operationNodeIcon(nodeOperation(node))
            ) : node.type === 'task' ? (
              <Icons.Activity size={14} />
            ) : null}
            {node.type === 'video' && <Icons.Play size={14} />}
            {node.type === 'group' && <Icons.Layers size={14} />}
            <span>{title}</span>
          </div>
          <div className="canvas-node-head-actions">
            <Tooltip title="基于此节点继续 AI 操作">
              <button
                type="button"
                className="canvas-node-ai-action nodrag nopan"
                aria-label="基于此节点继续 AI 操作"
                onClick={(event) => {
                  event.stopPropagation()
                  actions.openAiComposer(node.id)
                }}
              >
                <Icons.Sparkles size={13} />
              </button>
            </Tooltip>
            {(node.type === 'text' || node.type === 'prompt') && (
              <Tooltip title="编辑文本 / Prompt">
                <button
                  type="button"
                  className="canvas-node-ai-action nodrag nopan"
                  aria-label="编辑文本 / Prompt"
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.editNode(node.id)
                  }}
                >
                  <Icons.Edit size={13} />
                </button>
              </Tooltip>
            )}
            <Tag color={typeColor[node.type]} bordered>
              {displayType}
            </Tag>
          </div>
        </div>

        {hasLineage && (
          <div className="canvas-node-lineage-strip">
            <span>
              <Icons.ArrowDown size={12} />
              {lineage?.incoming ?? 0}
            </span>
            <span>
              <Icons.ArrowUp size={12} />
              {lineage?.outgoing ?? 0}
            </span>
            {lineage?.generated ? (
              <span>
                <Icons.GitBranch size={12} />
                {lineage.generated}
              </span>
            ) : null}
          </div>
        )}

        <div className="canvas-node-body">
          {node.type === 'image' ? (
            node.data.url ? (
              <img
                className="canvas-node-image"
                src={normalizedImageSrc}
                alt={title}
              />
            ) : (
              <div className="canvas-node-image-placeholder">
                <Icons.Image size={30} />
                <span>{node.data.message ?? '等待图片 URL'}</span>
              </div>
            )
          ) : node.type === 'audio' ? (
            node.data.url ? (
              <div className="canvas-node-audio">
                <Icons.Play size={22} />
                <audio className="canvas-node-audio-player" src={normalizedAudioSrc} controls preload="metadata" />
                <span className="canvas-node-audio-name">{node.data.message ?? 'audio'}</span>
              </div>
            ) : (
              <div className="canvas-node-image-placeholder">
                <Icons.Play size={30} />
                <span>{node.data.message ?? '等待音频结果'}</span>
              </div>
            )
          ) : node.type === 'video' ? (
            node.data.url ? (
              <video className="canvas-node-image" src={normalizedVideoSrc} controls preload="metadata" />
            ) : (
              <div className="canvas-node-image-placeholder">
                <Icons.Play size={30} />
                <span>{node.data.message ?? '等待视频结果'}</span>
              </div>
            )
          ) : node.type === 'group' ? (
            <div className="canvas-node-group-body">
              <div className="canvas-node-group-count">{node.data.text ?? '组'}</div>
              <div className="canvas-node-group-hint">{node.data.message ?? '节点已在组内排列'}</div>
            </div>
          ) : isOperationNode(node) ? (
            <div className="canvas-node-task canvas-node-operation">
              <div className="canvas-node-task-row">
                <span className="canvas-node-operation-label">
                  {operationNodeIcon(nodeOperation(node))}
                  {nodeOperation(node) ? operationLabel(nodeOperation(node)!) : 'AI 任务'}
                </span>
                <Tag
                  color={
                    node.data.status === 'completed' ? 'green'
                      : node.data.status === 'failed' ? 'red'
                      : node.data.status === 'running' ? 'blue'
                      : 'default'
                  }
                  bordered
                >
                  {operationStatusLabel(node.data.status)}
                </Tag>
              </div>
              <Progress
                percent={node.data.progress ?? 0}
                size="small"
                status={
                  node.data.status === 'failed'
                    ? 'exception'
                    : node.data.status === 'completed'
                      ? 'success'
                      : 'active'
                }
              />
              <div className="canvas-node-task-msg">
                {node.data.message ?? node.data.prompt ?? '点击节点下方编辑面板调整参数后运行'}
              </div>
            </div>
          ) : (
            <div className="canvas-node-text">{node.data.text ?? node.data.message ?? 'Empty'}</div>
          )}
        </div>
        <Handle type="source" position={Position.Right} className="canvas-node-handle" />
      </div>
    </Dropdown>
  )
})
