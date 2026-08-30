import { Button, Select } from '@lobehub/ui'
import { MEDIA_API_TYPES } from '@spark/protocol'
import type { MediaApiType, MediaProviderKind } from '@spark/protocol'

type MediaProviderOption = {
  label: string
  value: MediaProviderKind
}

export function ProviderMediaRoutingFields({
  templateConfigured,
  mediaProvider,
  mediaApiType,
  providerOptions,
  onConvertToCustom,
  onMediaProviderChange,
  onMediaApiTypeChange,
}: {
  templateConfigured: boolean
  mediaProvider: MediaProviderKind
  mediaApiType: MediaApiType
  providerOptions: MediaProviderOption[]
  onConvertToCustom: () => void
  onMediaProviderChange: (provider: MediaProviderKind) => void
  onMediaApiTypeChange: (apiType: MediaApiType) => void
}) {
  const providerLabel =
    providerOptions.find((option) => option.value === mediaProvider)?.label ?? mediaProvider
  const apiTypeLabel =
    mediaApiType === 'sync'
      ? 'sync 同步返回'
      : mediaApiType === 'async'
        ? 'async 任务轮询'
        : 'auto 自动兼容'

  if (templateConfigured) {
    return (
      <>
        <label className="pv_form_label">
          媒体调用配置
          <span className="pv_form_sub">跟随供应商模板自动切换</span>
        </label>
        <div className="pv_template_media_summary">
          <span className="pv_template_media_value">
            {providerLabel} · {apiTypeLabel}
          </span>
          <Button type="text" size="small" onClick={onConvertToCustom}>
            转为自定义配置
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <label className="pv_form_label">
        平台适配器
        <span className="pv_form_sub">决定默认的请求端点与异步轮询策略</span>
      </label>
      <Select
        value={mediaProvider}
        onChange={(value) => onMediaProviderChange(value as MediaProviderKind)}
        options={providerOptions}
      />

      <label className="pv_form_label">
        调用方式
        <span className="pv_form_sub">手动配置：sync 同步 / async 任务轮询 / auto 自动兼容</span>
      </label>
      <Select
        value={mediaApiType}
        onChange={(value) => onMediaApiTypeChange(value as MediaApiType)}
        options={MEDIA_API_TYPES.map((mode) => ({
          label:
            mode === 'sync'
              ? 'sync · 同步返回'
              : mode === 'async'
                ? 'async · 任务轮询'
                : 'auto · 自动兼容',
          value: mode,
        }))}
      />
    </>
  )
}
