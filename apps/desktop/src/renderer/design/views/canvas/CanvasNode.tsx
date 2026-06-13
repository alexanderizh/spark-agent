import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Dropdown, Menu, Progress, Tag } from '@arco-design/web-react'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
  actions: {
    duplicateNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => void
    toggleLockNode: (nodeId: string) => void
    bringNodeToFront: (nodeId: string) => void
  }
}

const typeColor: Record<SparkCanvasNode['type'], string> = {
  image: 'arcoblue',
  video: 'purple',
  text: 'gray',
  prompt: 'orange',
  task: 'green',
  group: 'gray',
}

export const CanvasNode = memo(function CanvasNode({ data, selected }: NodeProps) {
  const { actions, canvasNode: node } = data as CanvasFlowNodeData
  const title = node.title ?? node.type
  const locked = Boolean(node.locked)

  const menu = (
    <Menu className="canvas-node-context-menu">
      <Menu.Item key="duplicate" onClick={() => actions.duplicateNode(node.id)}>
        <span className="canvas-menu-item">
          <Icons.Copy size={14} />
          复制节点
        </span>
      </Menu.Item>
      <Menu.Item key="lock" onClick={() => actions.toggleLockNode(node.id)}>
        <span className="canvas-menu-item">
          <Icons.Lock size={14} />
          {locked ? '解锁节点' : '锁定节点'}
        </span>
      </Menu.Item>
      <Menu.Item key="front" onClick={() => actions.bringNodeToFront(node.id)}>
        <span className="canvas-menu-item">
          <Icons.Layers size={14} />
          置于顶层
        </span>
      </Menu.Item>
      <Menu.Item key="delete" onClick={() => actions.deleteNode(node.id)}>
        <span className="canvas-menu-item canvas-menu-item-danger">
          <Icons.Trash size={14} />
          删除节点
        </span>
      </Menu.Item>
    </Menu>
  )

  return (
    <Dropdown trigger="contextMenu" droplist={menu} position="bl">
      <div
        className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}`}
      >
        <NodeResizer
          color="var(--primary)"
          isVisible={selected && !locked}
          minWidth={180}
          minHeight={112}
          handleClassName="canvas-node-resize-handle"
          lineClassName="canvas-node-resize-line"
        />
        <Handle type="target" position={Position.Left} className="canvas-node-handle" />
        <div className="canvas-node-head">
          <div className="canvas-node-title">
            {node.type === 'image' && <Icons.Image size={14} />}
            {node.type === 'text' && <Icons.File size={14} />}
            {node.type === 'prompt' && <Icons.Sparkles size={14} />}
            {node.type === 'task' && <Icons.Activity size={14} />}
            {node.type === 'video' && <Icons.Play size={14} />}
            <span>{title}</span>
          </div>
          <Tag size="small" color={typeColor[node.type]} bordered>
            {node.type}
          </Tag>
        </div>

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
        ) : node.type === 'task' ? (
          <div className="canvas-node-task">
            <div className="canvas-node-task-row">
              <span>{node.data.operation ? operationLabel(node.data.operation) : 'AI task'}</span>
              <span>{node.data.status ?? 'pending'}</span>
            </div>
            <Progress
              percent={node.data.progress ?? 0}
              size="small"
              showText={false}
              status={
                node.data.status === 'failed'
                  ? 'error'
                  : node.data.status === 'completed'
                    ? 'success'
                    : 'normal'
              }
            />
            <div className="canvas-node-task-msg">
              {node.data.message ?? node.data.prompt ?? '准备执行'}
            </div>
          </div>
        ) : (
          <div className="canvas-node-text">{node.data.text ?? node.data.message ?? 'Empty'}</div>
        )}
        <Handle type="source" position={Position.Right} className="canvas-node-handle" />
      </div>
    </Dropdown>
  )
})
