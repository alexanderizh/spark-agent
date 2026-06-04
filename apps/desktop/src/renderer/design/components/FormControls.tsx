/**
 * FormControls — 基于 @arco-design/web-react 的主题化表单组件
 *
 * SparkInput    → Arco Input
 * SparkSelect   → Arco Select（保持 <option> 子元素 API）
 * SparkTextarea → Arco Input.TextArea
 * SparkCheckbox → Arco Checkbox
 */
import { forwardRef, Children, isValidElement, useMemo } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { Input, Select, Checkbox } from '@arco-design/web-react'

const { TextArea } = Input

/* ============================================================
   SparkInput
   ============================================================ */

export interface SparkInputProps {
  value?: string | number
  defaultValue?: string
  onChange?: (event: { target: { value: string } }) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  type?: string
  className?: string
  icon?: ReactNode
  autoFocus?: boolean
  maxLength?: number
  name?: string
  min?: string | number
  max?: string | number
  step?: string | number
  checked?: boolean
  autoComplete?: string
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onKeyUp?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export const SparkInput = forwardRef<any, SparkInputProps>(
  function SparkInput({
    className = '',
    icon,
    onChange,
    type,
    readOnly,
    value,
    defaultValue,
    placeholder,
    disabled,
    autoFocus,
    maxLength,
    name,
    min,
    max,
    step,
    checked,
    autoComplete,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp,
  }, ref) {
    // range / checkbox 保持原生（Arco 不支持）
    if (type === 'range') {
      return (
        <input
          ref={ref as any}
          type="range"
          className={`spark-input ${className}`}
          value={value as string}
          defaultValue={defaultValue}
          onChange={(e) => onChange?.({ target: { value: e.target.value } })}
          disabled={disabled}
          name={name}
          min={min}
          max={max}
          step={step}
        />
      )
    }

    if (type === 'checkbox' || type === 'radio') {
      return (
        <input
          ref={ref as any}
          type={type}
          className={className}
          checked={checked}
          value={value as string}
          onChange={(e) => onChange?.({ target: { value: e.target.value } })}
          disabled={disabled}
          readOnly={readOnly}
          name={name}
          autoComplete={autoComplete}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      )
    }

    return (
      <span className={`spark-input-wrap ${className}`}>
        {icon && <span className="spark-input-icon">{icon}</span>}
        <Input
          ref={ref}
          className={`spark-input-arco${icon ? ' spark-input-has-icon' : ''}`}
          type={type ?? 'text'}
          {...(readOnly !== undefined ? { readOnly } : {})}
          {...(value !== undefined ? { value: String(value) } : {})}
          {...(value === undefined && defaultValue !== undefined ? { defaultValue } : {})}
          onChange={(v: string) => {
            onChange?.({ target: { value: v } })
          }}
          {...(placeholder !== undefined ? { placeholder } : {})}
          disabled={disabled ?? false}
          {...(autoFocus !== undefined ? { autoFocus } : {})}
          {...(maxLength !== undefined ? { maxLength } : {})}
          {...(name !== undefined ? { name } : {})}
          onFocus={onFocus as any}
          onBlur={onBlur as any}
          onKeyDown={onKeyDown as any}
          onKeyUp={onKeyUp as any}
          size="small"
        />
      </span>
    )
  },
)

/* ============================================================
   SparkSelect — Arco Select，保持 <option> 子元素 API
   ============================================================ */

function extractOptions(children: ReactNode): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string; children?: ReactNode }
    const value = props.value ?? ''
    const label = typeof props.children === 'string'
      ? props.children
      : String(props.children ?? value)
    result.push({ value, label })
  })
  return result
}

export interface SparkSelectProps {
  value?: string
  defaultValue?: string
  onChange?: (event: { target: { value: string } }) => void
  disabled?: boolean
  className?: string
  children?: ReactNode
}

export const SparkSelect = forwardRef<any, SparkSelectProps>(
  function SparkSelect({ className = '', children, value, defaultValue, onChange, disabled }, _ref) {
    const options = useMemo(() => extractOptions(children), [children])

    return (
      <div className={`spark-select-wrap ${className}`}>
        <Select
          className="spark-select-arco"
          dropdownMenuClassName="spark-select-arco-popup"
          bordered={false}
          {...(value !== undefined ? { value } : {})}
          {...(value === undefined && defaultValue !== undefined ? { defaultValue } : {})}
          onChange={(v: string | number) => {
            onChange?.({ target: { value: String(v) } })
          }}
          disabled={disabled ?? false}
          size="small"
          getPopupContainer={() => document.body}
          triggerProps={{
            autoAlignPopupWidth: true,
            autoAlignPopupMinWidth: true,
            position: 'bl' as const,
          }}
        >
          {options.map((opt) => (
            <Select.Option key={opt.value} value={opt.value}>
              {opt.label}
            </Select.Option>
          ))}
        </Select>
      </div>
    )
  },
)

/* ============================================================
   SparkTextarea
   ============================================================ */

export interface SparkTextareaProps {
  value?: string
  defaultValue?: string
  onChange?: (event: { target: { value: string } }) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  rows?: number
  className?: string
  autoFocus?: boolean
  maxLength?: number
  name?: string
  style?: CSSProperties
  autoSize?: boolean | { minRows?: number; maxRows?: number }
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

export const SparkTextarea = forwardRef<any, SparkTextareaProps>(
  function SparkTextarea({
    className = '',
    onChange,
    value,
    defaultValue,
    placeholder,
    disabled,
    readOnly,
    rows,
    autoFocus,
    maxLength,
    name,
    style,
    autoSize,
    onFocus,
    onBlur,
    onKeyDown,
  }, ref) {
    return (
      <TextArea
        ref={ref}
        className={`spark-textarea-arco ${className}`}
        {...(value !== undefined ? { value } : {})}
        {...(value === undefined && defaultValue !== undefined ? { defaultValue } : {})}
        onChange={(v: string) => {
          onChange?.({ target: { value: v } })
        }}
        {...(placeholder !== undefined ? { placeholder } : {})}
        disabled={disabled ?? false}
        {...(readOnly !== undefined ? { readOnly } : {})}
        {...(rows !== undefined ? { rows } : {})}
        {...(autoFocus !== undefined ? { autoFocus } : {})}
        {...(maxLength !== undefined ? { maxLength } : {})}
        {...(name !== undefined ? { name } : {})}
        {...(style !== undefined ? { style } : {})}
        onFocus={onFocus as any}
        onBlur={onBlur as any}
        onKeyDown={onKeyDown as any}
        autoSize={autoSize ?? false}
      />
    )
  },
)

/* ============================================================
   SparkCheckbox
   ============================================================ */

export interface SparkCheckboxProps {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (event: { target: { checked: boolean } }) => void
  disabled?: boolean
  className?: string
  label?: ReactNode
  name?: string
  style?: CSSProperties
}

export const SparkCheckbox = forwardRef<any, SparkCheckboxProps>(
  function SparkCheckbox({ className = '', label, onChange, checked, defaultChecked, disabled, ...rest }, ref) {
    return (
      <Checkbox
        ref={ref}
        className={`spark-checkbox-arco ${className}`}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        disabled={disabled ?? false}
        onChange={(val: boolean) => {
          onChange?.({ target: { checked: val } })
        }}
      >
        {label}
      </Checkbox>
    )
  },
)
