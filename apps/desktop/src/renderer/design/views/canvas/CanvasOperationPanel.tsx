import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Tag, Tooltip, message } from 'antd'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import { getCanvasCapability, nodeOperation } from './canvas.capabilities'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasNode, CanvasOperationType, CanvasSnapshot, CanvasTask } from './canvas.types'

/**
 * 操作节点悬浮编辑面板（文档：点击操作节点后下方展开）。
 *
 * 定位在底部 dock 上方（bottom:72px，同 add-node-menu 模式）。
 * 三区：操作类型 / 输入预览 / 参数编辑。确定后运行。
 */

export type OperationRunParams = {
  prompt: string
  negativePrompt?: string
  modelParams?: Record<string, unknown>
}

export function CanvasOperationPanel({
  node,
  snapshot,
  task,
  onClose,
  onRun,
  onRetry,
}: {
  node: CanvasNode
  snapshot: CanvasSnapshot
  /** 关联的 CanvasTask（可能为 null，pending 状态） */
  task?: CanvasTask | null
  onClose: () => void
  onRun: (params: OperationRunParams) => void
  onRetry: () => void
}) {
  const operation = nodeOperation(node) ?? 'text_generate'
  const capability = getCanvasCapability(operation)
  const operationText = operationLabel(operation)

  // 上游输入节点（used_as_input edge 的 source）
  const inputNodes = useMemo(() => {
    const inputEdges = snapshot.edges.filter(
      (edge) => edge.targetNodeId === node.id && edge.type === 'used_as_input',
    )
    const inputIds = new Set(inputEdges.map((edge) => edge.sourceNodeId))
    return snapshot.nodes.filter((n) => inputIds.has(n.id) && !n.hidden)
  }, [snapshot.edges, snapshot.nodes, node.id])

  // 已有 output 节点（generated edge 的 target）
  const outputNodes = useMemo(() => {
    const outputEdges = snapshot.edges.filter(
      (edge) => edge.sourceNodeId === node.id && edge.type === 'generated',
    )
    const outputIds = new Set(outputEdges.map((edge) => edge.targetNodeId))
    return snapshot.nodes.filter((n) => outputIds.has(n.id) && !n.hidden)
  }, [snapshot.edges, snapshot.nodes, node.id])

  // 参数状态：从 task 或 node.data 带入
  const [prompt, setPrompt] = useState(task?.prompt ?? node.data.prompt ?? '')
  const [negativePrompt, setNegativePrompt] = useState(task?.negativePrompt ?? '')
  const [modelParams, setModelParams] = useState<Record<string, unknown>>(task?.modelParams ?? {})
  const [running, setRunning] = useState(false)

  // 输入节点内容带入 prompt（首次打开时如果 prompt 为空）
  useEffect(() => {
    if (prompt) return
    const textInputs = inputNodes
      .filter((n) => n.type === 'text' || n.type === 'prompt')
      .map((n) => n.data.text ?? '')
      .filter(Boolean)
    if (textInputs.length > 0) {
      setPrompt(textInputs.join('\n\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRun = useCallback(() => {
    if (!prompt.trim() && !capability?.inputTypes.includes('image') && !capability?.inputTypes.includes('video')) {
      message.warning('请输入提示词')
      return
    }
    setRunning(true)
    onRun({ prompt: prompt.trim(), ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}), modelParams })
  }, [prompt, negativePrompt, modelParams, onRun, capability])

  const statusTag = useMemo(() => {
    const s = node.data.status ?? 'pending'
    const color = s === 'completed' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : 'default'
    return <Tag color={color} bordered>{s}</Tag>
  }, [node.data.status])

  // 参数字段（schema-driven，从 capability paramsSchema 取常用字段）
  const paramFields = useMemo(() => getOperationParamFields(operation), [operation])

  const imageInputs = inputNodes.filter((n) => n.type === 'image' || n.type === 'video')
  const textInputs = inputNodes.filter((n) => n.type === 'text' || n.type === 'prompt')

  return (
    <div className="canvas-operation-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="canvas-operation-panel-head">
        <div className="canvas-operation-panel-title">
          {operationLabel(operation)}
          {statusTag}
          {outputNodes.length > 0 && <Tag color="purple" bordered>{outputNodes.length} 产出</Tag>}
        </div>
        <Button size="small" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
      </div>

      <div className="canvas-operation-panel-body">
        {/* 输入预览 */}
        {inputNodes.length > 0 && (
          <div className="canvas-operation-panel-section">
            <div className="canvas-operation-panel-section-label">输入 ({inputNodes.length})</div>
            {imageInputs.length > 0 && (
              <div className="canvas-operation-panel-inputs">
                {imageInputs.map((n) => {
                  const asset = n.assetId ? snapshot.assets.find((a) => a.id === n.assetId) : null
                  return (
                    <Tooltip key={n.id} title={n.title ?? n.type}>
                      <div className="canvas-operation-panel-input-thumb">
                        {asset ? <AssetThumbnail asset={asset} /> : <Icons.Image size={20} />}
                      </div>
                    </Tooltip>
                  )
                })}
              </div>
            )}
            {textInputs.length > 0 && (
              <div className="canvas-operation-panel-text-inputs">
                {textInputs.map((n) => (
                  <div key={n.id} className="canvas-operation-panel-text-input" title={n.title ?? ''}>
                    <span className="canvas-operation-panel-text-input-title">{n.title ?? '文本'}</span>
                    <span className="canvas-operation-panel-text-input-content">
                      {(n.data.text ?? '').slice(0, 80) || '(空)'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Prompt 编辑 */}
        <div className="canvas-operation-panel-section">
          <div className="canvas-operation-panel-section-label">提示词</div>
          <Input.TextArea
            rows={4}
            value={prompt}
            placeholder={`输入${operationText}的提示词...`}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
          />
        </div>

        {/* 负面提示词（仅图像/视频类） */}
        {(operation.includes('image') || operation.includes('video')) && (
          <div className="canvas-operation-panel-section">
            <div className="canvas-operation-panel-section-label">负面提示词（可选）</div>
            <Input.TextArea
              rows={2}
              value={negativePrompt}
              placeholder="不希望出现的内容..."
              onChange={(e) => setNegativePrompt(e.target.value)}
              disabled={running}
            />
          </div>
        )}

        {/* 操作专属参数 */}
        {paramFields.length > 0 && (
          <div className="canvas-operation-panel-section">
            <div className="canvas-operation-panel-section-label">参数</div>
            <div className="canvas-operation-panel-params">
              {paramFields.map((field) => (
                <label key={field.key} className="canvas-operation-panel-param">
                  <span>{field.label}</span>
                  <Input
                    size="small"
                    placeholder={field.placeholder}
                    value={String(modelParams[field.key] ?? '')}
                    onChange={(e) => setModelParams({ ...modelParams, [field.key]: e.target.value })}
                    disabled={running}
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="canvas-operation-panel-footer">
        <Button
          size="small"
          icon={<Icons.RotateCcw size={13} />}
          disabled={running || outputNodes.length === 0}
          onClick={() => {
            onRetry()
            message.info('已发起重试，将在右侧生成新的产出节点')
          }}
        >
          重试
        </Button>
        <div className="canvas-operation-panel-footer-spacer" />
        <Button size="small" onClick={onClose}>取消</Button>
        <Button
          size="small"
          type="primary"
          icon={<Icons.Sparkles size={13} />}
          loading={running || node.data.status === 'running'}
          disabled={node.data.status === 'running'}
          onClick={() => void handleRun()}
        >
          {node.data.status === 'running' ? '运行中' : outputNodes.length > 0 ? '重新生成' : '运行'}
        </Button>
      </div>
    </div>
  )
}

/** 各 operation 的常用参数字段 */
function getOperationParamFields(operation: CanvasOperationType): Array<{ key: string; label: string; placeholder: string }> {
  switch (operation) {
    case 'text_to_image':
    case 'image_to_image':
    case 'image_edit':
      return [
        { key: 'seed', label: '种子', placeholder: '留空随机' },
        { key: 'steps', label: '步数', placeholder: '如 30' },
        { key: 'guidance', label: '引导强度', placeholder: '如 7.5' },
      ]
    case 'text_to_video':
    case 'image_to_video':
      return [
        { key: 'duration', label: '时长(秒)', placeholder: '如 5' },
        { key: 'fps', label: '帧率', placeholder: '如 24' },
      ]
    case 'text_to_audio':
      return [
        { key: 'voice', label: '音色', placeholder: '如 female' },
        { key: 'speed', label: '语速', placeholder: '如 1.0' },
      ]
    default:
      return []
  }
}
