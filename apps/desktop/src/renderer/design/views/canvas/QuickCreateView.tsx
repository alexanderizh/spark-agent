import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import { AutoComplete, Input, Modal, Select, Spin, message } from 'antd'
import { Button } from '@lobehub/ui'
import type {
  CanvasMediaModelSummary,
  CanvasMediaTaskAsset,
  CanvasMediaTaskCreateResponse,
  CanvasMediaTaskInputFile,
  CanvasMediaTaskStreamPayload,
  CanvasTextTaskCreateResponse,
  CanvasTextTaskStreamPayload,
  ProviderProfile,
} from '@spark/protocol'
import {
  IMAGE_CAPABILITIES,
  VIDEO_CAPABILITIES,
  capabilityFor,
  operationFor,
  operationForSubmission,
  type QuickCreateInput,
} from './quickCreateCapability'
import { Icons } from '../../Icons'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { WindowControls } from '../../components/WindowControls'
import { useApp } from '../../AppContext'
import {
  getDataTransferFilePaths,
  hasFileDataTransfer,
  isUnresolvableFileDrop,
} from '../../services/composer-attachments'
import { canvasApi } from './canvas.api'
import { CanvasModelPicker } from './CanvasModelPicker'
import { CanvasParameterControl } from './CanvasParameterControl'
import {
  buildModelParams,
  mergeSchemaFields,
  modelSuggestedFields,
  operationDefaultModelParams,
  operationSuggestedFields,
  resolveInitialModelParamDraftValue,
  schemaFields,
  updateModelParamDraftValue,
} from './CanvasInlineAiComposer'
import {
  aspectRatioOptions,
  aspectRatioShape,
  isAspectRatioValue,
  parameterOptionValues,
  partitionParameterFields,
  type CanvasParameterPresentation,
} from './canvasParameterPresentation'
import {
  canvasParameterHistoryScope,
  readCanvasParameterHistory,
  recordCanvasCustomParameterHistory,
} from './canvasParameterHistory'
import { resolveMediaDisplayUrl } from './canvas-safe-file'
import { mediaModelKey } from './canvasModelPickerModel'
import { QuickCreateOutputPanel } from './QuickCreateOutputPanel'
import { QuickCreateTaskHistory } from './QuickCreateTaskHistory'
import {
  MODE_ITEMS,
  modeLabel,
  promptCoverFromTaskAssets,
  quickInputKindForPath,
  retryTaskRecord,
  selectQuickCreateInputPaths,
  titleForPrompt,
} from './quickCreateTaskPresentation'
import {
  quickCreateParamScope,
  readQuickCreateCustomSizeHistory,
  readQuickCreatePreferences,
  writeQuickCreatePreferences,
  type QuickCreatePreferences,
} from './quickCreatePreferences'
import { RemoteAssetImage } from '../../components/RemoteAssetImage'
import {
  readGlobalPromptLibrary,
  writeGlobalPromptLibrary,
  type GlobalPromptLibraryItem,
} from './canvasPromptLibraryStore'
import {
  readQuickCreateTasks,
  writeQuickCreateTasks,
  type QuickCreateMode,
  type QuickCreateTaskRecord,
} from './quickCreateTaskStore'
import {
  ensureQuickCreateTaskStreamSync,
  reconcileQuickCreateRunningTasks,
} from './quickCreateTaskStreamSync'
import { isQuickCreateWindowMode } from '../../../quickCreateWindowParams'
import './QuickCreateView.less'
import './QuickCreateWindow.less'

/** 快速创作表单输入素材，类型与能力选择模块共用。 */
type QuickInput = QuickCreateInput

const QUICK_CREATE_MAX_INPUT_BYTES = 72 * 1024 * 1024

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取剪贴板图片'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('无法读取剪贴板图片'))
    reader.readAsDataURL(blob)
  })
}

function quickParameterLabel(presentation: CanvasParameterPresentation): string {
  if (presentation.control === 'count') return '生成数量'
  return presentation.label.replace(
    /\s+(size|aspect_ratio|aspectRatio|resolution|quality|image_format|durationSeconds)$/i,
    '',
  )
}

function normalizedParameterName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isQualityPresentation(presentation: CanvasParameterPresentation): boolean {
  const name = normalizedParameterName(presentation.field.name)
  const label = presentation.label.toLowerCase()
  return name.includes('quality') || label.includes('质量')
}

function parameterOptionLabel(presentation: CanvasParameterPresentation, option: string): string {
  return presentation.field.enumLabels?.[option] ?? option
}

function parameterNumberBounds(field: CanvasParameterPresentation['field']): {
  minimum: number
  maximum: number
} {
  const options = parameterOptionValues(field)
    .map((option) => Number(option))
    .filter((option) => Number.isFinite(option))
  const minimum = field.minimum ?? (options.length > 0 ? Math.min(...options) : 1)
  const maximum = field.maximum ?? (options.length > 0 ? Math.max(...options) : 4)
  return {
    minimum: Math.min(minimum, maximum),
    maximum: Math.max(minimum, maximum),
  }
}

function QuickCreateQualityControl({
  presentation,
  value,
  onChange,
}: {
  presentation: CanvasParameterPresentation
  value: string
  onChange: (value: string) => void
}) {
  const options = parameterOptionValues(presentation.field).map((option) => ({
    value: option,
    label: parameterOptionLabel(presentation, option),
  }))
  return (
    <div className="canvas-parameter-control quick-create-quality-control">
      <div className="canvas-parameter-control-head">
        <span>{quickParameterLabel(presentation)}</span>
      </div>
      <Select
        aria-label={quickParameterLabel(presentation)}
        value={value || undefined}
        options={options}
        allowClear
        placeholder="默认"
        onChange={(next) => onChange(next == null ? '' : String(next))}
      />
    </div>
  )
}

function QuickCreateCountControl({
  presentation,
  value,
  onChange,
}: {
  presentation: CanvasParameterPresentation
  value: string
  onChange: (value: string) => void
}) {
  const { minimum, maximum } = parameterNumberBounds(presentation.field)
  const parsed = Number(value)
  const current = Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.round(parsed)))
    : minimum
  const commit = (raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next)) {
      onChange(String(current))
      return
    }
    onChange(String(Math.min(maximum, Math.max(minimum, Math.round(next)))))
  }
  return (
    <div className="canvas-parameter-control quick-create-count-control">
      <div className="canvas-parameter-control-head">
        <span>{quickParameterLabel(presentation)}</span>
      </div>
      <div className="quick-create-count-stepper" aria-label={quickParameterLabel(presentation)}>
        <button
          type="button"
          aria-label="减少生成数量"
          disabled={current <= minimum}
          onClick={() => onChange(String(current - 1))}
        >
          <Icons.Minus size={13} />
        </button>
        <input
          aria-label="生成数量"
          inputMode="numeric"
          min={minimum}
          max={maximum}
          step={1}
          type="number"
          value={value}
          placeholder={String(current)}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
        />
        <span>{presentation.unit ?? '张'}</span>
        <button
          type="button"
          aria-label="增加生成数量"
          disabled={current >= maximum}
          onClick={() => onChange(String(current + 1))}
        >
          <Icons.Plus size={13} />
        </button>
      </div>
    </div>
  )
}

