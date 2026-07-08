import { useMemo, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import { CANVAS_CAPABILITIES, isCapabilityRecommended } from './canvas.capabilities'
import type { CanvasNode, CanvasOperationType } from './canvas.types'

export function CanvasAiPanel({
  selectedNodes,
  onCreateTask,
}: {
  selectedNodes: CanvasNode[]
  onCreateTask: (input: { operation: CanvasOperationType; prompt: string }) => void
}) {
  const [operation, setOperation] = useState<CanvasOperationType>('text_to_image')
  const [prompt, setPrompt] = useState('')

  const selectedSummary = useMemo(() => {
    if (selectedNodes.length === 0) return '未选择节点'
    const counts = selectedNodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.type] = (acc[node.type] ?? 0) + 1
      return acc
    }, {})
    return Object.entries(counts)
      .map(([type, count]) => `${type} ${count}`)
      .join(' / ')
  }, [selectedNodes])

  const capabilities = useMemo(
    () =>
      CANVAS_CAPABILITIES.map((capability) => ({
        ...capability,
        recommended: isCapabilityRecommended(capability, selectedNodes),
      })),
    [selectedNodes],
  )

  return (
    <section className="canvas-panel-section">
      <div className="canvas-panel-title-row">
        <h3>AI 操作</h3>
        <Tag color={selectedNodes.length > 0 ? 'blue' : 'default'}>
          {selectedSummary}
        </Tag>
      </div>
      <div className="canvas-form-row">
        <label>能力</label>
        <LobeSelect
          value={operation}
          onChange={(value) => setOperation(value as CanvasOperationType)}
          options={capabilities.map((capability) => ({
            value: capability.operation,
            label: capability.recommended ? `推荐 / ${capability.label}` : capability.label,
          }))}
        />
      </div>
      <div className="canvas-form-row">
        <label>指令</label>
        <LobeTextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想让 agent/provider 完成的生成、编辑或改写任务"
          rows={5}
        />
      </div>
      <Button
        type="primary"
        block
        disabled={prompt.trim().length === 0}
        onClick={() => {
          onCreateTask({ operation, prompt: prompt.trim() })
          setPrompt('')
        }}
      >
        创建画布任务
      </Button>
    </section>
  )
}
