import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Button, Checkbox as LobeCheckbox, Input, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { Select as LobeSelect } from '@lobehub/ui'
import { capabilityForOperation } from '@spark/protocol'
import type { CanvasMediaModelSummary, CanvasMediaTaskInputFile } from '@spark/protocol'
import { canvasApi } from './canvas.api'
import { CANVAS_CAPABILITIES, isCapabilityRecommended } from './canvas.capabilities'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import type {
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasProjectSettings,
} from './canvas.types'

const COMPOSER_CACHE_KEY = 'spark-canvas:inline-ai-composer:v1'
type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>

export function CanvasInlineAiComposer({
  open,
  selectedNodes,
  allNodes = selectedNodes,
  projectSettings,
  onUploadImage,
  onClose,
  onCreateTask,
}: {
  open: boolean
  selectedNodes: CanvasNode[]
  allNodes?: CanvasNode[]
  projectSettings?: CanvasProjectSettings
  onUploadImage?: () => void
  onClose: () => void
  onCreateTask: (input: {
    operation: CanvasOperationType
    prompt: string
    negativePrompt?: string
    inputNodeIds?: string[]
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    modelParams?: Record<string, unknown>
    inputTransport?: CanvasInputTransport
    inputRoles?: Record<string, CanvasTaskInputRole>
  }) => void
}) {
  const [operation, setOperation] = useState<CanvasOperationType>('text_to_image')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [includeProjectPrompt, setIncludeProjectPrompt] = useState(false)
  const [includeNegativePrompt, setIncludeNegativePrompt] = useState(false)
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState<string>('')
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [customParams, setCustomParams] = useState<CustomParamDraft[]>([])
  const [inputTransport, setInputTransport] = useState<CanvasInputTransport>('auto')
  const [firstFrameNodeId, setFirstFrameNodeId] = useState<string>('')
  const [lastFrameNodeId, setLastFrameNodeId] = useState<string>('')
  const [referenceFrameNodeIds, setReferenceFrameNodeIds] = useState<string[]>([])
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const lastOpenRef = useRef(false)
  const cacheKey = useMemo(
    () => composerCacheKey(operation, selectedModelKey || 'auto'),
    [operation, selectedModelKey],
  )
  const projectPrompt = projectSettings?.prompt?.trim() ?? ''
  const projectNegativePrompt = projectSettings?.negativePrompt?.trim() ?? ''

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
  const selectedImageNodes = useMemo(
    () => selectedNodes.filter((node) => node.type === 'image' && Boolean(node.data.url)),
    [selectedNodes],
  )
  const canvasImageNodes = useMemo(
    () =>
      allNodes
        .filter((node) => node.type === 'image' && !node.hidden && Boolean(node.data.url))
        .sort((left, right) => left.x - right.x || left.y - right.y || left.zIndex - right.zIndex),
    [allNodes],
  )
  const frameCandidateImageNodes = useMemo(
    () => (canvasImageNodes.length > 0 ? canvasImageNodes : selectedImageNodes),
    [canvasImageNodes, selectedImageNodes],
  )

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
      model.capabilities.some((capability) =>
        (mediaCapabilityIds as readonly string[]).includes(capability.id),
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
      selectedModel.capabilities.find((capability) =>
        (mediaCapabilityIds as readonly string[]).includes(capability.id),
      ) ?? null
    )
  }, [mediaCapabilityIds, selectedModel])
  const supportsVideoFrameRoles = useMemo(
    () => operationSupportsVideoFrameRoles(operation) && frameCandidateImageNodes.length > 0,
    [frameCandidateImageNodes.length, operation],
  )
  const videoFrameMaxImages = useMemo(
    () => videoImageLimitForCapability(operation, selectedCapability),
    [operation, selectedCapability],
  )
  const canUseLastFrame = supportsVideoFrameRoles && videoFrameMaxImages > 1
  const selectedFrameCount =
    (firstFrameNodeId ? 1 : 0) + (lastFrameNodeId ? 1 : 0) + referenceFrameNodeIds.length
  const referenceFrameCapacity = Math.max(
    0,
    videoFrameMaxImages - (firstFrameNodeId ? 1 : 0) - (lastFrameNodeId ? 1 : 0),
  )
  const frameImageOptions = useMemo(
    () =>
      frameCandidateImageNodes.map((node, index) => ({
        value: node.id,
        label: frameNodeLabel(node, index, selectedImageNodes.some((item) => item.id === node.id)),
      })),
    [frameCandidateImageNodes, selectedImageNodes],
  )
  const hasExplicitFrameInput =
    supportsVideoFrameRoles &&
    Boolean(firstFrameNodeId || lastFrameNodeId || referenceFrameNodeIds.length > 0)
  const needsImageInput = useMemo(
    () =>
      operationNeedsImageInput(operation) &&
      (selectedNodes.some((node) => node.type === 'image') || hasExplicitFrameInput),
    [hasExplicitFrameInput, operation, selectedNodes],
  )
  const canSubmit =
    prompt.trim().length > 0 ||
    nodePromptContext.length > 0 ||
    negativePrompt.trim().length > 0 ||
    (includeProjectPrompt && projectPrompt.length > 0) ||
    canRunFromInputOnly(operation, selectedNodes) ||
    hasExplicitFrameInput
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
    const defaults = selectedCapability?.defaults ?? {}
    const cached = readComposerCacheEntry(cacheKey)
    setModelParamDraft(() => {
      const next: Record<string, string> = {}
      for (const field of parameterFields) {
        const defaultValue = defaults[field.name]
        const cachedValue = cached?.modelParamDraft[field.name]
        next[field.name] = cachedValue ?? (defaultValue == null ? '' : String(defaultValue))
      }
      return next
    })
    setCustomParams(cached?.customParams ?? [])
    if (cached?.inputTransport) setInputTransport(cached.inputTransport)
  }, [cacheKey, parameterFields, selectedCapability])

  useEffect(() => {
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (!supportedMediaModels.some((model) => mediaModelKey(model) === selectedModelKey)) {
      const cachedModelKey = readLastModelKey(operation)
      const cachedModel = supportedMediaModels.find(
        (model) => mediaModelKey(model) === cachedModelKey,
      )
      const firstModel = cachedModel ?? supportedMediaModels[0]
      if (firstModel) setSelectedModelKey(mediaModelKey(firstModel))
    }
  }, [operation, selectedModelKey, supportedMediaModels])

  useEffect(() => {
    if (!open) setCustomParams([])
  }, [open])

  useEffect(() => {
    if (!supportsVideoFrameRoles) {
      setFirstFrameNodeId('')
      setLastFrameNodeId('')
      setReferenceFrameNodeIds([])
      return
    }
    const candidateIds = new Set(frameCandidateImageNodes.map((node) => node.id))
    const selectedImageIds = new Set(selectedImageNodes.map((node) => node.id))
    const preferredNodes = selectedImageNodes.length > 0 ? selectedImageNodes : frameCandidateImageNodes
    setFirstFrameNodeId((prev) =>
      prev && candidateIds.has(prev) && (selectedImageNodes.length === 0 || selectedImageIds.has(prev))
        ? prev
        : (preferredNodes[0]?.id ?? ''),
    )
    setLastFrameNodeId((prev) =>
      videoFrameMaxImages > 1 && prev && candidateIds.has(prev) && prev !== firstFrameNodeId
        ? prev
        : (videoFrameMaxImages > 1 ? (preferredNodes[1]?.id ?? '') : ''),
    )
    setReferenceFrameNodeIds((prev) =>
      prev
        .filter((id) => candidateIds.has(id) && id !== firstFrameNodeId && id !== lastFrameNodeId)
        .slice(0, referenceFrameCapacity),
    )
  }, [
    firstFrameNodeId,
    frameCandidateImageNodes,
    lastFrameNodeId,
    referenceFrameCapacity,
    selectedImageNodes,
    supportsVideoFrameRoles,
    videoFrameMaxImages,
  ])

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,.ant-select,.ant-tag,.canvas-prompt-editor')) return
    const panel = panelRef.current
    if (!panel) return
    const parent = panel.offsetParent instanceof HTMLElement ? panel.offsetParent : null
    const parentRect = parent?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }
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
      style={
        panelPosition
          ? { left: panelPosition.x, top: panelPosition.y, transform: 'none' }
          : undefined
      }
    >
      <div
        className="canvas-inline-ai-head canvas-inline-ai-drag-handle"
        onPointerDown={handleDragStart}
      >
        <div>
          <h3>AI 操作</h3>
          <div className="canvas-inline-ai-subtitle">基于画布选择创建任务</div>
        </div>
        <div className="canvas-inline-ai-head-actions">
          <Tag color={selectedNodes.length > 0 ? 'blue' : 'default'}>{selectedSummary}</Tag>
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
                <Tag
                  key={mediaModelKey(model)}
                  color={mediaModelKey(model) === selectedModelKey ? 'blue' : 'default'}
                  bordered
                >
                  {model.providerName ?? model.providerKind} / {model.displayName}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}
      {needsImageInput && (
        <div className="canvas-form-row">
          <label>输入图片</label>
          <LobeSelect
            value={inputTransport}
            onChange={(value) => setInputTransport((value ?? 'auto') as CanvasInputTransport)}
            options={[
              {
                value: 'auto',
                label:
                  selectedModel?.providerKind === 'xai' ? '自动：Base64' : '自动：云端公网链接',
              },
              { value: 'cloud_url', label: '云端公网链接' },
              { value: 'base64', label: 'Base64 直传' },
            ]}
          />
          <div className="canvas-model-hint">
            APIMart 等平台需要公网链接；xAI 在国内公网地址不可达时建议使用 Base64。
          </div>
        </div>
      )}
      {supportsVideoFrameRoles && (
        <div className="canvas-form-row">
          <div className="canvas-form-label-row">
            <label>视频帧</label>
            {onUploadImage && (
              <Button
                size="small"
                type="text"
                icon={<Icons.Upload size={13} />}
                onClick={onUploadImage}
              >
                上传
              </Button>
            )}
          </div>
          <div className="canvas-frame-role-grid">
            <div className="canvas-param-field">
              <span>首帧</span>
              <LobeSelect
                value={firstFrameNodeId || undefined}
                allowClear
                onChange={(value) => {
                  const next = value == null ? '' : String(value)
                  setFirstFrameNodeId(next)
                  if (next && next === lastFrameNodeId) setLastFrameNodeId('')
                  if (next) {
                    setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== next))
                  }
                }}
                options={frameImageOptions}
                showSearch
              />
            </div>
            <div className="canvas-param-field">
              <span>尾帧</span>
              <LobeSelect
                value={lastFrameNodeId || undefined}
                allowClear
                disabled={!canUseLastFrame}
                onChange={(value) => {
                  const next = value == null ? '' : String(value)
                  setLastFrameNodeId(next && next !== firstFrameNodeId ? next : '')
                  if (next) {
                    setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== next))
                  }
                }}
                options={frameImageOptions}
                placeholder={canUseLastFrame ? undefined : '当前模型仅 1 张图'}
                showSearch
              />
            </div>
          </div>
          {videoFrameMaxImages > 2 && (
            <div className="canvas-param-field">
              <span>参考图</span>
              <LobeSelect
                mode="multiple"
                value={referenceFrameNodeIds}
                allowClear
                disabled={referenceFrameCapacity <= 0}
                onChange={(value) => {
                  const values = Array.isArray(value) ? value.map(String) : []
                  setReferenceFrameNodeIds(
                    values
                      .filter((id) => id !== firstFrameNodeId && id !== lastFrameNodeId)
                      .slice(0, referenceFrameCapacity),
                  )
                }}
                options={frameImageOptions.filter(
                  (option) => option.value !== firstFrameNodeId && option.value !== lastFrameNodeId,
                )}
                placeholder={
                  referenceFrameCapacity > 0 ? `最多再选 ${referenceFrameCapacity} 张` : '已达上限'
                }
                showSearch
              />
            </div>
          )}
          <div className="canvas-model-hint canvas-frame-role-hint">
            可从全画布 {frameCandidateImageNodes.length} 张图片中选择；当前模型最多使用{' '}
            {videoFrameMaxImages} 张图片，已选 {Math.min(selectedFrameCount, videoFrameMaxImages)} 张。
            {videoFrameMaxImages <= 1
              ? ' 如需多图参考，先用“多图合成”生成一张新图片节点。'
              : ''}
          </div>
        </div>
      )}
      <CanvasPromptEditor
        prompt={prompt}
        negativePrompt={negativePrompt}
        promptPlaceholder={
          nodePromptContext
            ? '已自动带入选中节点内容，可继续补充要求'
            : '描述你希望 agent/provider 在画布中完成的生成、编辑、重写或合成任务'
        }
        optimizeDisabled={prompt.trim().length === 0 && nodePromptContext.length === 0}
        onPromptChange={setPrompt}
        onNegativePromptChange={setNegativePrompt}
        onOptimizePrompt={() => {
          const sourcePrompt = prompt.trim() || nodePromptContext
          if (!sourcePrompt) return
          onCreateTask({
            operation: 'prompt_optimize',
            prompt: buildPromptOptimizationPrompt(sourcePrompt, negativePrompt),
            ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
          })
        }}
      />
      <div className="canvas-form-row">
        <label>项目提示词</label>
        <div className="canvas-prompt-injection-list">
          <LobeCheckbox
            checked={includeProjectPrompt}
            disabled={projectPrompt.length === 0}
            onChange={setIncludeProjectPrompt}
          >
            注入项目统一提示词
          </LobeCheckbox>
          <LobeCheckbox
            checked={includeNegativePrompt}
            disabled={projectNegativePrompt.length === 0}
            onChange={setIncludeNegativePrompt}
          >
            注入反向提示词
          </LobeCheckbox>
        </div>
        <div className="canvas-model-hint">
          {projectPrompt || projectNegativePrompt
            ? '提交任务时按勾选状态附加项目级约束。'
            : '可在右侧项目信息中配置项目级提示词。'}
        </div>
      </div>
      {parameterFields.length > 0 && (
        <div className="canvas-form-row">
          <label>模型参数</label>
          <div className="canvas-param-grid">
            {parameterFields.map((field) => (
              <div key={field.name} className="canvas-param-field">
                <span title={field.description}>{field.title}</span>
                {field.enumValues.length > 0 ? (
                  <LobeSelect
                    value={modelParamDraft[field.name] || undefined}
                    allowClear
                    onChange={(value) => {
                      setModelParamDraft((prev) => ({
                        ...prev,
                        [field.name]: value == null ? '' : String(value),
                      }))
                    }}
                    options={field.enumValues.map((value) => ({ value, label: value }))}
                  />
                ) : field.type === 'boolean' ? (
                  <LobeSelect
                    value={modelParamDraft[field.name] || undefined}
                    allowClear
                    onChange={(value) => {
                      setModelParamDraft((prev) => ({
                        ...prev,
                        [field.name]: value == null ? '' : String(value),
                      }))
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
      <div className="canvas-form-row">
        <div className="canvas-form-label-row">
          <label>自定义参数</label>
          <Button
            size="small"
            icon={<Icons.Plus size={13} />}
            onClick={() => setCustomParams((prev) => [...prev, createCustomParamDraft()])}
          >
            添加
          </Button>
        </div>
        {customParams.length === 0 ? (
          <div className="canvas-param-empty">
            可添加模型私有参数，例如 google_search、seed、negative_prompt。
          </div>
        ) : (
          <div className="canvas-custom-param-list">
            {customParams.map((param) => (
              <div key={param.id} className="canvas-custom-param-row">
                <Input
                  value={param.name}
                  placeholder="字段名"
                  onChange={(e) =>
                    updateCustomParam(setCustomParams, param.id, { name: e.target.value })
                  }
                />
                <LobeSelect
                  value={param.type}
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
                  <LobeSelect
                    value={param.value || undefined}
                    placeholder="值"
                    allowClear
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
                    value={param.value}
                    placeholder={param.type === 'json' ? '{"key":"value"}' : '值'}
                    type={param.type === 'integer' || param.type === 'number' ? 'number' : 'text'}
                    onChange={(e) =>
                      updateCustomParam(setCustomParams, param.id, { value: e.target.value })
                    }
                  />
                )}
                <Button
                  size="small"
                  type="text"
                  icon={<Icons.Trash size={13} />}
                  aria-label="删除自定义参数"
                  onClick={() =>
                    setCustomParams((prev) => prev.filter((item) => item.id !== param.id))
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
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
            const modelParams = normalizeModelParamsForSubmit(
              {
                ...buildModelParams(parameterFields, modelParamDraft),
                ...buildCustomModelParams(customParams),
              },
              selectedCapability?.defaults ?? {},
            )
            const effectivePrompt = mergeProjectPrompt(
              prompt.trim() || fallbackPromptForOperation(operation),
              includeProjectPrompt ? projectPrompt : '',
            )
            const effectiveNegativePrompt = mergeNegativePrompt(
              negativePrompt,
              includeNegativePrompt ? projectNegativePrompt : '',
            )
            const effectiveInputTransport =
              inputTransport === 'auto'
                ? selectedModel?.providerKind === 'xai'
                  ? 'base64'
                  : 'cloud_url'
                : inputTransport
            const videoFrameNodeIds = supportsVideoFrameRoles
              ? normalizeVideoFrameNodeIds(
                  firstFrameNodeId,
                  lastFrameNodeId,
                  referenceFrameNodeIds,
                  videoFrameMaxImages,
                )
              : []
            const inputRoles = supportsVideoFrameRoles
              ? buildVideoFrameInputRoles(
                  videoFrameNodeIds,
                  firstFrameNodeId,
                  lastFrameNodeId,
                  referenceFrameNodeIds,
                )
              : undefined
            const inputNodeIds = supportsVideoFrameRoles
              ? buildTaskInputNodeIds(selectedNodes, videoFrameNodeIds)
              : undefined
            const payload: {
              operation: CanvasOperationType
              prompt: string
              negativePrompt?: string
              inputNodeIds?: string[]
              providerProfileId?: string
              manifestId?: string
              modelId?: string
              modelParams?: Record<string, unknown>
              inputTransport?: CanvasInputTransport
              inputRoles?: Record<string, CanvasTaskInputRole>
            } = {
              operation,
              prompt: effectivePrompt,
            }
            if (effectiveNegativePrompt) payload.negativePrompt = effectiveNegativePrompt
            if (selectedModel?.providerProfileId)
              payload.providerProfileId = selectedModel.providerProfileId
            if (selectedModel?.manifestId) payload.manifestId = selectedModel.manifestId
            if (selectedModel?.effectiveModelId) payload.modelId = selectedModel.effectiveModelId
            if (Object.keys(modelParams).length > 0) payload.modelParams = modelParams
            if (needsImageInput) payload.inputTransport = effectiveInputTransport
            if (inputNodeIds && inputNodeIds.length > 0) payload.inputNodeIds = inputNodeIds
            if (inputRoles && Object.keys(inputRoles).length > 0) payload.inputRoles = inputRoles
            writeComposerCacheEntry(cacheKey, {
              operation,
              modelKey: selectedModelKey || 'auto',
              modelParamDraft: pickDraftForFields(parameterFields, modelParamDraft),
              customParams: customParams.filter((param) => param.name.trim() && param.value.trim()),
              inputTransport,
            })
            if (selectedModelKey) writeLastModelKey(operation, selectedModelKey)
            onCreateTask(payload)
            setPrompt('')
            setNegativePrompt('')
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

function mergeProjectPrompt(prompt: string, projectPrompt: string): string {
  const trimmedPrompt = prompt.trim()
  const trimmedProjectPrompt = projectPrompt.trim()
  if (!trimmedProjectPrompt) return trimmedPrompt
  if (!trimmedPrompt) return `项目统一提示词：\n${trimmedProjectPrompt}`
  if (trimmedPrompt.includes(trimmedProjectPrompt)) return trimmedPrompt
  return `${trimmedPrompt}\n\n项目统一提示词：\n${trimmedProjectPrompt}`
}

function mergeNegativePrompt(negativePrompt: string, projectNegativePrompt: string): string {
  const trimmedNegativePrompt = negativePrompt.trim()
  const trimmedProjectNegativePrompt = projectNegativePrompt.trim()
  if (!trimmedProjectNegativePrompt) return trimmedNegativePrompt
  if (!trimmedNegativePrompt) return trimmedProjectNegativePrompt
  if (trimmedNegativePrompt.includes(trimmedProjectNegativePrompt)) return trimmedNegativePrompt
  return `${trimmedNegativePrompt}\n${trimmedProjectNegativePrompt}`
}

function buildPromptOptimizationPrompt(prompt: string, negativePrompt: string): string {
  const sections = [
    '请优化以下画布 AI 任务提示词，使其更清晰、可执行、包含必要约束，并保持用户原始意图。',
    `原提示词：\n${prompt.trim()}`,
  ]
  if (negativePrompt.trim()) {
    sections.push(`反向提示词：\n${negativePrompt.trim()}`)
  }
  sections.push('请只输出优化后的提示词正文。')
  return sections.join('\n\n')
}

function canRunFromInputOnly(operation: CanvasOperationType, nodes: CanvasNode[]): boolean {
  if (
    ![
      'image_to_image',
      'image_edit',
      'image_compose',
      'image_to_video',
      'video_edit',
      'audio_transcribe',
    ].includes(operation)
  ) {
    return false
  }
  const inputTypes = new Set(nodes.map((node) => node.type))
  if (operation === 'audio_transcribe') return inputTypes.has('audio')
  if (operation === 'video_edit') return inputTypes.has('video') || inputTypes.has('image')
  return inputTypes.has('image')
}

function operationNeedsImageInput(operation: CanvasOperationType): boolean {
  return ['image_to_image', 'image_edit', 'image_compose', 'image_to_video', 'video_edit'].includes(
    operation,
  )
}

function operationSupportsVideoFrameRoles(operation: CanvasOperationType): boolean {
  return operation === 'image_to_video' || operation === 'video_edit'
}

function videoImageLimitForCapability(
  operation: CanvasOperationType,
  capability: CanvasMediaModelSummary['capabilities'][number] | null,
): number {
  const maxImages = capability?.input?.maxImages
  if (typeof maxImages === 'number' && Number.isFinite(maxImages) && maxImages > 0) {
    return Math.max(1, Math.floor(maxImages))
  }
  if (operation === 'video_edit') return 2
  if (operation === 'image_to_video') return 1
  return 1
}

function fallbackPromptForOperation(operation: CanvasOperationType): string {
  if (operation === 'image_edit') return '请基于输入图片进行自然编辑，保持主体与画面质量。'
  if (operation === 'image_to_image') return '请基于输入图片生成一个高质量变体。'
  if (operation === 'image_compose') return '请将输入图片自然合成为一张高质量图片。'
  if (operation === 'image_to_video') return '请基于输入图片生成一段自然流畅的视频。'
  if (operation === 'video_edit') return '请基于输入视频和参考帧进行自然视频编辑。'
  if (operation === 'audio_transcribe') return '请转写输入音频内容。'
  return ''
}

function buildVideoFrameInputRoles(
  imageNodeIds: string[],
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
): Record<string, CanvasTaskInputRole> {
  const roles: Record<string, CanvasTaskInputRole> = {}
  const referenceIds = new Set(referenceFrameNodeIds)
  for (const nodeId of imageNodeIds) {
    if (nodeId === firstFrameNodeId) {
      roles[nodeId] = 'first_frame'
      continue
    }
    if (nodeId === lastFrameNodeId) {
      roles[nodeId] = 'last_frame'
      continue
    }
    if (referenceIds.has(nodeId)) roles[nodeId] = 'reference'
  }
  return roles
}

function normalizeVideoFrameNodeIds(
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
  maxImages: number,
): string[] {
  const result: string[] = []
  const push = (id: string) => {
    if (!id || result.includes(id) || result.length >= maxImages) return
    result.push(id)
  }
  push(firstFrameNodeId)
  push(lastFrameNodeId)
  for (const id of referenceFrameNodeIds) push(id)
  return result
}

function buildTaskInputNodeIds(selectedNodes: CanvasNode[], extraNodeIds: string[]): string[] {
  const result: string[] = []
  const push = (id: string) => {
    if (!id || result.includes(id)) return
    result.push(id)
  }
  for (const node of selectedNodes) push(node.id)
  for (const id of extraNodeIds) push(id)
  return result
}

function frameNodeLabel(node: CanvasNode, index: number, selected: boolean): string {
  const title = node.title?.trim() || `图片 ${index + 1}`
  return selected ? `${title} / 已选中` : title
}

type SchemaField = {
  name: string
  title: string
  type: string
  enumValues: string[]
  description?: string
  placeholder?: string
}

type CustomParamType = 'string' | 'number' | 'integer' | 'boolean' | 'json'

type CustomParamDraft = {
  id: string
  name: string
  type: CustomParamType
  value: string
}

type ComposerCacheEntry = {
  operation: CanvasOperationType
  modelKey: string
  modelParamDraft: Record<string, string>
  customParams: CustomParamDraft[]
  inputTransport: CanvasInputTransport
}

type ComposerCache = {
  entries?: Record<string, ComposerCacheEntry>
  lastModelByOperation?: Partial<Record<CanvasOperationType, string>>
}

function schemaFields(schema: Record<string, unknown>): SchemaField[] {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  return Object.entries(properties as Record<string, unknown>)
    .slice(0, 12)
    .map(([name, raw]) => {
      const spec =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {}
      const type = typeof spec.type === 'string' ? spec.type : 'string'
      const enumValues = Array.isArray(spec.enum)
        ? spec.enum
            .filter(
              (value) =>
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean',
            )
            .map((value) => String(value))
        : []
      const examples = Array.isArray(spec.examples)
        ? spec.examples.filter((value): value is string => typeof value === 'string')
        : []
      return {
        name,
        title: typeof spec.title === 'string' ? spec.title : name,
        type,
        enumValues,
        ...(typeof spec.description === 'string' ? { description: spec.description } : {}),
        ...(examples[0] ? { placeholder: examples[0] } : {}),
      }
    })
}

function operationSuggestedFields(operation: CanvasOperationType): SchemaField[] {
  if (['text_to_image', 'image_to_image', 'image_edit', 'image_compose'].includes(operation)) {
    return [
      {
        name: 'size',
        title: '图片尺寸 size',
        type: 'string',
        enumValues: ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792', '512x512'],
        description: 'OpenAI 兼容图像模型常用尺寸。',
      },
      {
        name: 'aspect_ratio',
        title: '比例 aspect_ratio',
        type: 'string',
        enumValues: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
        description: 'xAI、模板类图像模型常用画幅比例。',
      },
      {
        name: 'resolution',
        title: '清晰度 resolution',
        type: 'string',
        enumValues: ['auto', '1k', '2k'],
        description: '支持分辨率参数的图像模型会透传该值。',
      },
      {
        name: 'quality',
        title: '质量 quality',
        type: 'string',
        enumValues: ['auto', 'low', 'medium', 'high', 'standard', 'hd'],
      },
      {
        name: 'image_format',
        title: '格式 image_format',
        type: 'string',
        enumValues: ['png', 'jpeg', 'webp'],
      },
      {
        name: 'n',
        title: '数量 n',
        type: 'integer',
        enumValues: ['1', '2', '3', '4'],
      },
    ]
  }
  if (['text_to_video', 'image_to_video', 'video_edit'].includes(operation)) {
    const fields: SchemaField[] = [
      {
        name: 'aspectRatio',
        title: '视频比例 aspectRatio',
        type: 'string',
        enumValues: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      {
        name: 'durationSeconds',
        title: '时长 durationSeconds',
        type: 'integer',
        enumValues: ['3', '5', '8', '10'],
      },
      {
        name: 'quality',
        title: '质量 quality',
        type: 'string',
        enumValues: ['standard', 'high', '720p', '1080p'],
      },
      {
        name: 'seed',
        title: 'seed',
        type: 'integer',
        enumValues: [],
      },
    ]
    if (operation === 'video_edit') {
      fields.push({
        name: 'editStrength',
        title: '编辑强度 editStrength',
        type: 'number',
        enumValues: ['0.25', '0.5', '0.75'],
      })
    }
    return fields
  }
  if (operation === 'text_to_audio') {
    return [
      {
        name: 'voice',
        title: '音色 voice',
        type: 'string',
        enumValues: [
          'alloy',
          'ash',
          'ballad',
          'coral',
          'echo',
          'fable',
          'nova',
          'onyx',
          'sage',
          'shimmer',
        ],
      },
      {
        name: 'format',
        title: '格式 format',
        type: 'string',
        enumValues: ['mp3', 'wav', 'aac', 'flac', 'opus'],
      },
      {
        name: 'speed',
        title: '语速 speed',
        type: 'number',
        enumValues: ['0.75', '1', '1.25', '1.5'],
      },
    ]
  }
  if (operation === 'audio_transcribe') {
    return [
      {
        name: 'language',
        title: '语言 language',
        type: 'string',
        enumValues: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
      },
      {
        name: 'response_format',
        title: '格式 response_format',
        type: 'string',
        enumValues: ['json', 'text', 'srt', 'verbose_json', 'vtt'],
      },
    ]
  }
  return []
}

function modelSuggestedFields(model: CanvasMediaModelSummary | undefined): SchemaField[] {
  if (!model) return []
  const fingerprint = [model.manifestId, model.modelId, model.effectiveModelId, model.displayName]
    .join(' ')
    .toLowerCase()
  const fields: SchemaField[] = []

  if (
    fingerprint.includes('gemini') ||
    fingerprint.includes('imagen') ||
    fingerprint.includes('veo')
  ) {
    fields.push(
      {
        name: 'google_search',
        title: 'google_search',
        type: 'boolean',
        enumValues: [],
        description: 'Gemini / Google 系模型常见的搜索增强开关。',
      },
      {
        name: 'person_generation',
        title: 'person_generation',
        type: 'string',
        enumValues: ['allow_adult', 'dont_allow'],
        description: 'Google 图像模型人物生成策略。',
      },
    )
  }
  if (fingerprint.includes('gpt-image')) {
    fields.push(
      {
        name: 'quality',
        title: 'quality',
        type: 'string',
        enumValues: ['auto', 'low', 'medium', 'high'],
      },
      {
        name: 'background',
        title: 'background',
        type: 'string',
        enumValues: ['auto', 'transparent', 'opaque'],
      },
      { name: 'moderation', title: 'moderation', type: 'string', enumValues: ['auto', 'low'] },
    )
  }
  if (
    fingerprint.includes('seed') ||
    fingerprint.includes('kling') ||
    fingerprint.includes('wan') ||
    fingerprint.includes('pixverse') ||
    fingerprint.includes('hailuo') ||
    fingerprint.includes('minimax')
  ) {
    fields.push(
      {
        name: 'negative_prompt',
        title: 'negative_prompt',
        type: 'string',
        enumValues: [],
        placeholder: '不希望出现的内容',
      },
      {
        name: 'camera_control',
        title: 'camera_control',
        type: 'string',
        enumValues: [],
        placeholder: 'push_in / pull_out / pan_left ...',
      },
      { name: 'seed', title: 'seed', type: 'integer', enumValues: [] },
    )
  }
  if (model.capabilities.some((capability) => capability.id.startsWith('video.'))) {
    fields.push(
      {
        name: 'motion_strength',
        title: 'motion_strength',
        type: 'number',
        enumValues: [],
        placeholder: '0.5',
      },
      { name: 'fps', title: 'fps', type: 'integer', enumValues: [], placeholder: '24' },
    )
  }
  return fields
}

function mergeSchemaFields(
  baseFields: SchemaField[],
  ...suggestedFieldGroups: SchemaField[][]
): SchemaField[] {
  const seen = new Set<string>()
  const result: SchemaField[] = []
  for (const field of baseFields) {
    if (seen.has(field.name)) continue
    seen.add(field.name)
    result.push(field)
  }
  for (const field of suggestedFieldGroups.flat()) {
    const existingIndex = result.findIndex((item) => item.name === field.name)
    if (existingIndex >= 0) {
      const existing = result[existingIndex]
      if (!existing) continue
      result[existingIndex] = {
        ...field,
        ...existing,
        enumValues: existing.enumValues.length > 0 ? existing.enumValues : field.enumValues,
      }
      continue
    }
    seen.add(field.name)
    result.push(field)
  }
  return result.slice(0, 18)
}

function readComposerCache(): ComposerCache {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COMPOSER_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ComposerCache
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeComposerCache(cache: ComposerCache): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMPOSER_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 参数缓存不应影响创建任务。
  }
}

function composerCacheKey(operation: CanvasOperationType, modelKey: string): string {
  return `${operation}::${modelKey}`
}

function readComposerCacheEntry(key: string): ComposerCacheEntry | null {
  return readComposerCache().entries?.[key] ?? null
}

function writeComposerCacheEntry(key: string, entry: ComposerCacheEntry): void {
  const cache = readComposerCache()
  writeComposerCache({
    ...cache,
    entries: {
      ...(cache.entries ?? {}),
      [key]: entry,
    },
  })
}

function readLastModelKey(operation: CanvasOperationType): string | undefined {
  return readComposerCache().lastModelByOperation?.[operation]
}

function writeLastModelKey(operation: CanvasOperationType, modelKey: string): void {
  const cache = readComposerCache()
  writeComposerCache({
    ...cache,
    lastModelByOperation: {
      ...(cache.lastModelByOperation ?? {}),
      [operation]: modelKey,
    },
  })
}

function pickDraftForFields(
  fields: SchemaField[],
  draft: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const field of fields) {
    const value = draft[field.name]
    if (value != null && value.trim()) result[field.name] = value
  }
  return result
}

function createCustomParamDraft(): CustomParamDraft {
  return {
    id: `custom-param-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    type: 'string',
    value: '',
  }
}

function updateCustomParam(
  setCustomParams: Dispatch<SetStateAction<CustomParamDraft[]>>,
  id: string,
  patch: Partial<CustomParamDraft>,
) {
  setCustomParams((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
}

function buildModelParams(
  fields: SchemaField[],
  draft: Record<string, string>,
): Record<string, unknown> {
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

function buildCustomModelParams(drafts: CustomParamDraft[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const draft of drafts) {
    const name = draft.name.trim()
    const raw = draft.value.trim()
    if (!name || !raw) continue
    if (draft.type === 'integer') {
      const value = Number.parseInt(raw, 10)
      if (Number.isFinite(value)) params[name] = value
    } else if (draft.type === 'number') {
      const value = Number(raw)
      if (Number.isFinite(value)) params[name] = value
    } else if (draft.type === 'boolean') {
      params[name] = raw === 'true'
    } else if (draft.type === 'json') {
      try {
        params[name] = JSON.parse(raw)
      } catch {
        params[name] = raw
      }
    } else {
      params[name] = raw
    }
  }
  return params
}

function normalizeModelParamsForSubmit(
  params: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...params }
  const aspect = stringParam(next.aspectRatio) ?? stringParam(next.aspect_ratio)
  const size = stringParam(next.size)
  const defaultSize = stringParam(defaults.size)
  if (aspect && size && defaultSize && size === defaultSize) {
    delete next.size
  }
  return next
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
