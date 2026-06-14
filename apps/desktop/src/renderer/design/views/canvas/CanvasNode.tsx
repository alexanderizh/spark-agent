import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Progress } from 'antd'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'

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
    deleteNode: (nodeId: string) => void
    toggleLockNode: (nodeId: string) => void
    bringNodeToFront: (nodeId: string) => void
    createGroupFromSelection: () => void
    openAiComposer: (nodeId: string) => void
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
}

export const CanvasNode = memo(function CanvasNode({ data, selected }: NodeProps) {
  const { actions, canvasNode: node, lineage, selectedCount } = data as CanvasFlowNodeData
  const title = node.title ?? node.type
  const locked = Boolean(node.locked)
  const isGroup = node.type === 'group'
  const hasLineage = Boolean(lineage && (lineage.incoming > 0 || lineage.outgoing > 0))

  const menu = {
    className: 'canvas-node-context-menu',
    items: [
      { key: 'duplicate', label: (<span className="canvas-menu-item"><Icons.Copy size={14} /> 复制节点</span>), onClick: () => actions.duplicateNode(node.id) },
      { key: 'ai', label: (<span className="canvas-menu-item"><Icons.Sparkles size={14} /> AI 操作</span>), onClick: () => actions.openAiComposer(node.id) },
      { key: 'group', disabled: selectedCount < 2, label: (<span className="canvas-menu-item"><Icons.Layers size={14} /> 创建组</span>), onClick: () => actions.createGroupFromSelection() },
      { key: 'lock', label: (<span className="canvas-menu-item"><Icons.Lock size={14} /> {locked ? '解锁节点' : '锁定节点'}</span>), onClick: () => actions.toggleLockNode(node.id) },
      { key: 'front', label: (<span className="canvas-menu-item"><Icons.Layers size={14} /> 置于顶层</span>), onClick: () => actions.bringNodeToFront(node.id) },
      { key: 'delete', label: (<span className="canvas-menu-item canvas-menu-item-danger"><Icons.Trash size={14} /> 删除节点</span>), onClick: () => actions.deleteNode(node.id) },
    ],
  }

  return (
    <Dropdown trigger={['contextMenu']} menu={menu} placement="bottomLeft">
      <div
        className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}`}
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
            {node.type === 'text' && <Icons.File size={14} />}
            {node.type === 'prompt' && <Icons.Sparkles size={14} />}
            {node.type === 'task' && <Icons.Activity size={14} />}
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
            <Tag color={typeColor[node.type]} bordered>
              {node.type}
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
                src={node.data.thumbnailUrl ?? node.data.url}
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
                <audio className="canvas-node-audio-player" src={node.data.url} controls preload="metadata" />
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
              <video className="canvas-node-image" src={node.data.url} controls preload="metadata" />
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
          ) : node.type === 'task' ? (
            <div className="canvas-node-task">
              <div className="canvas-node-task-row">
                <span>{node.data.operation ? operationLabel(node.data.operation) : 'AI task'}</span>
                <span>{node.data.status ?? 'pending'}</span>
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
                {node.data.message ?? node.data.prompt ?? '准备执行'}
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
