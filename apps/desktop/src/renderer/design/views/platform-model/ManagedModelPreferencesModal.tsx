import { useMemo, useState } from 'react'
import { Button, Checkbox, Modal, Select } from '@lobehub/ui'
import type { ProviderProfile } from '@spark/protocol'
import { useToast } from '../../components/Toast'
import './ManagedModelPreferencesModal.less'

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
  const [saving, setSaving] = useState(false)
  const available = useMemo(
    () => profile.availableModelIds?.length ? profile.availableModelIds : profile.modelIds,
    [profile],
  )

  const toggleModel = (model: string, enabled: boolean): void => {
    setSelected((current) => {
      if (enabled) return current.includes(model) ? current : [...current, model]
      if (current.length === 1) {
        toast.info('至少保留一个启用模型')
        return current
      }
      const next = current.filter(item => item !== model)
      if (model === defaultModel) setDefaultModel(next[0] ?? '')
      return next
    })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.spark.invoke('platform-model:update-model-preferences', {
        modelIds: selected,
        defaultModel,
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
      onCancel={onClose}
      footer={(
        <div className="managed-model-preferences__footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
        </div>
      )}
    >
      <div className="managed-model-preferences">
        <div className="managed-model-preferences__default">
          <span>默认模型</span>
          <Select
            value={defaultModel}
            options={selected.map(model => ({ label: model, value: model }))}
            onChange={value => setDefaultModel(String(value))}
          />
        </div>
        <div className="managed-model-preferences__list">
          {available.map(model => (
            <label key={model} className="managed-model-preferences__item">
              <Checkbox
                checked={selected.includes(model)}
                onChange={checked => toggleModel(model, Boolean(checked))}
              />
              <span>{model}</span>
              {model === defaultModel ? <small>默认</small> : null}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}
