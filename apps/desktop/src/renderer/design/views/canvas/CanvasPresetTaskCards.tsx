import { useState } from 'react'
import type { CanvasMediaModelSummary, ManagedAgent, ProviderProfile } from '@spark/protocol'

import { Icons } from '../../Icons'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { CanvasModelPicker } from './CanvasModelPicker'
import {
  CANVAS_PRESET_TASK_CARDS,
  isImageUnderstandingProvider,
  type CanvasPresetTaskCardDefinition,
} from './canvasPresetCenterModel'
import { type CanvasTaskDefaultKind, type CanvasTaskRuntimeDefault } from './canvasTaskDefaults'
import { mediaModelKey } from './canvasModelPickerModel'

type TaskDefaultsValue = Record<CanvasTaskDefaultKind, CanvasTaskRuntimeDefault>
type OpenPicker = 'text-agent' | 'text-model' | 'vision-model' | null

export type CanvasPresetTaskCardsProps = {
  value: TaskDefaultsValue
  agents: ManagedAgent[]
  providers: ProviderProfile[]
  imageModels: CanvasMediaModelSummary[]
  videoModels: CanvasMediaModelSummary[]
  loading: boolean
  onChange: (kind: CanvasTaskDefaultKind, value: CanvasTaskRuntimeDefault) => void
}

