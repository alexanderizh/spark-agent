import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const lastOpenRef = useRef(false)

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

  const nodePromptContext = useMemo(() => buildPromptContext(selectedNodes), [selectedNodes])
  const canSubmit = prompt.trim().length > 0 || nodePromptContext.length > 0 || canRunFromInputOnly(operation, selectedNodes)

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
  const creativeActions = useMemo(() => {
    const recommended = capabilities.filter((capability) => capability.recommended)
    return (recommended.length > 0 ? recommended : capabilities).slice(0, 6)
  }, [capabilities])

  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false
      return
    }
    if (lastOpenRef.current) return
    lastOpenRef.current = true
    const recommended = capabilities.find((capability) => capability.recommended)
    if (recommended) setOperation(recommended.operation)
    setPrompt(nodePromptContext)
  }, [capabilities, nodePromptContext, open])

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

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,.ant-select,.ant-tag')) return
    const panel = panelRef.current
    if (!panel) return
    const parent = panel.offsetParent instanceof HTMLElement ? panel.offsetParent : null
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const panelRect = panel.getBoundingClientRect()
    const offsetX = event.clientX - panelRect.left
    const offsetY = event.clientY - panelRect.top
    const maxX = Math.max(8, parentRect.width - panelRect.width - 8)
    const maxY = Math.max(8, parentRect.height - panelRect.height - 8)
    const move = (moveEvent: PointerEvent) => {
      const nextX = Math.min(Math.max(8, moveEvent.clientX - parentRect.left - offsetX), maxX)
      const nextY = Math.min(Math.max(8, moveEvent.clientY - parentRect.top - offsetY), maxY)
      setPanelPosition({ x: nextX, y: nextY })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    setPanelPosition({
      x: Math.min(Math.max(8, panelRect.left - parentRect.left), maxX),
      y: Math.min(Math.max(8, panelRect.top - parentRect.top), maxY),
    })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    event.preventDefault()
  }, [])

  if (!open) return null

  return (
    <section
      ref={panelRef}
      className="canvas-inline-ai-composer"
      style={panelPosition ? { left: panelPosition.x, top: panelPosition.y, transform: 'none' } : undefined}
    >
      <div className="canvas-inline-ai-head canvas-inline-ai-drag-handle" onPointerDown={handleDragStart}>
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
        <div className="canvas-creative-actions">
          {creativeActions.map((capability) => (
            <Button
              key={capability.operation}
              size="small"
              type={capability.operation === operation ? 'primary' : 'default'}
              onClick={() => setOperation(capability.operation)}
            >
              {capability.label}
            </Button>
          ))}
        </div>
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
            {modelsLoading
              ? '正在读取已启用模型...'
              : supportedMediaModels.length > 0
                ? `当前能力可用 ${supportedMediaModels.length} 个模型${selectedModel ? ` · ${selectedModel.effectiveModelId} · ${selectedModel.invocationMode}` : ''}`
                : '当前能力暂无已启用模型，可继续使用自动路由或先到 Provider 绑定模型。'}
          </div>
          {supportedMediaModels.length > 0 && (
            <div className="canvas-model-chip-row">
              {supportedMediaModels.slice(0, 4).map((model) => (
                <Tag key={mediaModelKey(model)} color={mediaModelKey(model) === selectedModelKey ? 'blue' : 'default'} bordered>
                  {model.providerName ?? model.providerKind} / {model.displayName}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="canvas-form-row">
        <label>指令</label>
        <LobeTextArea
          value={prompt}
          rows={4}
          placeholder={nodePromptContext ? '已自动带入选中节点内容，可继续补充要求' : '描述你希望 agent/provider 在画布中完成的生成、编辑、重写或合成任务'}
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
          disabled={!canSubmit}
          onClick={() => {
            const modelParams = buildModelParams(parameterFields, modelParamDraft)
            const effectivePrompt = prompt.trim() || fallbackPromptForOperation(operation)
            const payload: { operation: CanvasOperationType; prompt: string; providerProfileId?: string; manifestId?: string; modelId?: string; modelParams?: Record<string, unknown> } = {
              operation,
              prompt: effectivePrompt,
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

function buildPromptContext(nodes: CanvasNode[]): string {
  const textParts = nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => node.data.text?.trim())
    .filter((text): text is string => Boolean(text))
  return textParts.join('\n\n')
}

function canRunFromInputOnly(operation: CanvasOperationType, nodes: CanvasNode[]): boolean {
  if (!['image_to_image', 'image_edit', 'image_compose', 'image_to_video', 'audio_transcribe'].includes(operation)) {
    return false
  }
  const inputTypes = new Set(nodes.map((node) => node.type))
  if (operation === 'audio_transcribe') return inputTypes.has('audio')
  return inputTypes.has('image')
}

function fallbackPromptForOperation(operation: CanvasOperationType): string {
  if (operation === 'image_edit') return '请基于输入图片进行自然编辑，保持主体与画面质量。'
  if (operation === 'image_to_image') return '请基于输入图片生成一个高质量变体。'
  if (operation === 'image_compose') return '请将输入图片自然合成为一张高质量图片。'
  if (operation === 'image_to_video') return '请基于输入图片生成一段自然流畅的视频。'
  if (operation === 'audio_transcribe') return '请转写输入音频内容。'
  return ''
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
