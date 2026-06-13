import { useMemo, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import { CANVAS_CAPABILITIES, isCapabilityRecommended } from './canvas.capabilities'
import type { CanvasNode, CanvasOperationType } from './canvas.types'

export function CanvasInlineAiComposer({
  open,
  selectedNodes,
  onClose,
  onCreateTask,
}: {
  open: boolean
  selectedNodes: CanvasNode[]
  onClose: () => void
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

  if (!open) return null

  return (
    <section className="canvas-inline-ai-composer">
      <div className="canvas-inline-ai-head">
        <div>
          <h3>AI 操作</h3>
          <div className="canvas-inline-ai-subtitle">基于画布选择创建任务</div>
        </div>
        <div className="canvas-inline-ai-head-actions">
          <Tag color={selectedNodes.length > 0 ? 'blue' : 'default'}>
            {selectedSummary}
          </Tag>
          <Button
            size="small"
            type="text"
            icon={<Icons.X size={14} />}
            aria-label="关闭 AI 操作"
            onClick={onClose}
          />
        </div>
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
          rows={4}
          placeholder="描述你希望 agent/provider 在画布中完成的生成、编辑、重写或合成任务"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className="canvas-inline-ai-footer">
        <Button size="small" onClick={onClose}>
          取消
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<Icons.Sparkles size={15} />}
          disabled={prompt.trim().length === 0}
          onClick={() => {
            onCreateTask({ operation, prompt: prompt.trim() })
            setPrompt('')
          }}
        >
          创建任务
        </Button>
      </div>
    </section>
  )
}
