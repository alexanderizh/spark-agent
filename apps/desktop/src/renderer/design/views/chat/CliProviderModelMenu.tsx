import type { CliSparkOverride, ProviderProfile, VendorMeta } from '@spark/protocol'
import { ProviderLogo } from '../../components/ProviderLogo'
import { ModelPickerMenuItem } from './ModelPickerMenuItem'
import { getProviderPickerLogoSize } from './provider-model-picker-utils'

export type CliSparkProviderGroup = {
  provider: ProviderProfile
  models: string[]
}

export function CliProviderModelMenu({
  primaryProvider,
  primaryModelId,
  primaryModelLabel,
  primarySelected,
  sparkOverride,
  providerGroups,
  disabled,
  isPinned,
  togglePinned,
  resolveVendor,
  getModelLabel,
  showPinActions = true,
  onSelectPrimaryModel,
  onSelectSparkModel,
  onClearSparkOverride,
}: {
  primaryProvider: ProviderProfile
  primaryModelId: string
  primaryModelLabel: string
  primarySelected: boolean
  sparkOverride: CliSparkOverride | null
  providerGroups: CliSparkProviderGroup[]
  disabled: boolean
  isPinned: (providerId: string, modelId: string) => boolean
  togglePinned: (providerId: string, modelId: string) => void
  resolveVendor: (provider: ProviderProfile) => VendorMeta | null
  getModelLabel: (provider: ProviderProfile, modelId: string) => string
  showPinActions?: boolean
  onSelectPrimaryModel: () => void
  onSelectSparkModel: (providerId: string, modelId: string) => void
  onClearSparkOverride: () => void
}) {
  const primaryVendor = resolveVendor(primaryProvider)
  const hostModelActive = primarySelected && sparkOverride == null

  return (
    <div className="composer-cli-model-group">
      <div className="composer-cli-model-parent" aria-label={`${primaryProvider.name} CLI`}>
        <span className="composer-model-group-title composer-cli-model-group-title">
          {primaryVendor && (
            <span className="composer-model-group-icon">
              <ProviderLogo
                vendor={primaryVendor}
                size={getProviderPickerLogoSize(primaryProvider)}
                shape="rounded"
              />
            </span>
          )}
          <span>{primaryProvider.name}</span>
        </span>
      </div>

      <div className="composer-cli-host-option" title={primaryModelLabel}>
        <ModelPickerMenuItem
          label="使用宿主机配置"
          active={hostModelActive}
          pinned={showPinActions && isPinned(primaryProvider.id, primaryModelId)}
          onSelect={() => {
            if (disabled) return
            if (primarySelected) onClearSparkOverride()
            else onSelectPrimaryModel()
          }}
          onTogglePin={() => {
            if (!disabled) togglePinned(primaryProvider.id, primaryModelId)
          }}
          showPin={showPinActions}
        />
      </div>

      {providerGroups.map(({ provider, models }) => {
        const vendor = resolveVendor(provider)
        return (
          <div key={provider.id} className="composer-cli-model-subgroup">
            <div className="composer-model-group-title">
              {vendor && (
                <span className="composer-model-group-icon">
                  <ProviderLogo vendor={vendor} size={12} shape="rounded" />
                </span>
              )}
              <span>{provider.name}</span>
            </div>
            {models.map((modelId) => {
              const active =
                primarySelected &&
                sparkOverride?.providerProfileId === provider.id &&
                sparkOverride.modelId === modelId
              return (
                <ModelPickerMenuItem
                  key={`${provider.id}:${modelId}`}
                  label={getModelLabel(provider, modelId)}
                  active={active}
                  pinned={showPinActions && isPinned(provider.id, modelId)}
                  onSelect={() => onSelectSparkModel(provider.id, modelId)}
                  onTogglePin={() => togglePinned(provider.id, modelId)}
                  showPin={showPinActions}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
