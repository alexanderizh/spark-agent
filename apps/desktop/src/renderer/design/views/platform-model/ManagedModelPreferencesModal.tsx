import { useMemo, useState } from 'react'
import { Button, Checkbox, Input, Modal, Select } from '@lobehub/ui'
import type { ProviderProfile } from '@spark/protocol'
import { PLATFORM_MANAGED_DEFAULT_CONTEXT_WINDOW } from '@spark/shared'
import { useToast } from '../../components/Toast'
import {
  CONTEXT_WINDOW_PRESETS,
  isCustomContextWindowValue,
  resolveContextWindowSelectValue,
} from '../../utils/context-window'
import './ManagedModelPreferencesModal.less'

const MIN_CONTEXT_WINDOW = 1_024
const MAX_CONTEXT_WINDOW = 10_000_000

function getAvailableModelIds(profile: ProviderProfile): string[] {
  return profile.availableModelIds?.length ? profile.availableModelIds : profile.modelIds
}

function buildInitialModelContextWindows(profile: ProviderProfile): Record<string, number> {
  const configured = profile.modelContextWindows ?? {}
  const fallback =
    profile.modelContextWindows == null &&
    typeof profile.contextWindow === 'number' &&
    profile.contextWindow > 0
      ? profile.contextWindow
      : PLATFORM_MANAGED_DEFAULT_CONTEXT_WINDOW
  return Object.fromEntries(
    getAvailableModelIds(profile).map((model) => [model, configured[model] ?? fallback]),
  )
}

function buildInitialCustomModels(profile: ProviderProfile): Record<string, boolean> {
  const values = buildInitialModelContextWindows(profile)
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => isCustomContextWindowValue(value))
      .map(([model]) => [model, true]),
  )
}

export function ManagedModelPreferencesModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: ProviderProfile
  onClose: () => void
  onSaved: () => void
}): React.ReactElement | null {
  const { toast } = useToast()
  const [selected, setSelected] = useState<string[]>(() => profile.modelIds)
  const [defaultModel, setDefaultModel] = useState(() => profile.defaultModel)
  const [modelContextWindows, setModelContextWindows] = useState<Record<string, number>>(() =>
    buildInitialModelContextWindows(profile),
  )
  const [customModels, setCustomModels] = useState<Record<string, boolean>>(() =>
    buildInitialCustomModels(profile),
  )
  const [saving, setSaving] = useState(false)
  const available = useMemo(() => getAvailableModelIds(profile), [profile])
  const imageModels = useMemo(
    () =>
      (profile.mediaModelRefs ?? []).map((ref) => ({
        id: ref.manifestId,
        name: ref.displayName ?? ref.modelId ?? ref.manifestId,
        enabled: ref.enabled !== false,
      })),
    [profile.mediaModelRefs],
  )

  const toggleModel = (model: string, enabled: boolean): void => {
    setSelected((current) => {
      if (enabled) return current.includes(model) ? current : [...current, model]
      if (current.length === 1) {
        toast.info('至少保留一个启用模型')
        return current
      }
      const next = current.filter((item) => item !== model)
      if (model === defaultModel) setDefaultModel(next[0] ?? '')
      return next
    })
  }

  const save = async (): Promise<void> => {
    const invalidModel = available.find((model) => {
      if (!customModels[model]) return false
      const value = modelContextWindows[model] ?? 0
      return !Number.isInteger(value) || value < MIN_CONTEXT_WINDOW || value > MAX_CONTEXT_WINDOW
    })
    if (invalidModel) {
      toast.error(
        `请为模型 ${invalidModel} 输入 ${MIN_CONTEXT_WINDOW.toLocaleString()}～${MAX_CONTEXT_WINDOW.toLocaleString()} 的整数`,
      )
      return
    }
    setSaving(true)
    try {
      await window.spark.invoke('platform-model:update-model-preferences', {
        modelIds: selected,
        defaultModel,
        modelContextWindows,
      })
      toast.success('本机模型显示偏好已保存')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="平台官方模型设置"
      width={620}
      className="managed-model-preferences-modal"
      onCancel={onClose}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          overflow: 'hidden',
          padding: 0,
        },
        footer: {
          flex: '0 0 auto',
        },
      }}
      footer={
        <div className="managed-model-preferences__footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </div>
      }
    >
      <div className="managed-model-preferences">
        <div className="managed-model-preferences__default">
          <span>默认模型</span>
          <Select
            value={defaultModel}
            options={selected.map((model) => ({ label: model, value: model }))}
            onChange={(value) => setDefaultModel(String(value))}
          />
        </div>
        <section className="managed-model-preferences__section">
          <div className="managed-model-preferences__section-title">对话模型</div>
          <div className="managed-model-preferences__table">
            <div className="managed-model-preferences__table-header">
              <span>启用</span>
              <span>模型</span>
              <span>上下文窗口</span>
            </div>
            {available.map((model) => (
              <div key={model} className="managed-model-preferences__row">
                <Checkbox
                  checked={selected.includes(model)}
                  onChange={(checked) => toggleModel(model, Boolean(checked))}
                />
                <span className="managed-model-preferences__model-name">
                  {model}
                  {model === defaultModel ? <small>默认</small> : null}
                </span>
                <div className="managed-model-preferences__context-window">
                  <Select
                    value={
                      customModels[model]
                        ? -1
                        : resolveContextWindowSelectValue(modelContextWindows[model] ?? 0)
                    }
                    options={CONTEXT_WINDOW_PRESETS.map((preset) =>
                      preset.value === 0 ? { ...preset, label: '默认 (1M)' } : preset,
                    )}
                    onChange={(value) => {
                      const next = Number(value)
                      if (next === -1) {
                        setCustomModels((current) => ({ ...current, [model]: true }))
                        setModelContextWindows((current) => ({
                          ...current,
                          [model]: (current[model] ?? 0) > 0 ? current[model]! : 200_000,
                        }))
                        return
                      }
                      setCustomModels((current) => {
                        const nextCustom = { ...current }
                        delete nextCustom[model]
                        return nextCustom
                      })
                      setModelContextWindows((current) => {
                        return {
                          ...current,
                          [model]: next === 0 ? PLATFORM_MANAGED_DEFAULT_CONTEXT_WINDOW : next,
                        }
                      })
                    }}
                  />
                  {customModels[model] ? (
                    <Input
                      type="number"
                      min={MIN_CONTEXT_WINDOW}
                      max={MAX_CONTEXT_WINDOW}
                      step={1024}
                      value={
                        (modelContextWindows[model] ?? 0) > 0
                          ? String(modelContextWindows[model])
                          : ''
                      }
                      placeholder="tokens"
                      onChange={(event) => {
                        const raw = Number((event.target as HTMLInputElement).value)
                        setModelContextWindows((current) => ({
                          ...current,
                          [model]:
                            Number.isFinite(raw) && raw > 0
                              ? Math.min(Math.floor(raw), MAX_CONTEXT_WINDOW)
                              : 0,
                        }))
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
        {imageModels.length > 0 ? (
          <section className="managed-model-preferences__section">
            <div className="managed-model-preferences__section-title">
              <span>图片模型</span>
              <small>由平台标签自动启用</small>
            </div>
            <div className="managed-model-preferences__list">
              {imageModels.map((model) => (
                <div
                  key={model.id}
                  className="managed-model-preferences__item managed-model-preferences__item--managed"
                >
                  <Checkbox checked={model.enabled} disabled />
                  <span>{model.name}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  )
}
