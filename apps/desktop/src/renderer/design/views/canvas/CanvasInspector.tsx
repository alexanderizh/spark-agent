import { useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Descriptions, Empty, Input, InputNumber, Space } from 'antd'
import { TextArea as LobeTextArea } from '@lobehub/ui'
import type { CanvasAsset, CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'

export function CanvasInspector({
  selectedNodes,
  nodes,
  edges,
  assets,
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
  onPatchNode,
}: {
  selectedNodes: CanvasNode[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
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
  onPatchNode: (node: CanvasNode, patch: Partial<CanvasNode>) => void
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
    const summary = summarizeSelection(selectedNodes)
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
        <div className="canvas-inspector-summary-grid">
          <SummaryMetric label="节点" value={selectedNodes.length} />
          <SummaryMetric label="类型" value={summary.typeText} />
          <SummaryMetric label="宽高" value={`${summary.width} x ${summary.height}`} />
          <SummaryMetric label="锁定" value={summary.lockedCount} />
        </div>
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
  const asset = node.assetId ? assets.find((item) => item.id === node.assetId) : undefined
  const childNodes = node.type === 'group' ? nodes.filter((item) => item.parentNodeId === node.id) : []

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
      <NodeLayoutEditor
        key={`${node.id}:${node.updatedAt}:layout`}
        node={node}
        onPatchNode={onPatchNode}
      />
      {asset && (
        <AssetInspector asset={asset} />
      )}
      {node.type === 'group' && (
        <GroupInspector group={node} childNodes={childNodes} />
      )}
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

function NodeLayoutEditor({
  node,
  onPatchNode,
}: {
  node: CanvasNode
  onPatchNode: (node: CanvasNode, patch: Partial<CanvasNode>) => void
}) {
  const [title, setTitle] = useState(node.title ?? '')
  const [x, setX] = useState(Math.round(node.x))
  const [y, setY] = useState(Math.round(node.y))
  const [width, setWidth] = useState(Math.round(node.width))
  const [height, setHeight] = useState(Math.round(node.height))

  const saveLayout = () => {
    onPatchNode(node, {
      title: title.trim().length > 0 ? title.trim() : null,
      x: Number.isFinite(x) ? x : node.x,
      y: Number.isFinite(y) ? y : node.y,
      width: Math.max(80, Number.isFinite(width) ? width : node.width),
      height: Math.max(60, Number.isFinite(height) ? height : node.height),
    })
  }

  return (
    <div className="canvas-node-edit-panel">
      <div className="canvas-task-param-title">节点编辑</div>
      <div className="canvas-node-edit-grid">
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>标题</span>
          <Input size="small" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <NumberField label="X" value={x} onChange={setX} />
        <NumberField label="Y" value={y} onChange={setY} />
        <NumberField label="宽" value={width} min={80} onChange={setWidth} />
        <NumberField label="高" value={height} min={60} onChange={setHeight} />
      </div>
      <Button size="small" type="primary" onClick={saveLayout}>
        保存属性
      </Button>
    </div>
  )
}

function NumberField({
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
        size="small"
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

function AssetInspector({ asset }: { asset: CanvasAsset }) {
  return (
    <div className="canvas-task-param-panel">
      <div className="canvas-task-param-title">资产信息</div>
      <Descriptions
        className="canvas-inspector-desc"
        size="small"
        column={1}
        items={[
          { label: 'Asset ID', children: asset.id },
          { label: '来源', children: asset.source },
          { label: '类型', children: asset.type },
          { label: 'MIME', children: asset.mimeType ?? '-' },
          { label: '尺寸', children: asset.width && asset.height ? `${asset.width} x ${asset.height}` : '-' },
          { label: '时长', children: asset.durationMs ? `${Math.round(asset.durationMs / 1000)}s` : '-' },
          { label: '存储', children: asset.storageKey ?? '-' },
        ]}
      />
    </div>
  )
}

function GroupInspector({ group, childNodes }: { group: CanvasNode; childNodes: CanvasNode[] }) {
  const tallest = childNodes.reduce((max, node) => Math.max(max, Math.round(node.height)), 0)
  const widest = childNodes.reduce((max, node) => Math.max(max, Math.round(node.width)), 0)
  return (
    <div className="canvas-task-param-panel">
      <div className="canvas-task-param-title">组信息</div>
      <div className="canvas-inspector-summary-grid">
        <SummaryMetric label="成员" value={childNodes.length} />
        <SummaryMetric label="组宽" value={Math.round(group.width)} />
        <SummaryMetric label="组高" value={Math.round(group.height)} />
        <SummaryMetric label="最大节点" value={`${widest} x ${tallest}`} />
      </div>
    </div>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="canvas-inspector-summary-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
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

function summarizeSelection(nodes: CanvasNode[]) {
  const typeCounts = nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.type] = (acc[node.type] ?? 0) + 1
    return acc
  }, {})
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  return {
    typeText: Object.entries(typeCounts).map(([type, count]) => `${type} ${count}`).join(' / '),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
    lockedCount: nodes.filter((node) => node.locked).length,
  }
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
