/**
 * FormControls — 自定义主题化的 Input / Select / Textarea / Checkbox 组件
 *
 * 替代原生 <input> 和 <select>，提供与应用主题一致的外观：
 * - 自定义边框、背景、圆角
 * - focus 状态使用 primary 色调
 * - Select 基于 @spark/ui-kit 的 Radix Select，提供原生般的弹出面板
 * - 支持 disabled / readonly / password / number / range 等原生类型
 * - 支持 mono-sm / flex1 / input-w-sm / input-max-sm 等原有 className
 */
import { forwardRef, Children, isValidElement, useMemo } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@spark/ui-kit'

/* ============================================================
   SparkInput
   ============================================================ */

type SparkInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 左侧图标 */
  icon?: ReactNode
}

export const SparkInput = forwardRef<HTMLInputElement, SparkInputProps>(
  function SparkInput({ className = '', icon, ...rest }, ref) {
    if (icon) {
      return (
        <span className={`spark-input-wrap ${className}`}>
          <span className="spark-input-icon">{icon}</span>
          <input ref={ref} className="spark-input spark-input-has-icon" {...rest} />
        </span>
      )
    }
    return <input ref={ref} className={`spark-input ${className}`} {...rest} />
  },
)

/* ============================================================
   SparkSelect

   ✨ 现在基于 Radix UI Select (@spark/ui-kit)，
   但保持与原生 <select> + <option> 子元素完全相同的 API：
   - value / defaultValue / onChange / disabled / className
   - 子元素是 <option value="...">文本</option>

   内部自动将 <option> 子元素转换为 Radix SelectItem。
   ============================================================ */

/** 从 <option> 子元素中提取 value/label 对 */
function extractOptions(children: ReactNode): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string; children?: ReactNode }
    const value = props.value ?? ''
    const label = typeof props.children === 'string' ? props.children : String(props.children ?? value)
    result.push({ value, label })
  })
  return result
}

export interface SparkSelectProps {
  /** 受控值 */
  value?: string
  /** 非受控默认值 */
  defaultValue?: string
  /** 值变化回调 — 与原生 select.onChange 签名兼容 */
  onChange?: (event: { target: { value: string } }) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 额外 CSS 类名（应用到触发器外层容器） */
  className?: string
  /** <option> 子元素 */
  children?: ReactNode
}

/** Radix Select 不接受空字符串作为 value，使用内部哨兵值代替 */
const EMPTY_VALUE = '__spark_empty__'

export const SparkSelect = forwardRef<HTMLDivElement, SparkSelectProps>(
  function SparkSelect({ className = '', children, value, defaultValue, onChange, disabled }, _ref) {
    const options = useMemo(() => extractOptions(children), [children])

    // 确定实际值：优先受控 value，否则从 defaultValue 推导
    const currentValue = value ?? defaultValue ?? options[0]?.value ?? ''
    // 空字符串映射到哨兵值
    const radixValue = currentValue === '' ? EMPTY_VALUE : currentValue
    const radixDefault = value === undefined
      ? ((defaultValue === '' ? EMPTY_VALUE : defaultValue) || undefined)
      : undefined

    return (
      <span className={`spark-select-wrap ${className}`}>
        <Select
          {...(radixValue ? { value: radixValue } : {})}
          {...(radixDefault ? { defaultValue: radixDefault } : {})}
          onValueChange={(v) => {
            // 将哨兵值还原为空字符串，保持与原生 select 的兼容性
            const actualValue = v === EMPTY_VALUE ? '' : v
            onChange?.({ target: { value: actualValue } })
          }}
          disabled={disabled ?? false}
        >
          <SelectTrigger className="spark-select-trigger" selectSize="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {options.map((opt) => (
              <SelectItem key={opt.value || EMPTY_VALUE} value={opt.value || EMPTY_VALUE}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    )
  },
)

/* ============================================================
   SparkTextarea
   ============================================================ */

type SparkTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const SparkTextarea = forwardRef<HTMLTextAreaElement, SparkTextareaProps>(
  function SparkTextarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`spark-textarea ${className}`} {...rest} />
  },
)

/* ============================================================
   SparkCheckbox
   ============================================================ */

type SparkCheckboxProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode
}

export const SparkCheckbox = forwardRef<HTMLInputElement, SparkCheckboxProps>(
  function SparkCheckbox({ className = '', label, ...rest }, ref) {
    return (
      <label className={`spark-checkbox ${className}`}>
        <input ref={ref} type="checkbox" {...rest} />
        <span className="spark-checkbox-box" aria-hidden="true" />
        {label != null && <span className="spark-checkbox-label">{label}</span>}
      </label>
    )
  },
)
