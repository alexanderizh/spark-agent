/**
 * FormControls — 自定义主题化的 Input 和 Select 组件
 *
 * 替代原生 <input> 和 <select>，提供与应用主题一致的外观：
 * - 自定义边框、背景、圆角
 * - focus 状态使用 primary 色调
 * - Select 使用自定义下拉箭头 SVG
 * - 支持 disabled / readonly / password / number / range 等原生类型
 * - 支持 mono-sm / flex1 / input-w-sm / input-max-sm 等原有 className
 */
import { forwardRef } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'

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
   ============================================================ */

type SparkSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** 自定义下拉箭头（默认使用 ChevronDown SVG） */
}

export const SparkSelect = forwardRef<HTMLSelectElement, SparkSelectProps>(
  function SparkSelect({ className = '', children, ...rest }, ref) {
    return (
      <span className={`spark-select-wrap ${className}`}>
        <select ref={ref} className="spark-select" {...rest}>
          {children}
        </select>
        <svg
          className="spark-select-arrow"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </span>
    )
  },
)

/* ============================================================
   SparkTextarea
   ============================================================ */

type SparkTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

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
