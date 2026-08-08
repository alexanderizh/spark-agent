import { AutoComplete, Input, Select, Slider } from 'antd'
import {
  aspectRatioOptions,
  aspectRatioShape,
  isAspectRatioValue,
  type CanvasParameterPresentation,
} from './canvasParameterPresentation'
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

/**
 * 取 enum 选项的展示名：优先用 field.enumLabels（如 MiniMax 模板 id → 中文名），
 * 缺失时回退到 enum 值本身。仅用于 enum/autocomplete 下拉，不影响 aspect-ratio
 * 等几何值（那里 enumLabels 不适用）。
 */
function enumOptionLabel(field: CanvasParameterPresentation['field'], option: string): string {
  const labels = field.enumLabels
  return labels && labels[option] ? labels[option] : option
}

function OptionRail({
  presentation,
  options,
  value,
  onChange,
}: CanvasParameterControlProps & { options: string[] }) {
  return (
    <div className="canvas-parameter-option-rail" role="group" aria-label={presentation.label}>
      {options.map((option) => (
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

function CompactOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  return (
    <OptionRail
      presentation={presentation}
      options={presentation.field.enumValues}
      value={value}
      onChange={onChange}
    />
  )
}

function AspectRatioGrid({
  presentation,
  options,
  value,
  onChange,
}: CanvasParameterControlProps & { options: string[] }) {
  return (
    <div className="canvas-aspect-ratio-grid" role="group" aria-label={presentation.label}>
      {options.map((option) => {
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
  )
}

function CustomAspectRatioInput({
  presentation,
  options,
  value,
  onChange,
}: CanvasParameterControlProps & { options: string[] }) {
  if (!presentation.field.allowCustom) return null
  const normalizedValue = value.trim()
  const preview =
    normalizedValue && !options.includes(normalizedValue) && isAspectRatioValue(normalizedValue)
      ? aspectRatioShape(normalizedValue)
      : null
  return (
    <>
      <AutoComplete
        className="canvas-parameter-custom-value"
        value={value || undefined}
        options={options.map((option) => ({ value: option, label: option }))}
        placeholder={presentation.field.placeholder ?? '输入自定义比例或尺寸'}
        allowClear
        onChange={(next) => onChange(next == null ? '' : String(next))}
        filterOption={(input, option) =>
          String(option?.value ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
      {preview && (
        <div className="canvas-parameter-custom-ratio-preview" aria-label={`预览比例 ${value}`}>
          <span
            className={`canvas-aspect-ratio-frame${preview.adaptive ? ' is-adaptive' : ''}`}
            data-aspect-custom-preview="true"
            data-aspect-width={preview.width}
            data-aspect-height={preview.height}
            style={{ width: preview.width, height: preview.height }}
          />
          <span>{value}</span>
        </div>
      )}
    </>
  )
}

function AspectRatioOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  const options = aspectRatioOptions(presentation.field)
  return (
    <>
      <AspectRatioGrid
        presentation={presentation}
        options={options}
        value={value}
        onChange={onChange}
      />
      <CustomAspectRatioInput
        presentation={presentation}
        options={options}
        value={value}
        onChange={onChange}
      />
    </>
  )
}

function SizeOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  const visualOptions = aspectRatioOptions(presentation.field).filter(isAspectRatioValue)
  const resolutionOptions = presentation.field.enumValues.filter(
    (option) => !isAspectRatioValue(option),
  )
  return (
    <>
      {resolutionOptions.length > 0 && (
        <OptionRail
          presentation={presentation}
          options={resolutionOptions}
          value={value}
          onChange={onChange}
        />
      )}
      {visualOptions.length > 0 && (
        <AspectRatioGrid
          presentation={presentation}
          options={visualOptions}
          value={value}
          onChange={onChange}
        />
      )}
      <CustomAspectRatioInput
        presentation={presentation}
        options={presentation.field.enumValues}
        value={value}
        onChange={onChange}
      />
    </>
  )
}

function BooleanOptions({ presentation, value, onChange }: CanvasParameterControlProps) {
  return (
    <div
      className="canvas-parameter-option-rail is-boolean"
      role="group"
      aria-label={presentation.label}
    >
      {[
        { value: 'true', label: '开启' },
        { value: 'false', label: '关闭' },
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          className={`canvas-parameter-option${option.value === value ? ' is-selected' : ''}`}
          data-param-value={option.value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function BoundedDuration({ presentation, value, onChange }: CanvasParameterControlProps) {
  const minimum = presentation.field.minimum!
  const maximum = presentation.field.maximum!
  const parsed = Number(value)
  const current = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : minimum
  return (
    <div className="canvas-parameter-range-control">
      <Slider
        min={minimum}
        max={maximum}
        {...(presentation.field.type === 'integer' ? { step: 1 } : {})}
        value={current}
        tooltip={{ open: false }}
        onChange={(next) => onChange(String(next))}
      />
      <span className="canvas-parameter-range-value">
        {optionLabel(String(current), presentation.unit)}
      </span>
    </div>
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
  } else if (control === 'size') {
    controlNode = (
      <SizeOptions
        presentation={presentation}
        value={value}
        onChange={onChange}
        compact={compact}
      />
    )
  } else if (
    (control === 'resolution' || control === 'count' || control === 'duration') &&
    field.enumValues.length > 0
  ) {
    controlNode = (
      <CompactOptions
        presentation={presentation}
        value={value}
        onChange={onChange}
        compact={compact}
      />
    )
  } else if (
    control === 'duration' &&
    field.enumValues.length === 0 &&
    Number.isFinite(field.minimum) &&
    Number.isFinite(field.maximum) &&
    field.maximum! > field.minimum!
  ) {
    controlNode = <BoundedDuration presentation={presentation} value={value} onChange={onChange} />
  } else if (control === 'boolean') {
    controlNode = <BooleanOptions presentation={presentation} value={value} onChange={onChange} />
  } else if (control === 'autocomplete') {
    controlNode = (
      <AutoComplete
        value={value || undefined}
        options={field.enumValues.map((option) => ({
          value: option,
          label: enumOptionLabel(field, option),
        }))}
        placeholder={field.placeholder}
        allowClear
        onChange={(next) => onChange(next == null ? '' : String(next))}
        filterOption={(input, option) => {
          const query = input.toLowerCase()
          return [option?.value, option?.label].some((candidate) =>
            String(candidate ?? '')
              .toLowerCase()
              .includes(query),
          )
        }}
      />
    )
  } else if (control === 'enum') {
    controlNode = (
      <Select
        value={value || undefined}
        options={field.enumValues.map((option) => ({
          value: option,
          label: enumOptionLabel(field, option),
        }))}
        allowClear
        onChange={(next) => onChange(next == null ? '' : String(next))}
      />
    )
  } else {
    const numeric =
      control === 'duration' ||
      control === 'count' ||
      field.type === 'integer' ||
      field.type === 'number'
    controlNode = (
      <Input
        value={value}
        type={numeric ? 'number' : 'text'}
        min={numeric ? field.minimum : undefined}
        max={numeric ? field.maximum : undefined}
        step={numeric && field.type === 'integer' ? 1 : undefined}
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
