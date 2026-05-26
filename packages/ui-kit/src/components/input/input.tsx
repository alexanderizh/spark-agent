/**
 * Input 组件
 *
 * 基础文本输入框，支持不同尺寸和状态。
 * 遵循设计稿的紧凑风格（12-13px 字号、4px 圆角）。
 *
 * @example
 *   <Input placeholder="搜索..." inputSize="sm" />
 *   <Input state="error" />
 */

import { forwardRef, type InputHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../utils/cn'

const inputVariants = cva(
  [
    'flex w-full',
    'font-sans text-[var(--font-sm)]',
    'bg-bg-soft text-text',
    'border border-border rounded-xs',
    'px-2.5',
    'transition-colors duration-150',
    'placeholder:text-text-faint',
    'focus-ring',
    'focus:border-primary focus:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ],
  {
    variants: {
      inputSize: {
        sm: 'h-7 text-[var(--font-xs)]',
        md: 'h-8',
        lg: 'h-9 text-[var(--font-base)]',
      },
      state: {
        default: '',
        error: 'border-danger focus:border-danger',
      },
    },
    defaultVariants: {
      inputSize: 'md',
      state: 'default',
    },
  },
)

type InputVariantProps = VariantProps<typeof inputVariants>

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 输入框尺寸（避免与 HTML size 属性冲突，使用 inputSize） */
  inputSize?: InputVariantProps['inputSize']
  /** 输入框状态 */
  state?: InputVariantProps['state']
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize, state, ...props }, ref) => {
    return (
      <input
        className={cn(inputVariants({ inputSize, state, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input, inputVariants }
