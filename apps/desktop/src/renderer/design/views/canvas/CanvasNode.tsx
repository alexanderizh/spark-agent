import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Progress, Tag } from '@arco-design/web-react'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'

export type CanvasFlowNodeData = {
  canvasNode: SparkCanvasNode
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
  const node = (data as CanvasFlowNodeData).canvasNode
  const title = node.title ?? node.type

  return (
    <div
      className={`canvas-node canvas-node-${node.type}${selected ? ' canvas-node-selected' : ''}`}
    >
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
  )
})