export function CanvasPresetTaskCards({
  value,
  agents,
  providers,
  imageModels,
  videoModels,
  loading,
  onChange,
}: CanvasPresetTaskCardsProps) {
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null)
  const textProviders = providers.filter(
    (provider) => provider.modelType === 'text' || provider.modelType === 'multimodal',
  )
  const visionProviders = providers.filter(isImageUnderstandingProvider)
  const textDefault = value.text
  const textMode: 'agent' | 'model' =
    textDefault.agentId || !textDefault.modelId ? 'agent' : 'model'

  const changeTextMode = (mode: 'agent' | 'model') => {
    if (mode === textMode) return
    if (mode === 'model') {
      const { agentId: _agentId, ...runtime } = textDefault
      onChange('text', runtime)
      return
    }
    const agent = agents[0]
    onChange('text', {
      ...(agent?.id ? { agentId: agent.id } : {}),
      ...(agent?.providerProfileId
        ? { providerProfileId: agent.providerProfileId }
        : textDefault.providerProfileId
          ? { providerProfileId: textDefault.providerProfileId }
          : {}),
      ...(agent?.modelId
        ? { modelId: agent.modelId }
        : textDefault.modelId
          ? { modelId: textDefault.modelId }
          : {}),
      skillIds: [...textDefault.skillIds],
    })
  }

  return (
    <div className="canvas-preset-task-grid">
      {CANVAS_PRESET_TASK_CARDS.map((card) => {
        const runtime = value[card.kind]
        const configured = hasRuntimeSelection(runtime)
        return (
          <section
            key={card.kind}
            className={`canvas-preset-task-card${configured ? ' is-configured' : ''}`}
            data-task-kind={card.kind}
          >
            <header className="canvas-preset-task-card-head">
              <span className="canvas-preset-task-icon">{taskIcon(card)}</span>
              <span className="canvas-preset-task-heading">
                <strong>{card.label}</strong>
                <small>{card.description}</small>
              </span>
              <span className="canvas-preset-task-status">
                {configured ? '已设置' : '使用平台推荐'}
              </span>
            </header>

            {card.kind === 'text' ? (
              <>
                <span className="canvas-preset-task-field-label">处理方式</span>
                <div
                  className="canvas-preset-execution-switch"
                  role="group"
                  aria-label="文本处理方式"
                >
                  <button
                    type="button"
                    className={textMode === 'agent' ? 'is-active' : ''}
                    aria-pressed={textMode === 'agent'}
                    onClick={() => changeTextMode('agent')}
                  >
                    交给 Agent
                  </button>
                  <button
                    type="button"
                    className={textMode === 'model' ? 'is-active' : ''}
                    aria-pressed={textMode === 'model'}
                    onClick={() => changeTextMode('model')}
                  >
                    直接用模型
                  </button>
                </div>
                <div className="canvas-preset-task-picker">
                  {textMode === 'agent' ? (
                    <AgentPickerInline
                      agents={agents}
                      selectedId={textDefault.agentId ?? ''}
                      fallbackLabel="选择 Agent"
                      disabled={loading || agents.length === 0}
                      open={openPicker === 'text-agent'}
                      onOpenChange={(open) => setOpenPicker(open ? 'text-agent' : null)}
                      onChange={(agentId) => {
                        const agent = agents.find((item) => item.id === agentId)
                        onChange('text', {
                          agentId,
                          ...(agent?.providerProfileId
                            ? { providerProfileId: agent.providerProfileId }
                            : {}),
                          ...(agent?.modelId ? { modelId: agent.modelId } : {}),
                          skillIds: [...textDefault.skillIds],
                        })
                      }}
                    />
                  ) : (
                    <ProviderModelPickerInline
                      providers={textProviders}
                      selectedProviderId={textDefault.providerProfileId ?? ''}
                      selectedModelId={textDefault.modelId ?? ''}
                      disabled={loading || textProviders.length === 0}
                      open={openPicker === 'text-model'}
                      onOpenChange={(open) => setOpenPicker(open ? 'text-model' : null)}
                      onChange={(providerProfileId, modelId) =>
                        onChange('text', {
                          providerProfileId,
                          modelId,
                          skillIds: [...textDefault.skillIds],
                        })
                      }
                    />
                  )}
                </div>
                <p className="canvas-preset-task-note">
                  {textMode === 'agent'
                    ? agentRuntimeNote(agents, textDefault)
                    : '适合只需要固定模型、不需要 Agent 工作流的任务'}
                </p>
              </>
            ) : card.kind === 'image_understanding' ? (
              <>
                <span className="canvas-preset-task-field-label">默认模型</span>
                <div className="canvas-preset-task-picker">
                  <ProviderModelPickerInline
                    providers={visionProviders}
                    selectedProviderId={runtime.providerProfileId ?? ''}
                    selectedModelId={runtime.modelId ?? ''}
                    disabled={loading || visionProviders.length === 0}
                    open={openPicker === 'vision-model'}
                    onOpenChange={(open) => setOpenPicker(open ? 'vision-model' : null)}
                    onChange={(providerProfileId, modelId) =>
                      onChange('image_understanding', {
                        providerProfileId,
                        modelId,
                        skillIds: [...runtime.skillIds],
                      })
                    }
                  />
                </div>
                <p className="canvas-preset-task-note">只显示支持图片输入的多模态模型</p>
              </>
            ) : (
              <>
                <span className="canvas-preset-task-field-label">默认模型</span>
                <div className="canvas-preset-task-picker">
                  <CanvasModelPicker
                    models={card.kind === 'image_generation' ? imageModels : videoModels}
                    value={resolveMediaModelValue(
                      card.kind === 'image_generation' ? imageModels : videoModels,
                      runtime,
                    )}
                    loading={loading}
                    disabled={
                      loading ||
                      (card.kind === 'image_generation' ? imageModels : videoModels).length === 0
                    }
                    allowEmpty
                    emptyLabel="自动选择可用模型"
                    onChange={(modelKey) =>
                      onChange(
                        card.kind,
                        runtimeFromMediaModel(
                          card.kind === 'image_generation' ? imageModels : videoModels,
                          modelKey,
                        ),
                      )
                    }
                  />
                </div>
                <p className="canvas-preset-task-note">
                  {card.kind === 'image_generation'
                    ? '尺寸和比例仍可在具体节点里调整'
                    : '时长和画幅仍可在具体节点里调整'}
                </p>
              </>
            )}
            {configured ? (
              <button
                type="button"
                className="canvas-preset-task-reset"
                onClick={() => onChange(card.kind, { skillIds: [] })}
              >
                恢复推荐
              </button>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function taskIcon(card: CanvasPresetTaskCardDefinition) {
  if (card.icon === 'vision') return <Icons.Eye size={18} />
  if (card.icon === 'image') return <Icons.ImagePlus size={18} />
  if (card.icon === 'video') return <Icons.Video size={18} />
  return <Icons.FileText size={18} />
}

function hasRuntimeSelection(runtime: CanvasTaskRuntimeDefault): boolean {
  return Boolean(
    runtime.agentId ||
    runtime.providerProfileId ||
    runtime.manifestId ||
    runtime.modelId ||
    runtime.skillIds.length > 0,
  )
}

function agentRuntimeNote(agents: ManagedAgent[], runtime: CanvasTaskRuntimeDefault): string {
  const agent = agents.find((item) => item.id === runtime.agentId)
  if (!agent) return agents.length === 0 ? '尚未配置可用 Agent' : '请选择负责文本任务的 Agent'
  const model = runtime.modelId ?? agent.modelId
  return model ? `该 Agent 当前使用 ${model}` : '模型跟随 Agent 自身设置'
}

function resolveMediaModelValue(
  models: CanvasMediaModelSummary[],
  runtime: CanvasTaskRuntimeDefault,
): string {
  const model = models.find(
    (item) =>
      (!runtime.providerProfileId || item.providerProfileId === runtime.providerProfileId) &&
      (!runtime.manifestId || item.manifestId === runtime.manifestId) &&
      (!runtime.modelId || item.effectiveModelId === runtime.modelId),
  )
  return model ? mediaModelKey(model) : ''
}

function runtimeFromMediaModel(
  models: CanvasMediaModelSummary[],
  modelKey: string,
): CanvasTaskRuntimeDefault {
  const model = models.find((item) => mediaModelKey(item) === modelKey)
  if (!model) return { skillIds: [] }
  return {
    ...(model.providerProfileId ? { providerProfileId: model.providerProfileId } : {}),
    ...(model.manifestId ? { manifestId: model.manifestId } : {}),
    ...(model.effectiveModelId ? { modelId: model.effectiveModelId } : {}),
    skillIds: [],
  }
}
