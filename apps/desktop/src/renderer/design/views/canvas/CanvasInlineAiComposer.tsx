import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import { capabilityForOperation } from '@spark/protocol'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { canvasApi } from './canvas.api'
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
  onCreateTask: (input: { operation: CanvasOperationType; prompt: string; providerProfileId?: string; manifestId?: string; modelId?: string; modelParams?: Record<string, unknown> }) => void
}) {
  const [operation, setOperation] = useState<CanvasOperationType>('text_to_image')
  const [prompt, setPrompt] = useState('')
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState<string>('')
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
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
  }, [open])

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

  const mediaCapabilityIds = useMemo(() => capabilityForOperation(operation), [operation])
  const supportedMediaModels = useMemo(() => {
    if (mediaCapabilityIds.length === 0) return []
    return mediaModels.filter((model) =>
      model.capabilities.some((capability) => (mediaCapabilityIds as readonly string[]).includes(capability.id)),
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
    return selectedModel.capabilities.find((capability) =>
      (mediaCapabilityIds as readonly string[]).includes(capability.id),
    ) ?? null
  }, [mediaCapabilityIds, selectedModel])
  const parameterFields = useMemo(
    () => schemaFields(selectedCapability?.paramSchema ?? {}),
    [selectedCapability],
  )

  useEffect(() => {
    const defaults = selectedCapability?.defaults ?? {}
    setModelParamDraft((prev) => {
      const next: Record<string, string> = {}
      for (const field of parameterFields) {
        const existing = prev[field.name]
        const defaultValue = defaults[field.name]
        next[field.name] = existing ?? (defaultValue == null ? '' : String(defaultValue))
      }
      return next
    })
  }, [parameterFields, selectedCapability])

  useEffect(() => {
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (!supportedMediaModels.some((model) => mediaModelKey(model) === selectedModelKey)) {
      const firstModel = supportedMediaModels[0]
      if (firstModel) setSelectedModelKey(mediaModelKey(firstModel))
    }
  }, [selectedModelKey, supportedMediaModels])

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
      {mediaCapabilityIds.length > 0 && (
        <div className="canvas-form-row">
          <label>模型</label>
          <LobeSelect
            value={selectedModelKey || undefined}
            loading={modelsLoading}
            placeholder={modelsLoading ? '加载模型目录...' : '使用自动路由'}
            onChange={(value) => setSelectedModelKey(String(value ?? ''))}
            options={modelOptions}
            allowClear
          />
          <div className="canvas-model-hint">
            {selectedModel
              ? `${selectedModel.effectiveModelId} · ${selectedModel.invocationMode}`
              : '未选择 manifest 模型时，将按 provider 能力自动路由。'}
          </div>
        </div>
      )}
      <div className="canvas-form-row">
        <label>指令</label>
        <LobeTextArea
          value={prompt}
          rows={4}
          placeholder="描述你希望 agent/provider 在画布中完成的生成、编辑、重写或合成任务"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      {parameterFields.length > 0 && (
        <div className="canvas-form-row">
          <label>参数</label>
          <div className="canvas-param-grid">
            {parameterFields.map((field) => (
              <div key={field.name} className="canvas-param-field">
                <span>{field.title}</span>
                {field.enumValues.length > 0 ? (
                  <LobeSelect
                    value={modelParamDraft[field.name] || undefined}
                    allowClear
                    onChange={(value) => {
                      setModelParamDraft((prev) => ({ ...prev, [field.name]: value == null ? '' : String(value) }))
                    }}
                    options={field.enumValues.map((value) => ({ value, label: value }))}
                  />
                ) : field.type === 'boolean' ? (
                  <LobeSelect
                    value={modelParamDraft[field.name] || undefined}
                    allowClear
                    onChange={(value) => {
                      setModelParamDraft((prev) => ({ ...prev, [field.name]: value == null ? '' : String(value) }))
                    }}
                    options={[
                      { value: 'true', label: 'true' },
                      { value: 'false', label: 'false' },
                    ]}
                  />
                ) : (
                  <Input
                    value={modelParamDraft[field.name] ?? ''}
                    type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
                    placeholder={field.placeholder}
                    onChange={(e) => {
                      setModelParamDraft((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
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
            const modelParams = buildModelParams(parameterFields, modelParamDraft)
            const payload: { operation: CanvasOperationType; prompt: string; providerProfileId?: string; manifestId?: string; modelId?: string; modelParams?: Record<string, unknown> } = {
              operation,
              prompt: prompt.trim(),
            }
            if (selectedModel?.providerProfileId) payload.providerProfileId = selectedModel.providerProfileId
            if (selectedModel?.manifestId) payload.manifestId = selectedModel.manifestId
            if (selectedModel?.effectiveModelId) payload.modelId = selectedModel.effectiveModelId
            if (Object.keys(modelParams).length > 0) payload.modelParams = modelParams
            onCreateTask(payload)
            setPrompt('')
          }}
        >
          创建任务
        </Button>
      </div>
    </section>
  )
}

function mediaModelKey(model: CanvasMediaModelSummary): string {
  return `${model.providerProfileId ?? 'catalog'}::${model.manifestId}::${model.effectiveModelId}`
}

type SchemaField = {
  name: string
  title: string
  type: string
  enumValues: string[]
  placeholder?: string
}

function schemaFields(schema: Record<string, unknown>): SchemaField[] {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  return Object.entries(properties as Record<string, unknown>).slice(0, 12).map(([name, raw]) => {
    const spec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const type = typeof spec.type === 'string' ? spec.type : 'string'
    const enumValues = Array.isArray(spec.enum)
      ? spec.enum.filter((value): value is string => typeof value === 'string')
      : []
    const examples = Array.isArray(spec.examples)
      ? spec.examples.filter((value): value is string => typeof value === 'string')
      : []
    return {
      name,
      title: typeof spec.title === 'string' ? spec.title : name,
      type,
      enumValues,
      ...(examples[0] ? { placeholder: examples[0] } : {}),
    }
  })
}

function buildModelParams(fields: SchemaField[], draft: Record<string, string>): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = draft[field.name]?.trim()
    if (!raw) continue
    if (field.type === 'integer') {
      const value = Number.parseInt(raw, 10)
      if (Number.isFinite(value)) params[field.name] = value
    } else if (field.type === 'number') {
      const value = Number(raw)
      if (Number.isFinite(value)) params[field.name] = value
    } else if (field.type === 'boolean') {
      params[field.name] = raw === 'true'
    } else {
      params[field.name] = raw
    }
  }
  return params
}
