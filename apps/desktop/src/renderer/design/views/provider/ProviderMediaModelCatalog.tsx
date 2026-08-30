import { useMemo, useState } from 'react'
import { Button, Checkbox, Input, Tag } from '@lobehub/ui'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { filterProviderMediaModels } from './providerMediaModelCatalogFilter'
import './ProviderMediaModelCatalog.less'

type ProviderMediaModelCatalogProps = {
  models: CanvasMediaModelSummary[]
  loading: boolean
  isChatModel: boolean
  selectedManifestIds: ReadonlySet<string>
  defaultModel: string
  onToggleModel: (model: CanvasMediaModelSummary, checked: boolean) => void
  onSetDefaultModel: (modelId: string) => void
}

export function ProviderMediaModelCatalog({
  models,
  loading,
  isChatModel,
  selectedManifestIds,
  defaultModel,
  onToggleModel,
  onSetDefaultModel,
}: ProviderMediaModelCatalogProps) {
  const [query, setQuery] = useState('')
  const filteredModels = useMemo(() => filterProviderMediaModels(models, query), [models, query])
  const hasQuery = query.trim().length > 0

  const visibleSelectedCount = useMemo(
    () => filteredModels.reduce((count, model) => (selectedManifestIds.has(model.manifestId) ? count + 1 : count), 0),
    [filteredModels, selectedManifestIds],
  )
  const allVisibleSelected = filteredModels.length > 0 && visibleSelectedCount === filteredModels.length
  const noneVisibleSelected = visibleSelectedCount === 0
  const selectAllDisabled = loading || filteredModels.length === 0 || allVisibleSelected
  const deselectAllDisabled = loading || filteredModels.length === 0 || noneVisibleSelected

  const handleSelectAll = () => {
    filteredModels.forEach((model) => {
      if (!selectedManifestIds.has(model.manifestId)) {
        onToggleModel(model, true)
      }
    })
  }
  const handleDeselectAll = () => {
    filteredModels.forEach((model) => {
      if (selectedManifestIds.has(model.manifestId)) {
        onToggleModel(model, false)
      }
    })
  }

  return (
    <div className="pv_media_catalog">
      <div className="pv_media_catalog_search">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模型名称、模型 ID 或能力"
          aria-label="搜索模型清单"
          prefix={<Icons.Search size={14} />}
          allowClear
          disabled={loading || models.length === 0}
        />
        <div className="pv_media_catalog_bulk">
          <Button
            size="small"
            type="text"
            onClick={handleSelectAll}
            disabled={selectAllDisabled}
            aria-label="全选当前可见模型"
            title="全选当前可见模型"
          >
            全选
          </Button>
          <Button
            size="small"
            type="text"
            onClick={handleDeselectAll}
            disabled={deselectAllDisabled}
            aria-label="全不选当前可见模型"
            title="全不选当前可见模型"
          >
            全不选
          </Button>
        </div>
        {hasQuery && !loading && (
          <span className="pv_media_catalog_count" aria-live="polite">
            {filteredModels.length} / {models.length}
          </span>
        )}
      </div>

      <div className="pv_media_manifest_list">
        {loading ? (
          <div className="pv_media_manifest_empty">正在加载模型清单…</div>
        ) : models.length === 0 ? (
          <div className="pv_media_manifest_empty">
            {isChatModel
              ? '该服务商暂未收录内置生图/视频模型，可在下方手动添加自定义模型 ID'
              : '暂无匹配的内置模型清单'}
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="pv_media_manifest_empty">没有找到匹配的模型，请尝试其他关键词</div>
        ) : (
          filteredModels.map((model) => {
            const selected = selectedManifestIds.has(model.manifestId)
            const isDefault = defaultModel.trim() === model.effectiveModelId.trim()
            return (
              <label
                key={model.manifestId}
                className={[
                  'pv_media_manifest_item',
                  selected ? 'pv_media_manifest_item_selected' : '',
                ].filter(Boolean).join(' ')}
              >
                <Checkbox
                  checked={selected}
                  onChange={(checked: boolean) => onToggleModel(model, checked)}
                />
                <div className="pv_media_manifest_main">
                  <div className="pv_media_manifest_title">
                    <span>{model.displayName}</span>
                    <Tag size="small" color="gray">{model.providerKind}</Tag>
                    <Tag size="small" color="blue">{model.invocationMode}</Tag>
                  </div>
                  <div className="pv_media_manifest_meta">{model.effectiveModelId}</div>
                  <div className="pv_media_manifest_caps">
                    {model.capabilities.slice(0, 4).map((capability) => (
                      <Tag key={capability.id} size="small" color="gray">
                        {capability.label}
                      </Tag>
                    ))}
                  </div>
                </div>
                {selected && (
                  <div className="pv_media_manifest_actions">
                    {isDefault ? (
                      <Tag size="small" color="green">默认</Tag>
                    ) : (
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Star size={12} />}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onSetDefaultModel(model.effectiveModelId)
                        }}
                        title="设为默认调用模型"
                        aria-label={`将 ${model.effectiveModelId} 设为默认`}
                      >
                        设为默认
                      </Button>
                    )}
                  </div>
                )}
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
