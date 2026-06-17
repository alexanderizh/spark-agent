import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Select, Tag, Tooltip, message } from 'antd'
import { Icons } from '../../Icons'
import { capabilityForOperation, type CanvasMediaModelSummary } from '@spark/protocol'
import { operationLabel } from './canvas.api'
import { getCanvasCapability, nodeOperation } from './canvas.capabilities'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { canvasApi } from './canvas.api'
import {
  buildCustomModelParams,
  buildModelParams,
  createCustomParamDraft,
  mediaModelKey,
  mergeSchemaFields,
  modelSuggestedFields,
  normalizeModelParamsForSubmit,
  operationSuggestedFields,
  schemaFields,
  updateCustomParam,
  type CustomParamDraft,
  type CustomParamType,
} from './CanvasInlineAiComposer'
import type {
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
  CanvasTask,
} from './canvas.types'

/**
 * 操作节点悬浮编辑面板（文档：点击操作节点后下方展开）。
 *
 * 定位在底部 dock 上方（bottom:72px，同 add-node-menu 模式）。
 * 三区：操作类型 / 输入预览 / 参数编辑。确定后运行。
 */

export type OperationRunParams = {
  prompt: string
  negativePrompt?: string
  inputNodeIds?: string[]
  inputTransport?: CanvasInputTransport
  providerProfileId?: string
  manifestId?: string
  modelId?: string
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
  const canEditMediaInputs = capability?.inputTypes.some((type) => type === 'image' || type === 'video') ?? false

  // 上游输入节点（used_as_input edge 的 source）
  const sourceInputNodes = useMemo(() => {
    const inputEdges = snapshot.edges.filter(
      (edge) => edge.targetNodeId === node.id && edge.type === 'used_as_input',
    )
    const inputIds = new Set(inputEdges.map((edge) => edge.sourceNodeId))
    return snapshot.nodes.filter((n) => inputIds.has(n.id) && !n.hidden)
  }, [snapshot.edges, snapshot.nodes, node.id])
  const expandedSourceInputNodes = useMemo(
    () => expandOperationInputNodes(sourceInputNodes, snapshot.nodes),
    [sourceInputNodes, snapshot.nodes],
  )
  const editableSourceMediaNodes = useMemo(
    () =>
      expandedSourceInputNodes.filter((item) =>
        isSupportedMediaInputNode(item, capability?.inputTypes ?? []),
      ),
    [capability, expandedSourceInputNodes],
  )
  const mediaInputOptions = useMemo(
    () =>
      snapshot.nodes
        .filter((item) => {
          if (item.hidden || item.id === node.id) return false
          if (item.type !== 'image' && item.type !== 'video') return false
          if (item.type === 'video' && !capability?.inputTypes.includes('video')) return false
          if (item.type === 'image' && !capability?.inputTypes.includes('image')) return false
          return true
        })
        .sort((left, right) => left.x - right.x || left.y - right.y || left.zIndex - right.zIndex)
        .map((item) => ({
          value: item.id,
          label: item.title ?? (item.type === 'video' ? '视频节点' : '图片节点'),
        })),
    [capability, node.id, snapshot.nodes],
  )

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
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [customParams, setCustomParams] = useState<CustomParamDraft[]>([])
  const [selectedInputNodeIds, setSelectedInputNodeIds] = useState<string[]>(() =>
    (canEditMediaInputs ? editableSourceMediaNodes : expandedSourceInputNodes).map((item) => item.id),
  )
  const [running, setRunning] = useState(false)

  useEffect(() => {
    setSelectedInputNodeIds(
      (canEditMediaInputs ? editableSourceMediaNodes : expandedSourceInputNodes).map((item) => item.id),
    )
  }, [canEditMediaInputs, editableSourceMediaNodes, expandedSourceInputNodes])

  useEffect(() => {
    let cancelled = false
    setModelsLoading(true)
    void canvasApi
      .listMediaModels({ enabledOnly: true })
      .then((response) => {
        if (!cancelled) setMediaModels(response.models)
      })
      .catch(() => {
        if (!cancelled) setMediaModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 输入节点内容带入 prompt（首次打开时如果 prompt 为空）
  useEffect(() => {
    if (prompt) return
    const textInputs = expandedSourceInputNodes
      .filter((n) => n.type === 'text' || n.type === 'prompt')
      .map((n) => n.data.text ?? '')
      .filter(Boolean)
    if (textInputs.length > 0) {
      setPrompt(textInputs.join('\n\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusTag = useMemo(() => {
    const s = node.data.status ?? 'pending'
    const color = s === 'completed' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : 'default'
    return <Tag color={color} bordered>{operationStatusLabel(s)}</Tag>
  }, [node.data.status])

  const mediaCapabilityIds = useMemo(() => capabilityForOperation(operation), [operation])
  const supportedMediaModels = useMemo(() => {
    if (mediaCapabilityIds.length === 0) return []
    return mediaModels.filter((model) =>
      model.capabilities.some((item) =>
        (mediaCapabilityIds as readonly string[]).includes(item.id),
      ),
    )
  }, [mediaCapabilityIds, mediaModels])
  const modelOptions = useMemo(
    () =>
      supportedMediaModels.map((model) => ({
        value: mediaModelKey(model),
        label: `${model.providerName ?? model.providerKind} / ${model.displayName}`,
      })),
    [supportedMediaModels],
  )
  const selectedModel = useMemo(
    () => supportedMediaModels.find((model) => mediaModelKey(model) === selectedModelKey),
    [selectedModelKey, supportedMediaModels],
  )
  const selectedCapability = useMemo(() => {
    if (!selectedModel) return null
    return (
      selectedModel.capabilities.find((item) =>
        (mediaCapabilityIds as readonly string[]).includes(item.id),
      ) ?? null
    )
  }, [mediaCapabilityIds, selectedModel])
  const parameterFields = useMemo(
    () =>
      mergeSchemaFields(
        schemaFields(selectedCapability?.paramSchema ?? {}),
        operationSuggestedFields(operation),
        modelSuggestedFields(selectedModel),
      ),
    [operation, selectedCapability, selectedModel],
  )

  useEffect(() => {
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (supportedMediaModels.some((model) => mediaModelKey(model) === selectedModelKey)) return
    const fromTask = supportedMediaModels.find(
      (model) =>
        (!task?.providerProfileId || model.providerProfileId === task.providerProfileId) &&
        (!task?.manifestId || model.manifestId === task.manifestId) &&
        (!task?.modelId || model.effectiveModelId === task.modelId),
    )
    setSelectedModelKey(mediaModelKey(fromTask ?? supportedMediaModels[0]!))
  }, [selectedModelKey, supportedMediaModels, task?.manifestId, task?.modelId, task?.providerProfileId])

  useEffect(() => {
    const defaults = selectedCapability?.defaults ?? {}
    const existing = task?.modelParams ?? {}
    const next: Record<string, string> = {}
    const fieldNames = new Set(parameterFields.map((field) => field.name))
    for (const field of parameterFields) {
      const value = existing[field.name] ?? defaults[field.name]
      next[field.name] = value == null ? '' : String(value)
    }
    setModelParamDraft(next)
    setCustomParams(
      Object.entries(existing)
        .filter(([key, value]) => !fieldNames.has(key) && value != null)
        .map(([key, value]) => ({
          id: `custom-${key}`,
          name: key,
          type: inferCustomParamType(value),
          value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        })),
    )
  }, [parameterFields, selectedCapability, task?.modelParams])

  const handleRun = useCallback(() => {
    if (!prompt.trim() && !capability?.inputTypes.includes('image') && !capability?.inputTypes.includes('video')) {
      message.warning('请输入提示词')
      return
    }
    if (
      canEditMediaInputs &&
      capability?.inputTypes.some((type) => type === 'image' || type === 'video') &&
      selectedInputNodeIds.length === 0
    ) {
      message.warning('请至少选择一个输入图片或视频节点')
      return
    }
    const nextModelParams = normalizeModelParamsForSubmit(
      {
        ...buildModelParams(parameterFields, modelParamDraft),
        ...buildCustomModelParams(customParams),
      },
      selectedCapability?.defaults ?? {},
    )
    const runInputNodeIds = Array.from(
      new Set([
        ...selectedInputNodeIds,
        ...expandedSourceInputNodes
          .filter((item) => item.type === 'text' || item.type === 'prompt')
          .map((item) => item.id),
      ]),
    )
    setRunning(true)
    onRun({
      prompt: prompt.trim(),
      ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
      inputNodeIds: runInputNodeIds,
      ...(selectedModel?.providerKind === 'xai'
        ? { inputTransport: 'base64' as const }
        : { inputTransport: 'cloud_url' as const }),
      ...(selectedModel?.providerProfileId ? { providerProfileId: selectedModel.providerProfileId } : {}),
      ...(selectedModel?.manifestId ? { manifestId: selectedModel.manifestId } : {}),
      ...(selectedModel?.effectiveModelId ? { modelId: selectedModel.effectiveModelId } : {}),
      ...(Object.keys(nextModelParams).length > 0 ? { modelParams: nextModelParams } : {}),
    })
  }, [
    capability,
    customParams,
    modelParamDraft,
    negativePrompt,
    onRun,
    parameterFields,
    prompt,
    selectedCapability,
    selectedModel,
    expandedSourceInputNodes,
    selectedInputNodeIds,
  ])

  const selectedInputIdSet = useMemo(() => new Set(selectedInputNodeIds), [selectedInputNodeIds])
  const inputNodes = useMemo(
    () => {
      const byId = new Map(snapshot.nodes.map((item) => [item.id, item]))
      return selectedInputNodeIds
        .map((id) => byId.get(id))
        .filter((item): item is CanvasNode => item != null)
        .filter((item) => !item.hidden && selectedInputIdSet.has(item.id))
    },
    [selectedInputIdSet, selectedInputNodeIds, snapshot.nodes],
  )
  const mediaInputs = inputNodes.filter((n) => n.type === 'image' || n.type === 'video')
  const textInputs = expandedSourceInputNodes.filter((n) => n.type === 'text' || n.type === 'prompt')

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
        {(expandedSourceInputNodes.length > 0 || canEditMediaInputs) && (
          <div className="canvas-operation-panel-section">
            <div className="canvas-operation-panel-section-title-row">
              <div className="canvas-operation-panel-section-label">
                输入 ({inputNodes.length + textInputs.length})
              </div>
              {sourceInputNodes.some((item) => item.type === 'group') && (
                <Tag bordered color="gold">已展开组内元素</Tag>
              )}
            </div>
            {canEditMediaInputs && (
              <Select
                mode="multiple"
                size="small"
                allowClear
                showSearch
                value={selectedInputNodeIds}
                placeholder="选择或调整输入图片/视频节点"
                options={mediaInputOptions}
                optionFilterProp="label"
                onChange={(value) => setSelectedInputNodeIds(value.map(String))}
                disabled={running}
              />
            )}
            {mediaInputs.length > 0 ? (
              <div className="canvas-operation-panel-inputs">
                {mediaInputs.map((n) => {
                  const asset = n.assetId ? snapshot.assets.find((a) => a.id === n.assetId) : null
                  return (
                    <Tooltip key={n.id} title={n.title ?? n.type}>
                      <div className="canvas-operation-panel-input-card">
                        <div className="canvas-operation-panel-input-thumb">
                          {asset ? <AssetThumbnail asset={asset} /> : <Icons.Image size={20} />}
                        </div>
                        <div className="canvas-operation-panel-input-name">
                          {n.title ?? (n.type === 'video' ? '视频' : '图片')}
                        </div>
                        {canEditMediaInputs && (
                          <Button
                            size="small"
                            type="text"
                            icon={<Icons.X size={12} />}
                            aria-label="移除输入"
                            disabled={running}
                            onClick={() =>
                              setSelectedInputNodeIds((prev) => prev.filter((id) => id !== n.id))
                            }
                          />
                        )}
                      </div>
                    </Tooltip>
                  )
                })}
              </div>
            ) : canEditMediaInputs ? (
              <div className="canvas-operation-panel-hint">
                暂无输入媒体。可从上方选择已有图片/视频节点，组节点会自动展开为内部元素。
              </div>
            ) : null}
            {sourceInputNodes.some((item) => item.type === 'group') && (
              <div className="canvas-operation-panel-hint">
                组节点仅作为选择容器，提交任务时会使用组内的图片/视频/文本元素作为真实输入。
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

        {mediaCapabilityIds.length > 0 && (
          <div className="canvas-operation-panel-section">
            <div className="canvas-operation-panel-section-label">模型</div>
            <Select
              size="small"
              allowClear
              loading={modelsLoading}
              value={selectedModelKey || undefined}
              placeholder={modelsLoading ? '加载模型目录...' : '自动路由'}
              options={modelOptions}
              onChange={(value) => setSelectedModelKey(value == null ? '' : String(value))}
              disabled={running}
            />
            <div className="canvas-operation-panel-hint">
              {modelsLoading
                ? '正在读取已启用模型...'
                : supportedMediaModels.length > 0
                  ? `当前能力可用 ${supportedMediaModels.length} 个模型${selectedModel ? ` · ${selectedModel.effectiveModelId} · ${selectedModel.invocationMode}` : ''}`
                  : '当前能力暂无已启用模型，可继续使用自动路由或先到 Provider 绑定模型。'}
            </div>
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
        {parameterFields.length > 0 && (
          <div className="canvas-operation-panel-section">
            <div className="canvas-operation-panel-section-label">模型参数</div>
            <div className="canvas-operation-panel-params">
              {parameterFields.map((field) => (
                <label key={field.name} className="canvas-operation-panel-param">
                  <span title={field.description}>{field.title}</span>
                  {field.enumValues.length > 0 ? (
                    <Select
                      size="small"
                      allowClear
                      value={modelParamDraft[field.name] || undefined}
                      options={field.enumValues.map((value) => ({ value, label: value }))}
                      onChange={(value) =>
                        setModelParamDraft((prev) => ({
                          ...prev,
                          [field.name]: value == null ? '' : String(value),
                        }))
                      }
                      disabled={running}
                    />
                  ) : field.type === 'boolean' ? (
                    <Select
                      size="small"
                      allowClear
                      value={modelParamDraft[field.name] || undefined}
                      options={[
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' },
                      ]}
                      onChange={(value) =>
                        setModelParamDraft((prev) => ({
                          ...prev,
                          [field.name]: value == null ? '' : String(value),
                        }))
                      }
                      disabled={running}
                    />
                  ) : (
                    <Input
                      size="small"
                      type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.placeholder}
                      value={modelParamDraft[field.name] ?? ''}
                      onChange={(e) =>
                        setModelParamDraft((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      disabled={running}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="canvas-operation-panel-section">
          <div className="canvas-operation-panel-section-title-row">
            <div className="canvas-operation-panel-section-label">自定义参数</div>
            <Button
              size="small"
              type="text"
              icon={<Icons.Plus size={13} />}
              disabled={running}
              onClick={() => setCustomParams((prev) => [...prev, createCustomParamDraft()])}
            >
              添加
            </Button>
          </div>
          {customParams.length === 0 ? (
            <div className="canvas-operation-panel-hint">
              可添加模型私有参数，例如 seed、negative_prompt、camera_control。
            </div>
          ) : (
            <div className="canvas-operation-panel-custom-params">
              {customParams.map((param) => (
                <div key={param.id} className="canvas-operation-panel-custom-param">
                  <Input
                    size="small"
                    value={param.name}
                    placeholder="字段名"
                    disabled={running}
                    onChange={(event) =>
                      updateCustomParam(setCustomParams, param.id, { name: event.target.value })
                    }
                  />
                  <Select
                    size="small"
                    value={param.type}
                    disabled={running}
                    options={[
                      { value: 'string', label: '文本' },
                      { value: 'number', label: '数字' },
                      { value: 'integer', label: '整数' },
                      { value: 'boolean', label: '布尔' },
                      { value: 'json', label: 'JSON' },
                    ]}
                    onChange={(value) =>
                      updateCustomParam(setCustomParams, param.id, {
                        type: String(value) as CustomParamType,
                      })
                    }
                  />
                  {param.type === 'boolean' ? (
                    <Select
                      size="small"
                      allowClear
                      value={param.value || undefined}
                      placeholder="值"
                      disabled={running}
                      options={[
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' },
                      ]}
                      onChange={(value) =>
                        updateCustomParam(setCustomParams, param.id, {
                          value: value == null ? '' : String(value),
                        })
                      }
                    />
                  ) : (
                    <Input
                      size="small"
                      value={param.value}
                      placeholder={param.type === 'json' ? '{"key":"value"}' : '值'}
                      type={param.type === 'integer' || param.type === 'number' ? 'number' : 'text'}
                      disabled={running}
                      onChange={(event) =>
                        updateCustomParam(setCustomParams, param.id, { value: event.target.value })
                      }
                    />
                  )}
                  <Button
                    size="small"
                    type="text"
                    icon={<Icons.Trash size={13} />}
                    aria-label="删除自定义参数"
                    disabled={running}
                    onClick={() =>
                      setCustomParams((prev) => prev.filter((item) => item.id !== param.id))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
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
          {node.data.status === 'running' ? '运行中' : '提交任务'}
        </Button>
      </div>
    </div>
  )
}

function expandOperationInputNodes(sourceNodes: CanvasNode[], allNodes: CanvasNode[]): CanvasNode[] {
  const byId = new Map(allNodes.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const result: CanvasNode[] = []
  const push = (item: CanvasNode) => {
    const latest = byId.get(item.id) ?? item
    if (latest.hidden || seen.has(latest.id)) return
    seen.add(latest.id)
    result.push(latest)
  }

  for (const source of sourceNodes) {
    if (source.type !== 'group') {
      push(source)
      continue
    }
    const members = allNodes
      .filter((item) => item.parentNodeId === source.id && !item.hidden)
      .sort((left, right) => {
        const leftX = source.x + left.x
        const rightX = source.x + right.x
        const leftY = source.y + left.y
        const rightY = source.y + right.y
        return leftX - rightX || leftY - rightY || left.zIndex - right.zIndex
      })
    if (members.length === 0) {
      push(source)
      continue
    }
    for (const member of members) push(member)
  }

  return result
}

function isSupportedMediaInputNode(
  node: CanvasNode,
  inputTypes: readonly string[],
): boolean {
  if (node.type === 'image') return inputTypes.includes('image')
  if (node.type === 'video') return inputTypes.includes('video')
  return false
}

function inferCustomParamType(value: unknown): CustomParamType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (value && typeof value === 'object') return 'json'
  return 'string'
}

function operationStatusLabel(status: CanvasTask['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}
