/**
 * Tooltip 组件
 *
 * 基于 @radix-ui/react-tooltip 的轻量提示气泡。
 * 用于导航 icon 说明、缩略信息展示。
 */

import { forwardRef } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../utils/cn'

export type TooltipProps = {
  /** 提示内容（纯文字） */
  content: React.ReactNode
  /** 触发元素 */
  children: React.ReactNode
  /** 延迟显示时间（ms），默认 300 */
  delayDuration?: number
  /** 偏移方向 */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** 额外 className */
  className?: string
}

const TooltipProvider = TooltipPrimitive.Provider
const TooltipRoot = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-[var(--z-tooltip)]',
      'px-2 py-1',
      'rounded-sm bg-panel-elev shadow-sm',
      'text-[var(--font-xs)] text-text',
      'border border-border',
      'animate-in fade-in-0 zoom-in-95',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      className,
    )}
    {...props}
  />
))
TooltipContent.displayName = 'TooltipContent'

/**
 * Tooltip — 简化 API 的组合组件
 *
 * @example
 *   <Tooltip content="新建聊天" side="right">
 *     <button>+</button>
 *   </Tooltip>
 */
function Tooltip({
  content,
  children,
  delayDuration = 300,
  side = 'top',
  className,
}: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className={className}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipProvider, TooltipContent }
