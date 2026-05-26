/**
 * Badge 组件
 *
 * 紧凑的标签/徽章组件，用于状态标记、模型标签、Provider chip 等。
 * 尺寸极小（11px 字号），对应设计稿中的 badge 样式。
 *
 * @example
 *   <Badge variant="success">在线</Badge>
 *   <Badge variant="default">Claude Sonnet 4.5</Badge>
 */

import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../utils/cn'

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1',
    'font-sans font-medium',
    'text-[var(--font-xs)] leading-none',
    'rounded-xs px-1.5 py-0.5',
    'whitespace-nowrap',
  ],
  {
    variants: {
      variant: {
        default: 'bg-soft text-text-muted border border-border',
        primary: 'bg-primary-soft text-primary',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
        info: 'bg-info-bg text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, className }))}
        {...props}
      />
    )
  },
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
