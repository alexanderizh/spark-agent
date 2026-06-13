import { useState } from 'react'
import { Button, Descriptions, Empty, Space, Tag } from '@arco-design/web-react'
import { SparkTextarea } from '../../components/FormControls'
import type { CanvasNode } from './canvas.types'

export function CanvasInspector({
  selectedNodes,
  onDuplicate,
  onToggleLock,
  onBringToFront,
  onSaveText,
}: {
  selectedNodes: CanvasNode[]
  onDuplicate: () => void
  onToggleLock: () => void
  onBringToFront: () => void
  onSaveText: (node: CanvasNode, text: string) => void
}) {
  if (selectedNodes.length === 0) {
    return (
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>属性</h3>
          <Space size={6}>
            <Button size="mini" disabled>
              复制
            </Button>
            <Button size="mini" disabled>
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
          <Tag size="small" color="arcoblue">
            {selectedNodes.length} selected
          </Tag>
        </div>
        <Space size={8} wrap>
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
              <Tag size="small" color="gray" bordered>
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

  return (
    <section className="canvas-panel-section">
      <div className="canvas-panel-title-row">
        <h3>属性</h3>
        <Tag size="small" color="gray" bordered>
          {node.type}
        </Tag>
      </div>
      <Descriptions
        className="canvas-inspector-desc"
        size="small"
        column={1}
        data={[
          { label: '标题', value: node.title ?? '-' },
          { label: '位置', value: `${Math.round(node.x)}, ${Math.round(node.y)}` },
          { label: '尺寸', value: `${Math.round(node.width)} x ${Math.round(node.height)}` },
          { label: '层级', value: String(node.zIndex) },
          { label: '锁定', value: node.locked ? '是' : '否' },
          { label: '资产', value: node.assetId ?? '-' },
          { label: '任务', value: node.taskId ?? '-' },
        ]}
      />
      <Space size={8} wrap>
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
    </section>
  )
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
      <SparkTextarea
        value={textDraft}
        rows={5}
        onChange={(event) => setTextDraft(event.target.value)}
      />
      <Button size="small" type="primary" onClick={() => onSaveText(node, textDraft)}>
        保存文本
      </Button>
    </div>
  )
}
