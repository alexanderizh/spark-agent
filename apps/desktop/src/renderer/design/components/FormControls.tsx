/**
 * FormControls — 基于 @arco-design/web-react 的主题化表单组件
 *
 * SparkInput        → Arco Input
 * SparkSearchInput  → Arco Input.Search（带搜索图标、清除按钮）
 * SparkSelect       → Arco Select（保持 <option> 子元素 API；弹层使用 Arco 默认下拉弹窗）
 * SparkTextarea      → Arco Input.TextArea
 * SparkCheckbox      → Arco Checkbox
 *
 * 规则：所有下拉/弹窗类控件必须使用 Arco Design 提供的基础组件，**不要**自己手写
 *       <select> / <ul role="listbox"> / 自定义 popup。详见 AGENTS.md。
 */
import { forwardRef, Children, isValidElement, useMemo } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { Input, Select, Checkbox } from '@arco-design/web-react'
import './FormControls.less'

const { TextArea } = Input
const InputSearch = Input.Search

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
      <span >
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
   SparkSelect — Arco Design 下拉弹窗（Select 组件）
   保持 <option> 子元素 API；不允许再用原生 <select>。
   ============================================================ */

function extractOptions(children: ReactNode): { value: string; label: ReactNode }[] {
  const result: { value: string; label: ReactNode }[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string; children?: ReactNode }
    const value = props.value ?? ''
    // 保留原始 ReactNode 作为 label（不再强制 String()），调用方可以传 <span> 自定义样式
    // （如：带背景色的 tag、icon + 文字组合等）。dropDown 中 Arco 会原样渲染这些节点。
    const label = props.children ?? value
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
  style?: CSSProperties
  width?: CSSProperties['width']
  children?: ReactNode
  placeholder?: string
  size?: 'mini' | 'small' | 'default' | 'large'
  allowClear?: boolean
  showSearch?: boolean
  /** 透传到 Arco Select 的 triggerProps，覆盖默认行为（一般不需要） */
  triggerProps?: Record<string, unknown>
}

export const SparkSelect = forwardRef<any, SparkSelectProps>(
  function SparkSelect(
    {
      className = '',
      children,
      value,
      defaultValue,
      onChange,
      disabled,
      placeholder,
      size = 'small',
      allowClear,
      showSearch,
      triggerProps,
      style,
      width,
    },
    _ref,
  ) {
    const options = useMemo(() => extractOptions(children), [children])

    return (
      <div className={`spark-select-wrap ${className}`} style={{ ...(style ?? {}), ...(width !== undefined ? { width } : {}) }}>
        <Select
          // Arco 自带的下拉弹窗样式已经够完整了，不要再用 bordered={false} 把外壳抹掉再自己画。
          className="spark-select-arco"
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(allowClear !== undefined ? { allowClear } : {})}
          {...(showSearch !== undefined ? { showSearch } : {})}
          {...(value !== undefined ? { value } : {})}
          {...(value === undefined && defaultValue !== undefined ? { defaultValue } : {})}
          onChange={(v: string | number) => {
            onChange?.({ target: { value: v != null ? String(v) : '' } })
          }}
          disabled={disabled ?? false}
          size={size}
          getPopupContainer={() => document.body}
          triggerProps={{
            autoAlignPopupWidth: true,
            autoAlignPopupMinWidth: true,
            position: 'bl' as const,
            ...(triggerProps ?? {}),
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

export interface SparkMultiSelectProps {
  value?: string[]
  defaultValue?: string[]
  onChange?: (event: { target: { value: string[] } }) => void
  disabled?: boolean
  className?: string
  style?: CSSProperties
  width?: CSSProperties['width']
  children?: ReactNode
  placeholder?: string
  size?: 'mini' | 'small' | 'default' | 'large'
  allowClear?: boolean
  showSearch?: boolean
  triggerProps?: Record<string, unknown>
}

export const SparkMultiSelect = forwardRef<any, SparkMultiSelectProps>(
  function SparkMultiSelect(
    {
      className = '',
      children,
      value,
      defaultValue,
      onChange,
      disabled,
      placeholder,
      size = 'small',
      allowClear,
      showSearch,
      triggerProps,
      style,
      width,
    },
    _ref,
  ) {
    const options = useMemo(() => extractOptions(children), [children])

    return (
      <div className={`spark-select-wrap ${className}`} style={{ ...(style ?? {}), ...(width !== undefined ? { width } : {}) }}>
        <Select
          className="spark-select-arco"
          mode="multiple"
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(allowClear !== undefined ? { allowClear } : {})}
          {...(showSearch !== undefined ? { showSearch } : {})}
          {...(value !== undefined ? { value } : {})}
          {...(value === undefined && defaultValue !== undefined ? { defaultValue } : {})}
          onChange={(v: Array<string | number>) => {
            onChange?.({ target: { value: v.map(String) } })
          }}
          disabled={disabled ?? false}
          size={size}
          getPopupContainer={() => document.body}
          triggerProps={{
            autoAlignPopupWidth: true,
            autoAlignPopupMinWidth: true,
            position: 'bl' as const,
            ...(triggerProps ?? {}),
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
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
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
    onPaste,
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
        onPaste={onPaste as any}
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

/* ============================================================
   SparkSearchInput — Arco Design 搜索输入框
   基于 Input.Search，自带搜索图标和清除按钮
   ============================================================ */

export interface SparkSearchInputProps {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  onSearch?: (value: string) => void
  onClear?: () => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  maxLength?: number
  allowClear?: boolean
  searchButton?: boolean
  size?: 'mini' | 'small' | 'default' | 'large'
}

export const SparkSearchInput = forwardRef<any, SparkSearchInputProps>(
  function SparkSearchInput(
    {
      className = '',
      style,
      onChange,
      onSearch,
      onClear,
      value,
      defaultValue,
      placeholder = '搜索...',
      disabled,
      readOnly,
      autoFocus,
      maxLength,
      allowClear = true,
      searchButton = false,
      size = 'small',
    },
    ref,
  ) {
    return (
      <InputSearch
        ref={ref}
        className={`spark-search-input ${className}`}
        {...(style !== undefined ? { style } : {})}
        {...(value !== undefined ? { value } : {})}
        {...(value === undefined && defaultValue !== undefined ? { defaultValue } : {})}
        onChange={(v: string) => {
          onChange?.(v)
        }}
        onSearch={(v: string) => {
          onSearch?.(v)
        }}
        onClear={() => {
          onClear?.()
        }}
        placeholder={placeholder}
        disabled={disabled ?? false}
        {...(readOnly !== undefined ? { readOnly } : {})}
        {...(autoFocus !== undefined ? { autoFocus } : {})}
        {...(maxLength !== undefined ? { maxLength } : {})}
        allowClear={allowClear}
        searchButton={searchButton}
        size={size}
      />
    )
  },
)
