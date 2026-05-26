/**
 * Separator 组件
 *
 * 基于 @radix-ui/react-separator 的分割线组件。
 * 支持水平和垂直方向。
 */

import { forwardRef } from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '../../utils/cn'

export type SeparatorProps = React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>

const Separator = forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  SeparatorProps
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-divider',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
))
Separator.displayName = 'Separator'

export { Separator }
