import { AutoComplete, Input, Select, Switch } from 'antd'
import { aspectRatioShape, type CanvasParameterPresentation } from './canvasParameterPresentation'
import './CanvasParameterControl.less'

export type CanvasParameterControlProps = {
  presentation: CanvasParameterPresentation
  value: string
  onChange: (value: string) => void
  compact?: boolean
}

function optionLabel(value: string, unit?: string): string {
  if (!unit || value.toLowerCase().endsWith(unit.toLowerCase())) return value
  return `${value}${unit}`
}

function CompactOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  return (
    <div
      className="canvas-parameter-option-rail"
      role="group"
      aria-label={presentation.label}
    >
      {presentation.field.enumValues.map((option) => (
        <button
          key={option}
          type="button"
          className={`canvas-parameter-option${option === value ? ' is-selected' : ''}`}
          data-param-value={option}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {optionLabel(option, presentation.unit)}
        </button>
      ))}
    </div>
  )
}

function AspectRatioOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  return (
    <>
      <div className="canvas-aspect-ratio-grid" role="group" aria-label={presentation.label}>
        {presentation.field.enumValues.map((option) => {
          const shape = aspectRatioShape(option)
          return (
            <button
              key={option}
              type="button"
              className={`canvas-aspect-ratio-option${option === value ? ' is-selected' : ''}`}
              data-param-value={option}
              aria-pressed={option === value}
              onClick={() => onChange(option)}
            >
              <span className="canvas-aspect-ratio-frame-wrap">
                <span
                  className={`canvas-aspect-ratio-frame${shape.adaptive ? ' is-adaptive' : ''}`}
                  data-aspect-width={shape.width}
                  data-aspect-height={shape.height}
                  style={{ width: shape.width, height: shape.height }}
                />
              </span>
              <span>{option}</span>
            </button>
          )
        })}
      </div>
      {presentation.field.allowCustom && (
        <AutoComplete
          className="canvas-parameter-custom-value"
          value={value || undefined}
          options={presentation.field.enumValues.map((option) => ({
            value: option,
            label: option,
          }))}
          placeholder={presentation.field.placeholder ?? '输入自定义比例或尺寸'}
          allowClear
          onChange={(next) => onChange(next == null ? '' : String(next))}
          filterOption={(input, option) =>
            String(option?.value ?? '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
        />
      )}
    </>
  )
}

export function CanvasParameterControl({
  presentation,
  value,
  onChange,
  compact = false,
}: CanvasParameterControlProps) {
  const { field, control } = presentation
  let controlNode

  if (control === 'aspect-ratio') {
    controlNode = (
      <AspectRatioOptions
        presentation={presentation}
        value={value}
        onChange={onChange}
        compact={compact}
      />
    )
  } else if (control === 'resolution' || control === 'count' || control === 'duration') {
    controlNode = (
      <CompactOptions
        presentation={presentation}
        value={value}
        onChange={onChange}
        compact={compact}
      />
    )
  } else if (control === 'boolean') {
    controlNode = (
      <div className="canvas-parameter-switch-row">
        <span>{value === 'true' ? '开启' : '关闭'}</span>
        <Switch checked={value === 'true'} onChange={(checked) => onChange(String(checked))} />
      </div>
    )
  } else if (control === 'autocomplete') {
    controlNode = (
      <AutoComplete
        value={value || undefined}
        options={field.enumValues.map((option) => ({ value: option, label: option }))}
        placeholder={field.placeholder}
        allowClear
        onChange={(next) => onChange(next == null ? '' : String(next))}
        filterOption={(input, option) =>
          String(option?.value ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
    )
  } else if (control === 'enum') {
    controlNode = (
      <Select
        value={value || undefined}
        options={field.enumValues.map((option) => ({ value: option, label: option }))}
        allowClear
        onChange={(next) => onChange(next == null ? '' : String(next))}
      />
    )
  } else {
    controlNode = (
      <Input
        value={value}
        type={control === 'number' ? 'number' : 'text'}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <div
      className={`canvas-parameter-control${compact ? ' is-compact' : ''}`}
      data-parameter-name={field.name}
    >
      <div className="canvas-parameter-control-head">
        <span title={field.description}>{presentation.label}</span>
        {field.description && <small>{field.description}</small>}
      </div>
      {controlNode}
    </div>
  )
}
