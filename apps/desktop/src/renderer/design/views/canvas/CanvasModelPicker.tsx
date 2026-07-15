import { useMemo, useState } from 'react'
import { Input, Popover, Spin, Tooltip } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ProviderLogo, getProviderIconForVendor } from '../../components/ProviderLogo'
import {
  buildCanvasModelProviderGroups,
  filterCanvasModelProviderGroups,
  mediaModelKey,
  resolveSelectedCanvasModel,
} from './canvasModelPickerModel'
import './CanvasModelPicker.less'

export type CanvasModelPickerProps = {
  models: CanvasMediaModelSummary[]
  value: string
  loading?: boolean
  disabled?: boolean
  compact?: boolean
  allowEmpty?: boolean
  emptyLabel?: string
  onChange: (modelKey: string) => void
}

function providerGroupKey(model: CanvasMediaModelSummary | undefined): string {
  if (!model) return ''
  return model.providerProfileId ?? `catalog:${model.providerKind}`
}

export function CanvasModelPicker({
  models,
  value,
  loading = false,
  disabled = false,
  compact = false,
  allowEmpty = false,
  emptyLabel = '沿用平台默认',
  onChange,
}: CanvasModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedModel = useMemo(() => resolveSelectedCanvasModel(models, value), [models, value])
  const groups = useMemo(() => buildCanvasModelProviderGroups(models), [models])
  const filteredGroups = useMemo(
    () => filterCanvasModelProviderGroups(groups, query),
    [groups, query],
  )
  const [activeProviderKey, setActiveProviderKey] = useState('')
  const selectedProviderKey = providerGroupKey(selectedModel)
  const visibleGroup =
    filteredGroups.find((group) => group.key === activeProviderKey) ?? filteredGroups[0]

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) return
    setOpen(nextOpen)
    if (nextOpen) {
      setQuery('')
      setActiveProviderKey(selectedProviderKey || groups[0]?.key || '')
    }
  }

  const chooseModel = (modelKey: string) => {
    onChange(modelKey)
    setOpen(false)
    setQuery('')
  }

  const content = (
    <div
      className="canvas-model-picker-popover"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <div className="canvas-model-picker-search">
        <Icons.Search size={14} />
        <Input
          value={query}
          aria-label="搜索模型"
          placeholder="搜索渠道、模型或模型 ID"
          variant="borderless"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="canvas-model-picker-layout">
        <div className="canvas-model-picker-providers" aria-label="模型渠道">
          {filteredGroups.map((group) => {
            const active = group.key === visibleGroup?.key
            return (
              <button
                key={group.key}
                type="button"
                className={`canvas-model-picker-provider${active ? ' is-active' : ''}`}
                data-provider-key={group.key}
                aria-pressed={active}
                onClick={() => setActiveProviderKey(group.key)}
              >
                <ProviderLogo
                  vendor={null}
                  icon={group.providerIcon ?? getProviderIconForVendor(group.providerKind)}
                  size={24}
                  shape="rounded"
                  fallbackText={group.label.slice(0, 1).toUpperCase()}
                  title={group.label}
                />
                <span className="canvas-model-picker-provider-copy">
                  <strong>{group.label}</strong>
                  <small>{group.models.length} 个模型</small>
                </span>
                <Icons.ChevronRight size={13} />
              </button>
            )
          })}
          {!loading && filteredGroups.length === 0 && (
            <div className="canvas-model-picker-empty">没有匹配的渠道</div>
          )}
        </div>
        <div className="canvas-model-picker-models" role="listbox" aria-label="模型列表">
          {allowEmpty && (
            <button
              type="button"
              className={`canvas-model-picker-model is-auto${value ? '' : ' is-selected'}`}
              data-model-key="empty"
              role="option"
              aria-selected={!value}
              onClick={() => chooseModel('')}
            >
              <span className="canvas-model-picker-auto-icon">
                <Icons.Sparkles size={16} />
              </span>
              <span className="canvas-model-picker-model-copy">
                <strong>{emptyLabel}</strong>
                <small>不固定模型，保留当前默认选择策略</small>
              </span>
              {!value && <Icons.Check size={15} />}
            </button>
          )}
          {loading ? (
            <div className="canvas-model-picker-loading">
              <Spin size="small" />
              <span>加载中</span>
            </div>
          ) : visibleGroup ? (
            visibleGroup.models.map((model) => {
              const key = mediaModelKey(model)
              const selected = key === value
              const capabilityLabels = model.capabilities
                .map((capability) => capability.label)
                .filter(Boolean)
                .slice(0, 3)
              return (
                <button
                  key={key}
                  type="button"
                  className={`canvas-model-picker-model${selected ? ' is-selected' : ''}`}
                  data-model-key={key}
                  role="option"
                  aria-selected={selected}
                  onClick={() => chooseModel(key)}
                >
                  <span className="canvas-model-picker-model-copy">
                    <strong>{model.displayName}</strong>
                    <small title={model.effectiveModelId}>{model.effectiveModelId}</small>
                    {capabilityLabels.length > 0 && (
                      <span className="canvas-model-picker-capabilities">
                        {capabilityLabels.map((label) => (
                          <em key={label}>{label}</em>
                        ))}
                      </span>
                    )}
                  </span>
                  {selected && <Icons.Check size={15} />}
                </button>
              )
            })
          ) : (
            <div className="canvas-model-picker-empty">没有匹配的模型</div>
          )}
        </div>
      </div>
    </div>
  )

  const triggerLabel = selectedModel
    ? `${selectedModel.providerName ?? selectedModel.providerKind} / ${selectedModel.displayName}`
    : allowEmpty
      ? emptyLabel
      : '未选择模型'

  return (
    <Tooltip
      title={
        selectedModel?.effectiveModelId ??
        (allowEmpty ? '不固定模型，沿用默认选择策略' : '请选择模型')
      }
    >
      <Popover
        content={content}
        open={open}
        placement="bottomLeft"
        trigger="click"
        overlayClassName="canvas-model-picker-overlay"
        autoAdjustOverflow
        arrow={false}
        onOpenChange={handleOpenChange}
      >
        <Button
          className={`canvas-model-picker-trigger${compact ? ' is-compact' : ''}`}
          aria-label="选择模型"
          disabled={disabled}
          icon={
            selectedModel ? (
              <ProviderLogo
                vendor={null}
                icon={
                  selectedModel.providerIcon ?? getProviderIconForVendor(selectedModel.providerKind)
                }
                size={20}
                shape="rounded"
                fallbackText={triggerLabel.slice(0, 1).toUpperCase()}
              />
            ) : (
              <Icons.Sparkles size={15} />
            )
          }
        >
          <span>{triggerLabel}</span>
          {loading && <Spin size="small" />}
          <Icons.ChevronDown size={13} />
        </Button>
      </Popover>
    </Tooltip>
  )
}
