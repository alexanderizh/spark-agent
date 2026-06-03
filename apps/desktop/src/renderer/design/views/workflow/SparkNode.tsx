import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getNodeKindMeta } from './node-kinds'
import type { SparkFlowNode } from './graph-adapter'

export function SparkNode({ data, selected }: NodeProps<SparkFlowNode>) {
  const meta = getNodeKindMeta(data.kind)
  const config = data.config
  const subline =
    typeof config.modelId === 'string' && config.modelId
      ? config.modelId
      : typeof config.role === 'string' && config.role
      ? config.role
      : meta.hint

  const promptPreview =
    typeof config.prompt === 'string' && config.prompt.trim().length > 0
      ? config.prompt.trim().slice(0, 60)
      : ''

  return (
    <div
      className={`spark-wf-node ${selected ? 'selected' : ''}`}
      style={{ ['--node-accent' as string]: `var(${meta.accent})` }}
    >
      <Handle type="target" position={Position.Left} className="spark-wf-handle" />
      <div className="spark-wf-node-head">
        <div className="spark-wf-node-icon">{meta.icon}</div>
        <div className="spark-wf-node-title">{data.title}</div>
        <span className="spark-wf-node-badge">{meta.label}</span>
      </div>
      <div className="spark-wf-node-sub">{subline}</div>
      {promptPreview && <div className="spark-wf-node-foot">{promptPreview}</div>}
      <Handle type="source" position={Position.Right} className="spark-wf-handle" />
    </div>
  )
}
