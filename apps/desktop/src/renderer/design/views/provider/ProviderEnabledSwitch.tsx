import { useState } from 'react'
import { Switch } from 'antd'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'

export interface ProviderEnabledSwitchProps {
  providerId: string
  providerName: string
  enabled: boolean
  onChanged?: ((enabled: boolean) => void | Promise<void>) | undefined
}

/** Provider 卡片上的全局可用开关；主进程会广播配置变化供其他窗口刷新。 */
export function ProviderEnabledSwitch({
  providerId,
  providerName,
  enabled,
  onChanged,
}: ProviderEnabledSwitchProps) {
  const [saving, setSaving] = useState(false)
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { toast } = useToast()

  const handleChange = async (nextEnabled: boolean) => {
    if (saving || nextEnabled === enabled) return
    setSaving(true)
    try {
      await updateProvider({ id: providerId, enabled: nextEnabled })
      toast.success(`${providerName} 已${nextEnabled ? '启用' : '禁用'}`)
      await onChanged?.(nextEnabled)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Provider 状态更新失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <span
      className="pv_provider_switch"
      title={enabled ? '禁用后将从会话、画布和多媒体工具中移除' : '启用 Provider'}
      onClick={(event) => event.stopPropagation()}
    >
      <Switch
        size="small"
        checked={enabled}
        loading={saving}
        disabled={saving}
        onChange={(checked) => void handleChange(checked)}
        aria-label={`${enabled ? '禁用' : '启用'} Provider ${providerName}`}
      />
    </span>
  )
}
