import { useMemo, useState, type ReactNode } from 'react'
import { Popover } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { CanvasModelPicker } from './CanvasModelPicker'
import { CanvasParameterControl } from './CanvasParameterControl'
import {
  parameterSummaryValue,
  partitionParameterFields,
  type SchemaField,
} from './canvasParameterPresentation'
import {
  readCanvasComposerAdvancedOpen,
  writeCanvasComposerAdvancedOpen,
} from './canvasComposerPreferences'
import './CanvasOperationParameterControls.less'

export type CanvasOperationParameterControlsProps = {
  variant: 'toolbar' | 'panel'
  models: CanvasMediaModelSummary[]
  modelValue: string
  modelLoading?: boolean
  disabled?: boolean
  showModelPicker?: boolean
  allowEmptyModel?: boolean
  emptyModelLabel?: string
  fields: SchemaField[]
  values: Record<string, string>
  advancedContent?: ReactNode
  modelMeta?: ReactNode
  onModelChange: (value: string) => void
  onParameterChange: (name: string, value: string) => void
}

function parameterIcon(control: string): ReactNode {
  if (control === 'aspect-ratio') return <Icons.Crop size={13} />
  if (control === 'resolution') return <Icons.Maximize size={13} />
  if (control === 'duration') return <Icons.Clock size={13} />
  if (control === 'count') return <Icons.Layers size={13} />
  return <Icons.Sliders size={13} />
}

export function CanvasOperationParameterControls({
  variant,
  models,
  modelValue,
  modelLoading = false,
  disabled = false,
  showModelPicker = true,
  allowEmptyModel = false,
  emptyModelLabel,
  fields,
  values,
  advancedContent,
  modelMeta,
  onModelChange,
  onParameterChange,
}: CanvasOperationParameterControlsProps) {
  const groups = useMemo(() => partitionParameterFields(fields), [fields])
  const [activeParameter, setActiveParameter] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(() => readCanvasComposerAdvancedOpen())
  const advancedAvailable = groups.advanced.length > 0 || advancedContent != null

  const setAdvanced = (next: boolean) => {
    setAdvancedOpen(next)
    writeCanvasComposerAdvancedOpen(next)
  }

  if (variant === 'toolbar') {
    return (
      <div className="canvas-operation-unified-controls is-toolbar">
        {showModelPicker && (
          <CanvasModelPicker
            models={models}
            value={modelValue}
            loading={modelLoading}
            disabled={disabled}
            compact
            allowEmpty={allowEmptyModel}
            {...(emptyModelLabel ? { emptyLabel: emptyModelLabel } : {})}
            onChange={onModelChange}
          />
        )}
        {groups.common.map((presentation) => {
          const value = values[presentation.field.name] ?? ''
          return (
            <Popover
              key={presentation.field.name}
              trigger="click"
              placement="bottomLeft"
              overlayClassName={`canvas-operation-parameter-overlay is-${presentation.control}`}
              arrow={false}
              autoAdjustOverflow
              open={activeParameter === presentation.field.name}
              onOpenChange={(open) =>
                setActiveParameter(open ? presentation.field.name : '')
              }
              content={
                <CanvasParameterControl
                  presentation={presentation}
                  value={value}
                  compact
                  onChange={(next) => onParameterChange(presentation.field.name, next)}
                />
              }
            >
              <button
                type="button"
                className="canvas-operation-parameter-summary"
                aria-label={`设置${presentation.label}`}
                disabled={disabled}
              >
                {parameterIcon(presentation.control)}
                <span className="canvas-operation-parameter-summary-label">
                  {presentation.label}
                </span>
                <strong>{parameterSummaryValue(presentation, value)}</strong>
                <Icons.ChevronDown size={11} />
              </button>
            </Popover>
          )
        })}
        {advancedAvailable && (
          <Popover
            trigger="click"
            placement="bottomRight"
            overlayClassName="canvas-operation-advanced-overlay"
            arrow={false}
            autoAdjustOverflow
            open={advancedOpen}
            onOpenChange={setAdvanced}
            content={
              <div className="canvas-operation-advanced-content">
                <div className="canvas-operation-advanced-head">
                  <div>
                    <strong>高级设置</strong>
                    <span>低频参数与 Provider 私有配置</span>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    aria-label="关闭高级设置"
                    icon={<Icons.X size={14} />}
                    onClick={() => setAdvanced(false)}
                  />
                </div>
                <div className="canvas-operation-advanced-grid">
                  {groups.advanced.map((presentation) => (
                    <CanvasParameterControl
                      key={presentation.field.name}
                      presentation={presentation}
                      value={values[presentation.field.name] ?? ''}
                      onChange={(next) => onParameterChange(presentation.field.name, next)}
                    />
                  ))}
                </div>
                {advancedContent}
              </div>
            }
          >
            <Button
              type={advancedOpen ? 'primary' : 'text'}
              size="middle"
              className="canvas-operation-advanced-trigger"
              aria-label="高级设置"
              aria-expanded={advancedOpen}
              title="高级设置"
              icon={<Icons.Sliders size={14} />}
              disabled={disabled}
            />
          </Popover>
        )}
      </div>
    )
  }

  return (
    <div className="canvas-operation-unified-controls is-panel">
      {showModelPicker && (
        <CanvasModelPicker
          models={models}
          value={modelValue}
          loading={modelLoading}
          disabled={disabled}
          allowEmpty={allowEmptyModel}
          {...(emptyModelLabel ? { emptyLabel: emptyModelLabel } : {})}
          onChange={onModelChange}
        />
      )}
      {modelMeta}
      {groups.common.length > 0 && (
        <div className="canvas-operation-parameter-grid is-common">
          {groups.common.map((presentation) => (
            <CanvasParameterControl
              key={presentation.field.name}
              presentation={presentation}
              value={values[presentation.field.name] ?? ''}
              onChange={(next) => onParameterChange(presentation.field.name, next)}
            />
          ))}
        </div>
      )}
      {advancedAvailable && (
        <div className="canvas-operation-advanced-section">
          <button
            type="button"
            className="canvas-operation-advanced-section-trigger"
            aria-label="高级设置"
            aria-expanded={advancedOpen}
            onClick={() => setAdvanced(!advancedOpen)}
          >
            <span>
              <Icons.Sliders size={14} />
              高级设置
            </span>
            <Icons.ChevronDown
              size={13}
              {...(advancedOpen ? { className: 'is-open' } : {})}
            />
          </button>
          {advancedOpen && (
            <div className="canvas-operation-advanced-panel">
              <div className="canvas-operation-parameter-grid is-advanced">
                {groups.advanced.map((presentation) => (
                  <CanvasParameterControl
                    key={presentation.field.name}
                    presentation={presentation}
                    value={values[presentation.field.name] ?? ''}
                    onChange={(next) => onParameterChange(presentation.field.name, next)}
                  />
                ))}
              </div>
              {advancedContent}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
