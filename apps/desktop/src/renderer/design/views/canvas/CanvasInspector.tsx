import { useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Descriptions, Empty, Space } from 'antd'
import { TextArea as LobeTextArea } from '@lobehub/ui'
import type { CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'

export function CanvasInspector({
  selectedNodes,
  nodes,
  edges,
  tasks,
  onDuplicate,
  onToggleLock,
  onBringToFront,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onDissolveGroup,
  canCreateGroup,
  canAddToGroup,
  canRemoveFromGroup,
  canDissolveGroup,
  onSaveText,
}: {
  selectedNodes: CanvasNode[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  tasks: CanvasTask[]
  onDuplicate: () => void
  onToggleLock: () => void
  onBringToFront: () => void
  onCreateGroup: () => void
  onAddToGroup: () => void
  onRemoveFromGroup: () => void
  onDissolveGroup: () => void
  canCreateGroup: boolean
  canAddToGroup: boolean
  canRemoveFromGroup: boolean
  canDissolveGroup: boolean
  onSaveText: (node: CanvasNode, text: string) => void
}) {
  if (selectedNodes.length === 0) {
    return (
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>属性</h3>
          <Space size={6}>
            <Button size="small" disabled>
              复制
            </Button>
            <Button size="small" disabled>
              锁定
            </Button>
          </Space>
        </div>
        <Empty description="选择节点后查看属性" />
      </section>
    )
  }

  if (selectedNodes.length > 1) {
    return (
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>属性</h3>
          <Tag color="blue">
            {selectedNodes.length} selected
          </Tag>
        </div>
        <Space size={8} wrap>
          <Button
            size="small"
            disabled={!canCreateGroup && !canAddToGroup}
            onClick={canAddToGroup ? onAddToGroup : onCreateGroup}
          >
            {canAddToGroup ? '加入组' : '创建组'}
          </Button>
          <Button size="small" disabled={!canRemoveFromGroup} onClick={onRemoveFromGroup}>
            移出组
          </Button>
          <Button size="small" onClick={onDuplicate}>
            复制
          </Button>
          <Button size="small" onClick={onToggleLock}>
            锁定/解锁
          </Button>
          <Button size="small" onClick={onBringToFront}>
            置顶
          </Button>
        </Space>
        <div className="canvas-selection-list">
          {selectedNodes.map((node) => (
            <div key={node.id} className="canvas-selection-row">
              <span>{node.title ?? node.type}</span>
              <Tag color="default" bordered>
                {node.type}
              </Tag>
            </div>
          ))}
        </div>
      </section>
    )
  }

  const node = selectedNodes[0]
  if (node == null) return null
  const task = node.taskId ? tasks.find((item) => item.id === node.taskId) : undefined

  return (
    <section className="canvas-panel-section">
      <div className="canvas-panel-title-row">
        <h3>属性</h3>
        <Tag color="default" bordered>
          {node.type}
        </Tag>
      </div>
      <Descriptions
        className="canvas-inspector-desc"
        size="small"
        column={1}
        items={[
          { label: '标题', children: node.title ?? '-' },
          { label: '位置', children: `${Math.round(node.x)}, ${Math.round(node.y)}` },
          { label: '尺寸', children: `${Math.round(node.width)} x ${Math.round(node.height)}` },
          { label: '层级', children: String(node.zIndex) },
          { label: '锁定', children: node.locked ? '是' : '否' },
          { label: '资产', children: node.assetId ?? '-' },
          { label: '任务', children: node.taskId ?? '-' },
        ]}
      />
      <Space size={8} wrap>
        {node.type === 'group' && (
          <Button size="small" disabled={!canDissolveGroup} onClick={onDissolveGroup}>
            解散组
          </Button>
        )}
        {node.parentNodeId && (
          <Button size="small" disabled={!canRemoveFromGroup} onClick={onRemoveFromGroup}>
            移出组
          </Button>
        )}
        <Button size="small" onClick={onDuplicate}>
          复制
        </Button>
        <Button size="small" onClick={onToggleLock}>
          {node.locked ? '解锁' : '锁定'}
        </Button>
        <Button size="small" onClick={onBringToFront}>
          置顶
        </Button>
      </Space>
      {(node.type === 'text' || node.type === 'prompt') && (
        <TextNodeEditor key={`${node.id}:${node.updatedAt}`} node={node} onSaveText={onSaveText} />
      )}
      {task && (
        <TaskParamsInspector task={task} />
      )}
      <LineageInspector node={node} nodes={nodes} edges={edges} tasks={tasks} />
    </section>
  )
}

function LineageInspector({
  node,
  nodes,
  edges,
  tasks,
}: {
  node: CanvasNode
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  tasks: CanvasTask[]
}) {
  const relatedEdges = edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
  if (relatedEdges.length === 0) return null

  const nodeById = new Map(nodes.map((item) => [item.id, item]))
  const taskById = new Map(tasks.map((item) => [item.id, item]))
  const incoming = relatedEdges.filter((edge) => edge.targetNodeId === node.id)
  const outgoing = relatedEdges.filter((edge) => edge.sourceNodeId === node.id)

  return (
    <div className="canvas-lineage-panel">
      <div className="canvas-task-param-title">流程血缘</div>
      <div className="canvas-lineage-summary">
        <Tag color="blue" bordered>
          输入 {incoming.length}
        </Tag>
        <Tag color="green" bordered>
          输出 {outgoing.length}
        </Tag>
      </div>
      <div className="canvas-lineage-list">
        {relatedEdges.slice(0, 10).map((edge) => {
          const peerId = edge.sourceNodeId === node.id ? edge.targetNodeId : edge.sourceNodeId
          const peer = nodeById.get(peerId)
          const task = edge.taskId ? taskById.get(edge.taskId) : undefined
          const direction = edge.sourceNodeId === node.id ? '下游' : '上游'
          return (
            <div key={edge.id} className="canvas-lineage-row">
              <div className="canvas-lineage-row-main">
                <span>{direction}</span>
                <strong>{peer?.title ?? peer?.type ?? peerId}</strong>
              </div>
              <div className="canvas-lineage-row-meta">
                <Tag color={edge.type === 'generated' ? 'green' : edge.type === 'used_as_input' ? 'blue' : 'default'} bordered>
                  {edge.type}
                </Tag>
                {task ? <span>{task.title ?? task.operation}</span> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskParamsInspector({ task }: { task: CanvasTask }) {
  const entries = Object.entries(task.modelParams ?? {})
  return (
    <div className="canvas-task-param-panel">
      <div className="canvas-task-param-title">模型调用</div>
      <Descriptions
        className="canvas-inspector-desc"
        size="small"
        column={1}
        items={[
          { label: 'Provider', children: task.providerProfileId ?? '-' },
          { label: 'Manifest', children: task.manifestId ?? '-' },
          { label: '模型', children: task.modelId ?? '-' },
          { label: '状态', children: task.status },
          { label: 'Request', children: task.requestId ?? '-' },
        ]}
      />
      {entries.length > 0 && (
        <div className="canvas-task-param-list">
          {entries.map(([key, value]) => (
            <div key={key} className="canvas-task-param-row">
              <span>{key}</span>
              <code>{formatParamValue(value)}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatParamValue(value: unknown): string {
  if (value == null) return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function TextNodeEditor({
  node,
  onSaveText,
}: {
  node: CanvasNode
  onSaveText: (node: CanvasNode, text: string) => void
}) {
  const [textDraft, setTextDraft] = useState(node.data.text ?? '')

  return (
    <div className="canvas-form-row">
      <label>内容</label>
      <LobeTextArea
        value={textDraft}
        rows={5}
        onChange={(e) => setTextDraft(e.target.value)}
      />
      <Button size="small" type="primary" onClick={() => onSaveText(node, textDraft)}>
        保存文本
      </Button>
    </div>
  )
}