function QuickCreateSizeOption({
  presentation,
  option,
  selected,
  onChange,
}: {
  presentation: CanvasParameterPresentation
  option: string
  selected: boolean
  onChange: (value: string) => void
}) {
  const shape = isAspectRatioValue(option) ? aspectRatioShape(option) : null
  return (
    <button
      type="button"
      className={`quick-create-size-option${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      title={parameterOptionLabel(presentation, option)}
      onClick={() => onChange(option)}
    >
      <span className="quick-create-size-frame-wrap">
        {shape ? (
          <span
            className={`quick-create-size-frame${shape.adaptive ? ' is-adaptive' : ''}`}
            style={{ width: shape.width, height: shape.height }}
          />
        ) : (
          <span className="quick-create-size-glyph" aria-hidden="true" />
        )}
      </span>
      <span>{parameterOptionLabel(presentation, option)}</span>
    </button>
  )
}

function QuickCreateSizeControl({
  presentation,
  value,
  customValueHistoryKey,
  legacyParameterScope,
  onChange,
}: {
  presentation: CanvasParameterPresentation
  value: string
  customValueHistoryKey?: string | undefined
  legacyParameterScope?: string | undefined
  onChange: (value: string) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const allOptions = [
    ...new Set(
      (presentation.control === 'size'
        ? parameterOptionValues(presentation.field)
        : aspectRatioOptions(presentation.field)) ?? [],
    ),
  ]
  const primaryOptions = allOptions.slice(0, 5)
  const moreOptions = allOptions.slice(5)
  const history = [
    ...new Set([
      ...readCanvasParameterHistory(customValueHistoryKey, presentation.field.name),
      ...(legacyParameterScope
        ? readQuickCreateCustomSizeHistory(legacyParameterScope, presentation.field.name)
        : []),
    ]),
  ]
  const historyOptions = history.filter((option) => !allOptions.includes(option))
  const hasMore = moreOptions.length > 0 || history.length > 0 || presentation.field.allowCustom
  const currentInMore = Boolean(value && !primaryOptions.includes(value))
  // 当前值落在折叠区（更多尺寸/自定义/历史）时自动展开，用户随后仍可手动收起
  const [prevCurrentInMore, setPrevCurrentInMore] = useState<boolean | null>(null)
  if (prevCurrentInMore !== currentInMore) {
    setPrevCurrentInMore(currentInMore)
    if (currentInMore) {
      setMoreOpen(true)
    }
  }
  const expanded = moreOpen
  const autoCompleteOptions = [...new Set([...allOptions, ...history])].map((option) => ({
    value: option,
    label: parameterOptionLabel(presentation, option),
  }))
  return (
    <div className="canvas-parameter-control quick-create-size-control">
      <div className="canvas-parameter-control-head">
        <span>{quickParameterLabel(presentation)}</span>
        <small>{value ? parameterOptionLabel(presentation, value) : '默认'}</small>
      </div>
      <div className="quick-create-size-grid" role="group" aria-label={presentation.label}>
        {primaryOptions.map((option) => (
          <QuickCreateSizeOption
            key={option}
            presentation={presentation}
            option={option}
            selected={option === value}
            onChange={onChange}
          />
        ))}
      </div>
      {hasMore && (
        <>
          <button
            type="button"
            className={`quick-create-size-more-toggle${expanded ? ' is-open' : ''}`}
            aria-expanded={expanded}
            onClick={() => setMoreOpen((current) => !current)}
          >
            <span>
              <Icons.ChevronDown size={12} />
              更多配置
            </span>
            {moreOptions.length > 0 && <small>{`+${moreOptions.length}`}</small>}
          </button>
          {expanded && (
            <div className="quick-create-size-more-panel">
              {moreOptions.length > 0 && (
                <div className="quick-create-size-more-options" role="group" aria-label="更多尺寸">
                  {moreOptions.map((option) => (
                    <QuickCreateSizeOption
                      key={option}
                      presentation={presentation}
                      option={option}
                      selected={option === value}
                      onChange={onChange}
                    />
                  ))}
                </div>
              )}
              {presentation.field.allowCustom && (
                <AutoComplete
                  className="quick-create-size-input"
                  aria-label="自定义或历史尺寸"
                  value={value || undefined}
                  options={autoCompleteOptions}
                  allowClear
                  placeholder="输入自定义尺寸，如 1536x1024"
                  onChange={(next) => onChange(next == null ? '' : String(next))}
                  filterOption={(input, option) =>
                    String(option?.value ?? option?.label ?? '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                />
              )}
              {historyOptions.length > 0 && (
                <div className="quick-create-size-history" aria-label="缓存尺寸">
                  <span>已使用</span>
                  {historyOptions.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={option === value ? 'is-selected' : ''}
                      onClick={() => onChange(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function QuickCreateParameterControl({
  presentation,
  value,
  customValueHistoryKey,
  legacyParameterScope,
  onChange,
}: {
  presentation: CanvasParameterPresentation
  value: string
  customValueHistoryKey?: string | undefined
  legacyParameterScope?: string | undefined
  onChange: (value: string) => void
}) {
  if (isQualityPresentation(presentation) && parameterOptionValues(presentation.field).length > 0) {
    return (
      <QuickCreateQualityControl presentation={presentation} value={value} onChange={onChange} />
    )
  }
  if (presentation.control === 'count') {
    return <QuickCreateCountControl presentation={presentation} value={value} onChange={onChange} />
  }
  if (presentation.control === 'size' || presentation.control === 'aspect-ratio') {
    return (
      <QuickCreateSizeControl
        presentation={presentation}
        value={value}
        customValueHistoryKey={customValueHistoryKey}
        legacyParameterScope={legacyParameterScope}
        onChange={onChange}
      />
    )
  }
  return (
    <CanvasParameterControl
      presentation={presentation}
      value={value}
      customValueHistoryKey={customValueHistoryKey}
      onChange={onChange}
    />
  )
}

function QuickCreateParameterPanel({
  fields,
  values,
  customValueHistoryKey,
  legacyParameterScope,
  onChange,
}: {
  fields: ReturnType<typeof schemaFields>
  values: Record<string, string>
  customValueHistoryKey?: string | undefined
  legacyParameterScope?: string | undefined
  onChange: (name: string, value: string) => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const groups = useMemo(() => {
    return partitionParameterFields(fields)
  }, [fields])
  const advancedSummary = useMemo(() => {
    const parts: string[] = []
    for (const presentation of groups.advanced) {
      const raw = values[presentation.field.name]?.trim()
      if (!raw) continue
      parts.push(
        `${quickParameterLabel(presentation)} ${presentation.field.enumLabels?.[raw] ?? raw}`,
      )
      if (parts.length >= 3) break
    }
    return parts.length > 0 ? parts.join(' · ') : '默认'
  }, [groups.advanced, values])
  if (fields.length === 0) return null
  return (
    <div className="quick-create-parameter-panel">
      <div className="quick-create-parameter-grid">
        {groups.common.map((presentation) => (
          <div
            className={`quick-create-parameter-cell${
              presentation.control === 'aspect-ratio' || presentation.control === 'size'
                ? ' is-wide'
                : ''
            }`}
            key={presentation.field.name}
          >
            <QuickCreateParameterControl
              presentation={presentation}
              value={values[presentation.field.name] ?? ''}
              customValueHistoryKey={customValueHistoryKey}
              legacyParameterScope={legacyParameterScope}
              onChange={(next) => onChange(presentation.field.name, next)}
            />
          </div>
        ))}
        {groups.advanced.length > 0 && (
          <button
            type="button"
            className={`quick-create-advanced-toggle${advancedOpen ? ' is-open' : ''}`}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <Icons.Sliders size={12} />
            <span className="quick-create-advanced-name">高级</span>
            <span className="quick-create-advanced-summary">{advancedSummary}</span>
            <Icons.ChevronDown size={12} className={advancedOpen ? 'is-open' : ''} />
          </button>
        )}
      </div>
      {advancedOpen && groups.advanced.length > 0 && (
        <div className="quick-create-parameter-grid is-advanced">
          {groups.advanced.map((presentation) => (
            <div
              className={`quick-create-parameter-cell${
                presentation.control === 'aspect-ratio' || presentation.control === 'size'
                  ? ' is-wide'
                  : ''
              }`}
              key={presentation.field.name}
            >
              <QuickCreateParameterControl
                presentation={presentation}
                value={values[presentation.field.name] ?? ''}
                customValueHistoryKey={customValueHistoryKey}
                legacyParameterScope={legacyParameterScope}
                onChange={(next) => onChange(presentation.field.name, next)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function now(): string {
  return new Date().toISOString()
}

function guessMimeType(filePath: string, kind: 'image' | 'video'): string {
  const extension = filePath.split('.').pop()?.toLowerCase()
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    m4v: 'video/x-m4v',
  }
  return byExtension[extension ?? ''] ?? `${kind}/*`
}

async function prepareInputFile(filePath: string, kind: 'image' | 'video'): Promise<QuickInput> {
  const mimeType = guessMimeType(filePath, kind)
  const saved = await window.spark.invoke('file:prepare-media-input', {
    sourcePath: filePath,
    kind,
  })
  if (saved.sizeBytes > QUICK_CREATE_MAX_INPUT_BYTES) {
    throw new Error('输入视频或图片不能超过 72MB')
  }
  return {
    id: `${Date.now()}-${saved.filePath}`,
    name: filePath.split(/[\\/]/).pop() || '输入素材',
    type: kind,
    role: 'input',
    path: saved.filePath,
    url: saved.fileUrl,
    mimeType,
    sizeBytes: saved.sizeBytes,
    previewUrl: saved.fileUrl,
  }
}

async function preparePastedImage(file: File, index: number): Promise<QuickInput> {
  if (file.size > QUICK_CREATE_MAX_INPUT_BYTES) {
    throw new Error('粘贴图片不能超过 72MB')
  }
  const dataUrl = await readBlobAsDataUrl(file)
  const saved = await window.spark.invoke('file:save-pasted-image', {
    dataUrl,
    suggestedBaseName: `quick-create-pasted-${index + 1}`,
    ...(file.type ? { mimeType: file.type } : {}),
  })
  return {
    id: `${Date.now()}-${index}-${saved.filePath}`,
    name: saved.fileName,
    type: 'image',
    role: 'input',
    path: saved.filePath,
    mimeType: file.type || 'image/png',
    sizeBytes: file.size,
    previewUrl: resolveMediaDisplayUrl({ filePath: saved.filePath }),
  }
}

/** 反推固定指令；用户在提示词框的补充文字会拼接在其后 */
const REVERSE_BASE_INSTRUCTION =
  '请分析输入图片并反推出可直接用于图片生成的详细提示词。输出主体、构图、镜头、光线、色彩、材质和风格，直接给出提示词，不要解释。'

function buildReversePrompt(extraInstruction: string): string {
  const extra = extraInstruction.trim()
  return extra ? `${REVERSE_BASE_INSTRUCTION}\n用户补充要求：${extra}` : REVERSE_BASE_INSTRUCTION
}

function quickInputFromTaskFile(file: CanvasMediaTaskInputFile, index: number): QuickInput {
  const source = file.path ?? file.url ?? ''
  return {
    ...file,
    id: `restored-${index}-${source}`,
    name: source.split(/[\\/]/).pop() || `输入素材 ${index + 1}`,
    previewUrl: resolveMediaDisplayUrl({ url: file.url, filePath: file.path }),
  }
}

export function QuickCreateView() {
  const { t } = useApp()
  const isStandaloneWindow = isQuickCreateWindowMode()
  const isSidebarHidden = t.sidebarHidden || isStandaloneWindow
  const [savedPreferences] = useState<QuickCreatePreferences>(() => readQuickCreatePreferences())
  const [activeTab, setActiveTab] = useState<'compose' | 'tasks'>('compose')
  const [mode, setMode] = useState<QuickCreateMode>(savedPreferences?.mode ?? 'image')
  const [prompt, setPrompt] = useState('')
  const [inputs, setInputs] = useState<QuickInput[]>([])
  const [tasks, setTasks] = useState<QuickCreateTaskRecord[]>(readQuickCreateTasks)
  const [models, setModels] = useState<CanvasMediaModelSummary[]>([])
  const [textProviders, setTextProviders] = useState<ProviderProfile[]>([])
  const [modelKey, setModelKey] = useState(savedPreferences?.modelKey ?? '')
  const [textProviderId, setTextProviderId] = useState(savedPreferences?.textProviderId ?? '')
  const [textModelId, setTextModelId] = useState(savedPreferences?.textModelId ?? '')
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [modelsLoading, setModelsLoading] = useState(true)
  const [promptLibrary, setPromptLibrary] = useState<GlobalPromptLibraryItem[]>([])
  const [promptPickerOpen, setPromptPickerOpen] = useState(false)
  const [promptSearch, setPromptSearch] = useState('')
  const [pendingSubmissions, setPendingSubmissions] = useState(0)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [dragOverForm, setDragOverForm] = useState(false)
  const [paramReadyScope, setParamReadyScope] = useState('')
  const taskIdsRef = useRef(new Set(tasks.map((task) => task.id)))
  const hydratingParamsRef = useRef(false)

  const updateTask = useCallback((id: string, patch: Partial<QuickCreateTaskRecord>) => {
    setTasks((current) => {
      const next = current.map((task) =>
        task.id === id ? { ...task, ...patch, updatedAt: now() } : task,
      )
      writeQuickCreateTasks(next)
      return next
    })
  }, [])

  // 任务进度订阅分两层：视图内订阅负责挂载期间的界面即时刷新；
  // 全局订阅随渲染进程常驻，负责切走视图期间后台完成任务的存储回写；
  // 挂载时再对账一次，纠正事件丢失（如应用重启）导致停在 running 的记录。
  useEffect(() => {
    ensureQuickCreateTaskStreamSync()
    void reconcileQuickCreateRunningTasks((id, patch) => updateTask(id, patch))
  }, [updateTask])

  const operation = operationFor(mode, inputs)
  const compatibleModels = useMemo(
    () =>
      models.filter((model) => {
        const candidate = capabilityFor(mode, inputs, model)
        return candidate != null && model.capabilities.some((item) => item.id === candidate)
      }),
    [inputs, mode, models],
  )
  const effectiveModelKey = compatibleModels.some((model) => mediaModelKey(model) === modelKey)
    ? modelKey
    : compatibleModels[0]
      ? mediaModelKey(compatibleModels[0])
      : ''
  const selectedModel = useMemo(
    () => models.find((model) => mediaModelKey(model) === effectiveModelKey),
    [effectiveModelKey, models],
  )
  const capabilityId = capabilityFor(mode, inputs, selectedModel)
  const selectedCapability = selectedModel?.capabilities.find((item) => item.id === capabilityId)
  const requestInputs = useMemo<CanvasMediaTaskInputFile[]>(
    () =>
      inputs.map((input, index) => {
        const role =
          mode === 'image'
            ? index === 0
              ? ('input' as const)
              : ('reference' as const)
            : capabilityId === 'video.reference_to_video' || capabilityId === 'video.generate'
              ? ('reference' as const)
              : input.type === 'video'
                ? ('input' as const)
                : index === 0
                  ? ('first_frame' as const)
                  : ('reference' as const)
        return { ...input, role }
      }),
    [capabilityId, inputs, mode],
  )
  const selectedTextProvider = useMemo(
    () => textProviders.find((provider) => provider.id === textProviderId) ?? textProviders[0],
    [textProviderId, textProviders],
  )
  const effectiveTextProviderId = selectedTextProvider?.id ?? ''
  const effectiveTextModelId =
    textModelId && selectedTextProvider?.modelIds.includes(textModelId)
      ? textModelId
      : (selectedTextProvider?.defaultModel ?? '')
  const fields = useMemo(
    () =>
      mode === 'reverse'
        ? []
        : mergeSchemaFields(
            schemaFields(selectedCapability?.paramSchema ?? {}),
            operationSuggestedFields(operation),
            modelSuggestedFields(selectedModel),
          ),
    [mode, operation, selectedCapability, selectedModel],
  )
  const parameterScope = useMemo(
    () =>
      quickCreateParamScope({
        operation,
        modelKey: effectiveModelKey,
        ...(capabilityId ? { capabilityId } : {}),
      }),
    [capabilityId, effectiveModelKey, operation],
  )
  const parameterHistoryKey = useMemo(
    () =>
      effectiveModelKey
        ? canvasParameterHistoryScope({
            operation,
            modelKey: effectiveModelKey,
            ...(capabilityId ? { capabilityId } : {}),
          })
        : undefined,
    [capabilityId, effectiveModelKey, operation],
  )
  const filteredPrompts = useMemo(() => {
    const keyword = promptSearch.trim().toLowerCase()
    return promptLibrary.filter(
      (item) =>
        !keyword ||
        `${item.title} ${item.text} ${item.tags.join(' ')}`.toLowerCase().includes(keyword),
    )
  }, [promptLibrary, promptSearch])
  const stats = useMemo(
    () => ({
      total: tasks.length,
      running: tasks.filter((task) => task.status === 'running').length,
      succeeded: tasks.filter((task) => task.status === 'succeeded').length,
    }),
    [tasks],
  )
  const focusedTask = useMemo(
    () => (focusedTaskId ? tasks.find((task) => task.id === focusedTaskId) : undefined),
    [focusedTaskId, tasks],
  )

  useEffect(() => {
    writeQuickCreatePreferences({
      ...readQuickCreatePreferences(),
      mode,
      ...(effectiveModelKey ? { modelKey: effectiveModelKey } : {}),
      ...(effectiveTextProviderId ? { textProviderId: effectiveTextProviderId } : {}),
      ...(effectiveTextModelId ? { textModelId: effectiveTextModelId } : {}),
    })
  }, [effectiveModelKey, effectiveTextModelId, effectiveTextProviderId, mode])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      Promise.all(
        IMAGE_CAPABILITIES.map((capability) =>
          canvasApi.listMediaModels({ capability, enabledOnly: true }),
        ),
      ),
      Promise.all(
        VIDEO_CAPABILITIES.map((capability) =>
          canvasApi.listMediaModels({ capability, enabledOnly: true }),
        ),
      ),
      window.spark.invoke('provider:list', { includeDisabled: false }),
      readGlobalPromptLibrary(),
    ])
      .then(([imageResults, videoResults, providerResult, library]) => {
        if (cancelled) return
        const nextModels = [...imageResults, ...videoResults]
          .flatMap((result) => result.models)
          .filter(
            (model, index, list) =>
              list.findIndex((candidate) => mediaModelKey(candidate) === mediaModelKey(model)) ===
              index,
          )
        setModels(nextModels)
        setTextProviders(
          providerResult.profiles.filter(
            (provider) =>
              provider.enabled !== false &&
              Boolean(provider.keystoreRef) &&
              provider.modelType === 'multimodal',
          ),
        )
        setPromptLibrary(library.items)
      })
      .catch((error) => {
        if (!cancelled) {
          setModels([])
          setTextProviders([])
          message.warning(error instanceof Error ? error.message : '快速创作配置加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    hydratingParamsRef.current = true
    const defaults: Record<string, unknown> = {
      ...operationDefaultModelParams(operation, selectedModel),
      ...(selectedCapability?.defaults ?? {}),
    }
    const cachedParams = readQuickCreatePreferences().paramsByScope?.[parameterScope] ?? {}
    const next: Record<string, string> = {}
    for (const field of fields) {
      const value = resolveInitialModelParamDraftValue({
        operation,
        field,
        fieldName: field.name,
        presetParams: {},
        existingParams: {},
        defaultParams: defaults,
      })
      const cachedValue = cachedParams[field.name]
      if (cachedValue) next[field.name] = cachedValue
      else if (value) next[field.name] = value
    }
    setModelParamDraft(next)
    setParamReadyScope(parameterScope)
  }, [fields, operation, parameterScope, selectedCapability, selectedModel])

  useEffect(() => {
    if (paramReadyScope !== parameterScope) return
    if (hydratingParamsRef.current) {
      hydratingParamsRef.current = false
      return
    }
    const current = readQuickCreatePreferences()
    writeQuickCreatePreferences({
      ...current,
      paramsByScope: {
        ...(current.paramsByScope ?? {}),
        [parameterScope]: modelParamDraft,
      },
    })
  }, [modelParamDraft, paramReadyScope, parameterScope])

  useEffect(() => {
    const unsubscribeMedia = window.spark.on(
      'stream:canvas:media-task',
      (payload: CanvasMediaTaskStreamPayload) => {
        if (!payload.clientTaskId || !taskIdsRef.current.has(payload.clientTaskId)) return
        const response = payload.response
        updateTask(payload.clientTaskId, {
          status:
            payload.status === 'running'
              ? 'running'
              : response.status === 'cancelled'
                ? 'cancelled'
                : response.status === 'succeeded'
                  ? 'succeeded'
                  : 'failed',
          ...(response.providerProfileId ? { providerProfileId: response.providerProfileId } : {}),
          ...(response.provider ? { providerName: response.provider } : {}),
          ...(response.model ? { modelId: response.model } : {}),
          ...(response.runtimeTaskId ? { runtimeTaskId: response.runtimeTaskId } : {}),
          ...(response.requestId ? { requestId: response.requestId } : {}),
          assets: response.assets,
          ...(response.error ? { error: response.error } : {}),
          ...(response.progress !== undefined ? { progress: response.progress } : {}),
        })
      },
    )
    const unsubscribeText = window.spark.on(
      'stream:canvas:text-task',
      (payload: CanvasTextTaskStreamPayload) => {
        if (!payload.clientTaskId || !taskIdsRef.current.has(payload.clientTaskId)) return
        const response = payload.response
        updateTask(payload.clientTaskId, {
          status: response.status === 'succeeded' ? 'succeeded' : 'failed',
          ...(response.providerProfileId ? { providerProfileId: response.providerProfileId } : {}),
          ...(response.provider ? { providerName: response.provider } : {}),
          ...(response.model ? { modelId: response.model } : {}),
          text: response.text,
          ...(response.error ? { error: response.error } : {}),
        })
      },
    )
    return () => {
      unsubscribeMedia()
      unsubscribeText()
    }
  }, [updateTask])

  const addTask = useCallback((task: QuickCreateTaskRecord) => {
    taskIdsRef.current.add(task.id)
    setTasks((current) => {
      const next = [task, ...current.filter((item) => item.id !== task.id)]
      writeQuickCreateTasks(next)
      return next
    })
  }, [])

  const handleChooseFiles = useCallback(
    async (filePaths: string[]) => {
      const selectedPaths = selectQuickCreateInputPaths(filePaths, mode)
      if (selectedPaths.length === 0) {
        message.warning(mode === 'video' ? '请选择图片或视频素材' : '请选择图片素材')
        return
      }
      if (mode === 'reverse' && selectedPaths.length > 1) {
        message.warning('图片反推仅支持一张输入图片')
        return
      }
      const limit = mode === 'reverse' ? 1 : 6
      try {
        const prepared = await Promise.all(
          selectedPaths
            .slice(0, limit)
            .map((filePath) => prepareInputFile(filePath, quickInputKindForPath(filePath))),
        )
        setInputs((current) =>
          mode === 'reverse' ? prepared.slice(0, 1) : [...current, ...prepared].slice(0, limit),
        )
        if (mode !== 'reverse') message.success(`已添加 ${prepared.length} 个素材`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '读取输入素材失败')
      }
    },
    [mode],
  )

  /** 拖入素材与粘贴同一语义：反推整组替换，其余模式追加并封顶 6 个 */
  const handleDropInput = useCallback(
    async (filePaths: string[]) => {
      const selectedPaths = selectQuickCreateInputPaths(filePaths, mode)
      if (selectedPaths.length === 0) {
        message.warning(mode === 'video' ? '仅支持拖入图片或视频素材' : '仅支持拖入图片素材')
        return
      }
      if (mode === 'reverse' && selectedPaths.length > 1) {
        message.warning('图片反推仅支持一张输入图片')
        return
      }
      const limit = mode === 'reverse' ? 1 : 6
      try {
        const prepared = await Promise.all(
          selectedPaths
            .slice(0, limit)
            .map((filePath) => prepareInputFile(filePath, quickInputKindForPath(filePath))),
        )
        setInputs((current) =>
          mode === 'reverse' ? prepared.slice(0, 1) : [...current, ...prepared].slice(0, limit),
        )
        message.success(`已添加 ${prepared.length} 个素材`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '读取拖入素材失败')
      }
    },
    [mode],
  )

  const dragDepthRef = useRef(0)

  const handleFormDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFileDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragOverForm(true)
  }, [])

  const handleFormDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFileDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleFormDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFileDataTransfer(event.dataTransfer)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOverForm(false)
  }, [])

  const handleFormDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasFileDataTransfer(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      dragDepthRef.current = 0
      setDragOverForm(false)
      const paths = getDataTransferFilePaths(event.dataTransfer)
      if (paths.length === 0) {
        if (isUnresolvableFileDrop(event.dataTransfer, paths)) {
          message.error('无法读取拖入的文件，请从访达或桌面拖拽本地文件')
        }
        return
      }
      void handleDropInput(paths)
    },
    [handleDropInput],
  )

  /** 拖拽落点不在表单时也要阻止默认行为，否则 Electron 会用窗口直接打开该文件 */
  const handleRootDragGuard = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (hasFileDataTransfer(event.dataTransfer)) event.preventDefault()
  }, [])

  const handlePasteInput = useCallback(
    async (event: ReactClipboardEvent<HTMLDivElement>) => {
      const imageItems = Array.from(event.clipboardData?.items ?? []).filter((item) =>
        item.type.startsWith('image/'),
      )
      if (imageItems.length === 0) return
      event.preventDefault()
      try {
        const pasted = await Promise.all(
          imageItems.slice(0, mode === 'reverse' ? 1 : 6).map((item, index) => {
            const file = item.getAsFile()
            return file ? preparePastedImage(file, index) : null
          }),
        )
        const prepared = pasted.filter((item): item is QuickInput => item != null)
        if (prepared.length === 0) return
        setInputs((current) =>
          mode === 'reverse' ? prepared.slice(0, 1) : [...current, ...prepared].slice(0, 6),
        )
        message.success(`已粘贴 ${prepared.length} 张图片`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '粘贴图片失败')
      }
    },
    [mode],
  )

  const handlePickFiles = useCallback(async () => {
    try {
      const picked = await window.spark.invoke('dialog:open-file', {
        title: mode === 'video' ? '选择图片或视频素材' : '选择输入图片',
        multiple: mode !== 'reverse',
        filters:
          mode === 'video'
            ? [
                {
                  name: '图片与视频',
                  extensions: [
                    'png',
                    'jpg',
                    'jpeg',
                    'webp',
                    'gif',
                    'bmp',
                    'heic',
                    'heif',
                    'mp4',
                    'mov',
                    'webm',
                    'm4v',
                  ],
                },
              ]
            : [
                {
                  name: '图片',
                  extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif'],
                },
              ],
      })
      const paths = picked.filePaths ?? (picked.filePath ? [picked.filePath] : [])
      if (!picked.canceled && paths.length > 0) await handleChooseFiles(paths)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开素材选择器失败')
    }
  }, [handleChooseFiles, mode])

  const handleModeChange = (nextMode: QuickCreateMode) => {
    setMode(nextMode)
    setPrompt('')
    setInputs([])
    setPromptPickerOpen(false)
  }

  const resetForm = useCallback(() => {
    const defaults: Record<string, unknown> = {
      ...operationDefaultModelParams(operation, selectedModel),
      ...(selectedCapability?.defaults ?? {}),
    }
    const nextParams: Record<string, string> = {}
    for (const field of fields) {
      const value = resolveInitialModelParamDraftValue({
        operation,
        field,
        fieldName: field.name,
        presetParams: {},
        existingParams: {},
        defaultParams: defaults,
      })
      if (value) nextParams[field.name] = value
    }
    setPrompt('')
    setInputs([])
    setPromptPickerOpen(false)
    setPromptSearch('')
    setModelParamDraft(nextParams)
  }, [fields, operation, selectedCapability, selectedModel])

  const savePromptToLibrary = useCallback(
    async (
      value: string,
      promptMode: QuickCreateMode,
      cover: { url: string; mimeType: string } | null,
    ) => {
      const text = value.trim()
      if (!text) {
        message.warning('请输入提示词后再保存')
        return
      }
      try {
        const library = await readGlobalPromptLibrary()
        const existing = library.items.find((item) => item.text.trim() === text)
        const timestamp = now()
        // 已有条目保留原封面；旧条目没存过封面时用本次产物图补上
        const coverPair = existing?.coverUrl
          ? { url: existing.coverUrl, mimeType: existing.coverMimeType }
          : cover
        const item: GlobalPromptLibraryItem = existing
          ? {
              ...existing,
              usageCount: existing.usageCount + 1,
              updatedAt: timestamp,
              coverUrl: coverPair?.url ?? null,
              coverMimeType: coverPair?.mimeType ?? null,
            }
          : {
              id: `quick-create-${Date.now()}`,
              title: titleForPrompt(text, promptMode),
              text,
              category: '快速创作',
              tags: [modeLabel(promptMode)],
              coverUrl: coverPair?.url ?? null,
              coverMimeType: coverPair?.mimeType ?? null,
              usageCount: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            }
        const next = existing
          ? library.items.map((candidate) => (candidate.id === existing.id ? item : candidate))
          : [item, ...library.items]
        await writeGlobalPromptLibrary({ ...library, items: next })
        setPromptLibrary(next)
        message.success(existing ? '已记录本次使用' : '已保存到提示词库')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '保存提示词失败')
      }
    },
    [],
  )

  const submitTask = useCallback(
    // 提交只入队任务，不改变右侧内容区的显示状态：在任务管理就留在任务管理，
    // 在创作结果就留在创作结果（focusedTaskId 更新让「创作结果」跟随最新任务）。
    async (source?: QuickCreateTaskRecord) => {
      const taskId =
        source?.id ?? `quick-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const taskMode = source?.mode ?? mode
      const taskPrompt = source?.prompt ?? prompt.trim()
      const taskInputs: Array<QuickInput | CanvasMediaTaskInputFile> =
        source?.inputFiles ?? requestInputs
      const taskCapability = source?.operation
        ? undefined
        : capabilityFor(taskMode, taskInputs as QuickInput[], selectedModel)
      // operation 需与能力一致（参考视频生视频记为 text_to_video），否则历史重试会按
      // video_edit 重新推导出 video.edit，导致仅支持参考能力的模型重试时无可路由能力。
      const taskOperation =
        source?.operation ??
        operationForSubmission(taskMode, taskInputs as QuickInput[], taskCapability)
      if (taskMode === 'reverse' && taskInputs.length !== 1) {
        message.warning('图片反推需要先选择一张图片')
        return
      }
      if (taskMode !== 'reverse' && !taskPrompt) {
        message.warning('请先输入提示词')
        return
      }
      const taskModel = source?.modelId ? undefined : selectedModel
      const params = source?.modelParams ?? buildModelParams(fields, modelParamDraft)
      const providerProfileId =
        source?.providerProfileId ??
        (taskMode === 'reverse' ? effectiveTextProviderId : taskModel?.providerProfileId)
      const modelId =
        source?.modelId ??
        (taskMode === 'reverse' ? effectiveTextModelId : taskModel?.effectiveModelId)
      const providerName = source?.providerName ?? taskModel?.providerName
      const modelName = source?.modelName ?? taskModel?.displayName
      const manifestId = source?.manifestId ?? taskModel?.manifestId
      const record: QuickCreateTaskRecord = {
        id: taskId,
        mode: taskMode,
        operation: taskOperation,
        prompt: taskPrompt,
        inputFiles: taskInputs.map((input) => {
          const { id: _id, name: _name, previewUrl: _previewUrl, ...file } = input as QuickInput
          return file
        }),
        ...(providerProfileId ? { providerProfileId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(providerName ? { providerName } : {}),
        ...(modelName ? { modelName } : {}),
        ...(manifestId ? { manifestId } : {}),
        modelParams: params,
        status: 'running',
        assets: [],
        createdAt: source?.createdAt ?? now(),
        updatedAt: now(),
      }
      addTask(record)
      setFocusedTaskId(taskId)
      setExpandedTaskId(taskId)
      setPendingSubmissions((current) => current + 1)
      let requestAccepted = false
      try {
        if (taskMode === 'reverse') {
          const response = (await window.spark.invoke('canvas:task:generate-text', {
            operation: 'image_prompt_reverse',
            prompt: buildReversePrompt(record.prompt),
            inputFiles: record.inputFiles,
            ...(record.providerProfileId ? { providerProfileId: record.providerProfileId } : {}),
            ...(record.modelId ? { modelId: record.modelId } : {}),
            waitForCompletion: false,
            clientTaskId: taskId,
          })) as CanvasTextTaskCreateResponse
          if (response.status !== 'running') {
            updateTask(taskId, {
              status: response.status === 'succeeded' ? 'succeeded' : 'failed',
              providerProfileId: response.providerProfileId,
              providerName: response.provider,
              modelId: response.model,
              text: response.text,
              ...(response.error ? { error: response.error } : {}),
            })
          }
        } else {
          const response = (await window.spark.invoke('canvas:task:create-media', {
            operation: taskOperation,
            prompt: record.prompt,
            inputFiles: record.inputFiles,
            ...(record.providerProfileId ? { providerProfileId: record.providerProfileId } : {}),
            ...(record.manifestId ? { manifestId: record.manifestId } : {}),
            ...(record.modelId ? { modelId: record.modelId } : {}),
            ...(taskCapability ? { capabilityId: taskCapability } : {}),
            ...(Object.keys(record.modelParams).length > 0
              ? { modelParams: record.modelParams }
              : {}),
            clientTaskId: taskId,
            waitForCompletion: false,
          })) as CanvasMediaTaskCreateResponse
          requestAccepted = response.status === 'running' || response.status === 'succeeded'
          if (response.status !== 'running') {
            updateTask(taskId, {
              status:
                response.status === 'succeeded'
                  ? 'succeeded'
                  : response.status === 'cancelled'
                    ? 'cancelled'
                    : 'failed',
              providerProfileId: response.providerProfileId,
              providerName: response.provider,
              modelId: response.model,
              ...(response.runtimeTaskId ? { runtimeTaskId: response.runtimeTaskId } : {}),
              ...(response.requestId ? { requestId: response.requestId } : {}),
              assets: response.assets,
              ...(response.error ? { error: response.error } : {}),
              ...(response.progress !== undefined ? { progress: response.progress } : {}),
            })
          } else {
            updateTask(taskId, {
              ...(response.providerProfileId || record.providerProfileId
                ? { providerProfileId: response.providerProfileId || record.providerProfileId }
                : {}),
              ...(response.provider || record.providerName
                ? { providerName: response.provider || record.providerName }
                : {}),
              ...(response.model || record.modelId
                ? { modelId: response.model || record.modelId }
                : {}),
              ...(response.runtimeTaskId ? { runtimeTaskId: response.runtimeTaskId } : {}),
              ...(response.requestId ? { requestId: response.requestId } : {}),
              ...(response.progress !== undefined ? { progress: response.progress } : {}),
            })
          }
        }
        if (!source && requestAccepted && taskMode !== 'reverse') {
          recordCanvasCustomParameterHistory(parameterHistoryKey, fields, params)
        }
        if (!source) {
          setPrompt((current) => (current.trim() === taskPrompt ? '' : current))
        }
      } catch (error) {
        updateTask(taskId, {
          status: 'failed',
          error: {
            code: 'ipc_error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
        message.error(error instanceof Error ? error.message : '提交创作任务失败')
      } finally {
        setPendingSubmissions((current) => Math.max(0, current - 1))
      }
    },
    [
      addTask,
      fields,
      mode,
      modelParamDraft,
      prompt,
      requestInputs,
      selectedModel,
      effectiveTextModelId,
      effectiveTextProviderId,
      parameterHistoryKey,
      updateTask,
    ],
  )

  const retryTask = useCallback(
    (task: QuickCreateTaskRecord) => {
      // 成功任务重试新建记录（复用原 id 会触发替换语义清掉旧产物）；
      // 失败/已取消任务无产物可丢失，维持原地替换。
      void submitTask(task.status === 'succeeded' ? retryTaskRecord(task) : task)
    },
    [submitTask],
  )

  const cancelTask = useCallback(
    async (task: QuickCreateTaskRecord) => {
      if (!task.runtimeTaskId) return
      try {
        await window.spark.invoke('canvas:task:cancel-media', { runtimeTaskId: task.runtimeTaskId })
        updateTask(task.id, { status: 'cancelled' })
      } catch (error) {
        message.error(error instanceof Error ? error.message : '取消任务失败')
      }
    },
    [updateTask],
  )

  const deleteTask = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId)
    Modal.confirm({
      title: '删除这条创作任务？',
      content:
        '将同时删除本次任务的输入拷贝与生成产物文件；你的原始文件和共享素材（如粘贴图）不会被删除。',
      okText: '删除任务',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        // 先按主进程白名单策略清理专属文件（产物 + quick-create-inputs 输入拷贝），再移除记录
        try {
          await window.spark.invoke('quick-create:cleanup-task-resources', {
            inputPaths: (task?.inputFiles ?? [])
              .map((input) => input.path)
              .filter((path): path is string => Boolean(path)),
            assetPaths: (task?.assets ?? [])
              .map((asset) => asset.filePath)
              .filter((path): path is string => Boolean(path)),
          })
        } catch (error) {
          message.warning(
            `产物文件清理失败，已仅移除任务记录：${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
        taskIdsRef.current.delete(taskId)
        setTasks((current) => {
          const next = current.filter((task) => task.id !== taskId)
          writeQuickCreateTasks(next)
          return next
        })
      },
    })
  }

  const openOutput = async (asset: CanvasMediaTaskAsset) => {
    if (!asset.filePath) {
      message.info('当前产物没有本地文件路径')
      return
    }
    try {
      const result = await window.spark.invoke('file:open', { filePath: asset.filePath })
      if (!result.opened) message.error(result.error ?? '打开产物失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开产物失败')
    }
  }

  const handleReuseTask = useCallback(
    (task: QuickCreateTaskRecord) => {
      setMode(task.mode)
      setPrompt(task.prompt)
      setInputs(task.inputFiles.map(quickInputFromTaskFile))
      const taskParams = Object.fromEntries(
        Object.entries(task.modelParams).map(([name, value]) => [name, String(value)]),
      )
      const reusedModel = task.modelId
        ? models.find(
            (candidate) =>
              candidate.effectiveModelId === task.modelId &&
              (task.manifestId == null || candidate.manifestId === task.manifestId),
          )
        : undefined
      const reusedModelKey = reusedModel ? mediaModelKey(reusedModel) : (task.modelId ?? '')
      const reusedCapability =
        task.mode === 'reverse'
          ? undefined
          : capabilityFor(task.mode, task.inputFiles.map(quickInputFromTaskFile), reusedModel)
      const reusedScope = quickCreateParamScope({
        operation: task.operation,
        modelKey: reusedModelKey,
        ...(reusedCapability ? { capabilityId: reusedCapability } : {}),
      })
      const preferences = readQuickCreatePreferences()
      writeQuickCreatePreferences({
        ...preferences,
        mode: task.mode,
        ...(reusedModelKey ? { modelKey: reusedModelKey } : {}),
        ...(task.mode === 'reverse' && task.providerProfileId
          ? { textProviderId: task.providerProfileId }
          : {}),
        ...(task.mode === 'reverse' && task.modelId ? { textModelId: task.modelId } : {}),
        paramsByScope: {
          ...(preferences.paramsByScope ?? {}),
          [reusedScope]: taskParams,
        },
      })
      setModelParamDraft(taskParams)
      if (task.mode === 'reverse') {
        setTextProviderId(task.providerProfileId ?? '')
        setTextModelId(task.modelId ?? '')
      } else if (reusedModel) {
        setModelKey(reusedModelKey)
      }
      // 复用只回填新草稿，不把被复用任务的旧产物继续显示在创作结果区。
      setFocusedTaskId(null)
      setActiveTab('compose')
      setExpandedTaskId(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [models],
  )

  const handleTaskRowActivate = useCallback((task: QuickCreateTaskRecord) => {
    setFocusedTaskId(task.id)
    setExpandedTaskId((current) => (current === task.id ? null : task.id))
  }, [])

  /** 反推结果一键转生图：反推出的提示词直接填入生图表单，开始新的文生图任务。 */
  const handleGenerateImageFromReverse = useCallback((task: QuickCreateTaskRecord) => {
    const text = task.text?.trim()
    if (!text) return
    setMode('image')
    setPrompt(text)
    setInputs([])
    setPromptPickerOpen(false)
    message.success('已用反推结果填充生图表单')
  }, [])

  const handleOpenStandaloneWindow = useCallback(async () => {
    try {
      const response = await window.spark.invoke('quick-create:window:open', {})
      if (!response.success) message.error('无法打开独立窗口，请稍后重试')
    } catch {
      message.error('无法打开独立窗口，请稍后重试')
    }
  }, [])

  /** 任务产物图一键转图编辑：产物图作为参考素材替换表单，进入图像编辑模式。 */
  const handleEditImageFromAsset = useCallback((asset: CanvasMediaTaskAsset) => {
    if (asset.type !== 'image') return
    const source = asset.filePath ?? asset.url ?? ''
    if (!source.trim()) {
      message.warning('当前图片没有可用的文件地址')
      return
    }
    const restored = quickInputFromTaskFile(
      {
        type: 'image',
        ...(asset.filePath ? { path: asset.filePath } : {}),
        ...(asset.url ? { url: asset.url } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      },
      0,
    )
    setMode('image')
    setInputs([{ ...restored, mimeType: restored.mimeType || 'image/png' }])
    setPrompt('')
    setPromptPickerOpen(false)
    message.success('已加入参考素材，当前按图像编辑处理')
  }, [])

  return (
    <div
      className="quick-create-view"
      onDragOver={handleRootDragGuard}
      onDrop={handleRootDragGuard}
    >
      <div
        className={`quick-create-tabbar${isSidebarHidden ? ' is-sidebar-hidden' : ''}`}
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <div className="quick-create-brand">
          <span className="quick-create-brand-mark">
            <Icons.Image size={16} />
          </span>
          <strong>快速创作</strong>
          <span>图片与视频</span>
        </div>
        <div className="quick-create-header-actions">
          {!isStandaloneWindow && (
            <button
              type="button"
              className="quick-create-window-open-button"
              aria-label="在独立窗口中打开快速创作"
              title="在独立窗口中打开"
              onClick={() => void handleOpenStandaloneWindow()}
            >
              <Icons.ExternalLink size={15} />
            </button>
          )}
          <nav className="quick-create-tabs" aria-label="快速创作任务">
            <button type="button" onClick={() => setActiveTab('tasks')}>
              <Icons.ListTodo size={14} /> 任务管理
              {stats.running > 0 && <small>{stats.running}</small>}
            </button>
          </nav>
          {isStandaloneWindow && <WindowControls />}
        </div>
      </div>

      <main className="quick-create-main">
        <section className="quick-create-workbench" aria-label="创作配置与输出">
          <div
            className={`quick-create-form-pane${dragOverForm ? ' is-drag-over' : ''}`}
            onDragEnter={handleFormDragEnter}
            onDragOver={handleFormDragOver}
            onDragLeave={handleFormDragLeave}
            onDrop={handleFormDrop}
          >
            <div className="quick-create-mode-rail" role="tablist" aria-label="创作模式">
              <div className="quick-create-mode-segment">
                {MODE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === item.id}
                    className={`quick-create-mode${mode === item.id ? ' is-active' : ''}`}
                    onClick={() => handleModeChange(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="quick-create-mode-note">
                {mode === 'reverse'
                  ? '上传 1 张图片，可补充文字要求，反推可编辑提示词'
                  : mode === 'image'
                    ? inputs.length > 0
                      ? '已添加参考素材，当前按图像编辑处理'
                      : '添加参考素材后自动切换为图像编辑'
                    : '可添加首帧或参考素材生成视频'}
              </span>
            </div>

            {/* 粘贴监听挂在整个表单：焦点在提示词、素材区或任意控件时粘贴图片都能作为素材加入 */}
            <div className="quick-create-form" onPaste={(event) => void handlePasteInput(event)}>
              <section className="quick-create-reference-section" aria-label="参考素材">
                <div className="quick-create-section-head">
                  <div>
                    <strong>{mode === 'reverse' ? '输入图片' : '参考素材'}</strong>
                    <span>
                      {mode === 'reverse'
                        ? '支持粘贴或从本地选择，反推可编辑提示词'
                        : '可选 · 支持粘贴或从本地选择'}
                    </span>
                  </div>
                  <small>
                    {inputs.length}/{mode === 'reverse' ? 1 : 6}
                  </small>
                </div>
                <div
                  className="quick-create-input-zone"
                  role="group"
                  aria-label={
                    mode === 'reverse'
                      ? '输入图片，仅支持 1 张，可直接粘贴'
                      : '参考素材，可选，可直接粘贴图片'
                  }
                >
                  <div className="quick-create-input-list">
                    {inputs.map((input) => (
                      <div className="quick-create-input-chip" key={input.id}>
                        {input.type === 'video' ? (
                          <video src={input.previewUrl} muted />
                        ) : (
                          <img src={input.previewUrl} alt={input.name} />
                        )}
                        <span>{input.name}</span>
                        <button
                          type="button"
                          aria-label={`移除 ${input.name}`}
                          onClick={() =>
                            setInputs((current) => current.filter((item) => item.id !== input.id))
                          }
                        >
                          <Icons.X size={12} />
                        </button>
                      </div>
                    ))}
                    {(mode !== 'reverse' || inputs.length === 0) && (
                      <button
                        type="button"
                        className="quick-create-input-add"
                        aria-label="添加素材，也可直接粘贴"
                        onClick={() => void handlePickFiles()}
                      >
                        <Icons.ImagePlus size={17} />
                        <span>添加素材</span>
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <div className="quick-create-prompt-wrap">
                <div className="quick-create-prompt-head">
                  <div>
                    <strong>{mode === 'reverse' ? '反推要求' : '提示词'}</strong>
                    <span>
                      {mode === 'reverse'
                        ? '可选 · 补充反推侧重点'
                        : mode === 'video'
                          ? '描述主体、动作、镜头与氛围'
                          : '描述主体、构图、光线与风格'}
                    </span>
                  </div>
                  {mode !== 'reverse' && (
                    <div className="quick-create-prompt-tools">
                      <button
                        type="button"
                        title="从提示词库插入"
                        aria-label="从提示词库插入"
                        onClick={() => {
                          setPromptPickerOpen(true)
                          setPromptSearch('')
                        }}
                      >
                        <Icons.Book size={14} />
                        <span>提示词库</span>
                      </button>
                    </div>
                  )}
                </div>
                <textarea
                  id="quick-create-prompt"
                  className="quick-create-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  aria-label={mode === 'reverse' ? '反推补充要求' : '提示词'}
                  placeholder={
                    mode === 'reverse'
                      ? '可选：补充反推侧重点，例如「重点描述人物服装与光线」，留空则输出完整提示词'
                      : mode === 'video'
                        ? '描述主体、动作、镜头运动和时长，例如：雨夜街头，霓虹倒影，镜头缓慢推进…'
                        : '描述主体、构图、光线和风格，例如：清晨窗边的产品静物，柔和侧光…'
                  }
                />
                <div className="quick-create-prompt-meta">
                  <span>
                    {mode === 'reverse'
                      ? '补充要求会与固定反推指令一起发送'
                      : '建议先写清主体，再补充环境、构图和风格'}
                  </span>
                  <small>{prompt.length} 字</small>
                </div>
              </div>
              {promptPickerOpen && mode !== 'reverse' && (
                <Modal
                  open
                  width={720}
                  centered
                  footer={null}
                  title="提示词库"
                  className="quick-create-prompt-library-modal"
                  closeIcon={<Icons.X size={15} />}
                  onCancel={() => setPromptPickerOpen(false)}
                >
                  <div className="quick-create-library-body">
                    <p className="quick-create-library-hint">
                      选择后会替换当前提示词 · 共 {promptLibrary.length} 条
                    </p>
                    <Input
                      prefix={<Icons.Search size={14} />}
                      value={promptSearch}
                      onChange={(event) => setPromptSearch(event.target.value)}
                      placeholder="搜索标题、内容或标签"
                      allowClear
                    />
                    <div className="quick-create-library-grid">
                      {filteredPrompts.length === 0 ? (
                        <span className="quick-create-picker-empty">还没有匹配的提示词</span>
                      ) : (
                        filteredPrompts.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="quick-create-library-card"
                            title={item.text}
                            onClick={() => {
                              setPrompt(item.text)
                              setPromptPickerOpen(false)
                            }}
                          >
                            <span className="quick-create-library-card-cover">
                              {item.coverUrl ? (
                                <RemoteAssetImage src={item.coverUrl} alt="" />
                              ) : (
                                <span className="quick-create-library-card-fallback">
                                  {item.title.trim().slice(0, 2) || '提示'}
                                </span>
                              )}
                            </span>
                            <span className="quick-create-library-card-body">
                              <strong>{item.title}</strong>
                              <small>{item.text}</small>
                              <em>{item.usageCount} 次使用</em>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </Modal>
              )}

              {mode === 'reverse' ? (
                <div className="quick-create-control-row quick-create-text-model-row">
                  <label htmlFor="quick-create-provider">视觉理解模型</label>
                  <Select
                    id="quick-create-provider"
                    value={effectiveTextProviderId || undefined}
                    placeholder="选择 Provider"
                    options={textProviders.map((provider) => ({
                      label: provider.name,
                      value: provider.id,
                    }))}
                    onChange={(value) => {
                      setTextProviderId(value ?? '')
                      const provider = textProviders.find((item) => item.id === value)
                      setTextModelId(provider?.defaultModel ?? '')
                    }}
                  />
                  <Select
                    aria-label="选择视觉理解模型"
                    value={effectiveTextModelId || undefined}
                    placeholder="选择模型"
                    options={(
                      textProviders.find((provider) => provider.id === textProviderId)?.modelIds ??
                      []
                    ).map((model) => ({ label: model, value: model }))}
                    onChange={(value) => setTextModelId(value ?? '')}
                  />
                </div>
              ) : (
                <>
                  <div className="quick-create-control-row">
                    <div className="quick-create-model-control">
                      {modelsLoading ? (
                        <Spin size="small" />
                      ) : (
                        <CanvasModelPicker
                          models={compatibleModels}
                          value={effectiveModelKey}
                          loading={modelsLoading}
                          onChange={setModelKey}
                        />
                      )}
                    </div>
                    {!modelsLoading && !selectedModel && (
                      <span className="quick-create-capability-hint">
                        暂无匹配的已启用模型，请先到模型服务配置
                      </span>
                    )}
                  </div>
                  <QuickCreateParameterPanel
                    fields={fields}
                    values={modelParamDraft}
                    customValueHistoryKey={parameterHistoryKey}
                    legacyParameterScope={parameterScope}
                    onChange={(name, value) =>
                      setModelParamDraft((current) =>
                        updateModelParamDraftValue(current, name, value),
                      )
                    }
                  />
                </>
              )}

              <div className="quick-create-submit-row">
                {pendingSubmissions > 0 && (
                  <span className="quick-create-submit-status" aria-live="polite">
                    <Icons.ListTodo size={13} />
                    {pendingSubmissions} 个任务提交中
                  </span>
                )}
                <div className="quick-create-submit-actions">
                  <Button type="default" className="quick-create-reset-button" onClick={resetForm}>
                    重置
                  </Button>
                  <Button
                    type="primary"
                    className="quick-create-generate-button"
                    disabled={
                      modelsLoading || (mode === 'reverse' ? inputs.length !== 1 : !prompt.trim())
                    }
                    onClick={() => void submitTask()}
                  >
                    <Icons.Play size={13} /> 生成
                  </Button>
                </div>
              </div>
            </div>
            {dragOverForm && (
              <div className="quick-create-drop-hint" aria-hidden="true">
                <span>松开以添加素材</span>
              </div>
            )}
          </div>
          <div className="quick-create-result-pane">
            <div className="quick-create-result-heading">
              <div>
                <strong>输出</strong>
                <span>
                  {activeTab === 'tasks'
                    ? `${tasks.length} 条记录`
                    : focusedTask
                      ? '当前任务'
                      : '等待生成'}
                </span>
              </div>
            </div>
            <div className="quick-create-result-tabs" role="tablist" aria-label="创作结果与历史">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'compose'}
                className={activeTab === 'compose' ? 'is-active' : ''}
                onClick={() => setActiveTab('compose')}
              >
                <Icons.Image size={16} /> 创作结果
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'tasks'}
                className={activeTab === 'tasks' ? 'is-active' : ''}
                onClick={() => setActiveTab('tasks')}
              >
                <Icons.History size={16} /> 创作历史
                {stats.running > 0 && <small>{stats.running}</small>}
              </button>
            </div>
            {activeTab === 'compose' ? (
              <QuickCreateOutputPanel key={focusedTask?.id ?? 'empty'} task={focusedTask} />
            ) : (
              <QuickCreateTaskHistory
                tasks={tasks}
                expandedTaskId={expandedTaskId}
                onRowActivate={handleTaskRowActivate}
                onReuse={handleReuseTask}
                onCancel={(task) => void cancelTask(task)}
                onRetry={retryTask}
                onDelete={deleteTask}
                onOpenOutput={(asset) => void openOutput(asset)}
                onSavePrompt={(task) =>
                  void savePromptToLibrary(
                    task.prompt,
                    task.mode,
                    promptCoverFromTaskAssets(task.assets),
                  )
                }
                onGenerateImage={handleGenerateImageFromReverse}
                onEditImage={handleEditImageFromAsset}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
