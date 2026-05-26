/**
 * Button 组件
 *
 * 基于 Radix Slot 支持多态渲染（asChild）。
 * 使用 class-variance-authority (cva) 管理变体样式。
 *
 * @example
 *   <Button variant="primary" size="sm">点击</Button>
 *   <Button variant="ghost" asChild><a href="/">链接</a></Button>
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../utils/cn'

const buttonVariants = cva(
  // 基础样式：紧凑、圆角、focus ring
  [
    'inline-flex items-center justify-center gap-1.5',
    'font-sans font-medium',
    'rounded-xs whitespace-nowrap',
    'transition-colors duration-150',
    'focus-ring',
    'disabled:opacity-50 disabled:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-primary text-primary-fg',
          'hover:bg-primary-hover',
          'active:opacity-90',
        ],
        secondary: [
          'bg-panel text-text',
          'border border-border',
          'hover:bg-soft hover:text-text-strong',
          'active:bg-sunken',
        ],
        ghost: [
          'bg-transparent text-text-muted',
          'hover:bg-soft hover:text-text',
          'active:bg-sunken',
        ],
        danger: [
          'bg-danger text-text-inverse',
          'hover:opacity-90',
          'active:opacity-80',
        ],
      },
      size: {
        xs: 'h-6 px-2 text-[var(--font-xs)]',
        sm: 'h-7 px-2.5 text-[var(--font-sm)]',
        md: 'h-8 px-3 text-[var(--font-sm)]',
        lg: 'h-9 px-4 text-[var(--font-base)]',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 使用 Slot 将样式应用到子元素而非渲染 button */
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
