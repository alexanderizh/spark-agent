/**
 * Tabs 组件
 *
 * 基于 @radix-ui/react-tabs 的标签页组件。
 * 用于 Settings 页面的子导航切换。
 *
 * @example
 *   <Tabs defaultValue="general">
 *     <TabsList>
 *       <TabsTrigger value="general">通用</TabsTrigger>
 *       <TabsTrigger value="appearance">外观</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="general">...</TabsContent>
 *     <TabsContent value="appearance">...</TabsContent>
 *   </Tabs>
 */

import { forwardRef } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../../utils/cn'

/* ---- Tabs Root ---- */
const Tabs = TabsPrimitive.Root

/* ---- TabsList ---- */
const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1',
      'border-b border-border',
      'px-1',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

/* ---- TabsTrigger ---- */
const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center',
      'px-3 py-1.5',
      'text-[var(--font-sm)] font-medium',
      'text-text-muted',
      'border-b-2 border-transparent',
      'transition-colors duration-150',
      'hover:text-text',
      'focus-ring',
      'data-[state=active]:text-text-strong data-[state=active]:border-primary',
      'disabled:opacity-50 disabled:pointer-events-none',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

/* ---- TabsContent ---- */
const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-3',
      'focus-ring',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsList, TabsTrigger, TabsContent }
