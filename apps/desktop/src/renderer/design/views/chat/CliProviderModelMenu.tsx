import { Dropdown } from 'antd'
import type { CliSparkOverride, ProviderProfile, VendorMeta } from '@spark/protocol'
import { useMemo, useState } from 'react'
import { ProviderLogo } from '../../components/ProviderLogo'
import { Icons } from '../../Icons'
import { ModelPickerMenuItem } from './ModelPickerMenuItem'
import { getProviderPickerLogoSize } from './provider-model-picker-utils'

export type CliSparkProviderGroup = {
  provider: ProviderProfile
  models: string[]
}

// antd 的类型只声明了上下方向，但 rc-trigger 运行时支持 rightTop，正好适合 CLI 行的侧边菜单。
const CLI_SUBMENU_PLACEMENT = 'rightTop' as unknown as 'topRight'

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
  const [search, setSearch] = useState('')
  const primaryVendor = resolveVendor(primaryProvider)
  const hostModelActive = primarySelected && sparkOverride == null
  const normalizedSearch = search.trim().toLowerCase()
  const visibleProviderGroups = useMemo(() => {
    if (normalizedSearch.length === 0) return providerGroups
    return providerGroups
      .map(({ provider, models }) => {
        const vendorName = resolveVendor(provider)?.name ?? ''
        const providerMatches =
          provider.name.toLowerCase().includes(normalizedSearch) ||
          vendorName.toLowerCase().includes(normalizedSearch)
        return {
          provider,
          models: providerMatches
            ? models
            : models.filter(
                (modelId) =>
                  modelId.toLowerCase().includes(normalizedSearch) ||
                  getModelLabel(provider, modelId).toLowerCase().includes(normalizedSearch),
              ),
        }
      })
      .filter(({ models }) => models.length > 0)
  }, [getModelLabel, normalizedSearch, providerGroups, resolveVendor])

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

      <Dropdown
        menu={{ items: [] }}
        trigger={['hover']}
        placement={CLI_SUBMENU_PLACEMENT}
        disabled={disabled}
        align={{ offset: [4, 0], overflow: { shiftX: true, adjustY: true } }}
        getPopupContainer={() => document.body}
        onOpenChange={(open) => {
          if (!open) setSearch('')
        }}
        popupRender={() => (
          <div
            className="composer-dropdown-menu composer-cli-model-submenu"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composer-cli-model-submenu-search">
              <Icons.Search size={12} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 CLI 模型"
                aria-label="搜索 CLI 模型"
                autoFocus
              />
            </div>
            <div className="composer-cli-model-submenu-list">
              <button
                type="button"
                className={`composer-menu-item composer-cli-host-option${hostModelActive ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => {
                  if (primarySelected) onClearSparkOverride()
                  else onSelectPrimaryModel()
                }}
              >
                <span>使用宿主机配置</span>
                {hostModelActive && <Icons.Check size={14} />}
              </button>
              {visibleProviderGroups.map(({ provider, models }) => {
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
              {visibleProviderGroups.length === 0 && (
                <div className="composer-cli-model-submenu-empty">没有匹配结果</div>
              )}
            </div>
          </div>
        )}
      >
        <div className="composer-cli-model-trigger">
          <ModelPickerMenuItem
            label={primaryModelLabel}
            active={primarySelected}
            pinned={showPinActions && isPinned(primaryProvider.id, primaryModelId)}
            onSelect={onSelectPrimaryModel}
            onTogglePin={() => togglePinned(primaryProvider.id, primaryModelId)}
            showPin={showPinActions}
          />
          <span className="composer-cli-model-trigger-chevron" aria-hidden="true">
            <Icons.ChevronRight size={14} />
          </span>
        </div>
      </Dropdown>
    </div>
  )
}
