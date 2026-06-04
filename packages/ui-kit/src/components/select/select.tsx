/**
 * Select 组件
 *
 * 基于 @radix-ui/react-select 的下拉选择器，
 * 与项目设计系统一致（紧凑风格、CSS 变量 token、Tailwind 工具类）。
 *
 * @example
 *   <Select value={v} onValueChange={setV}>
 *     <SelectTrigger>
 *       <SelectValue placeholder="请选择..." />
 *     </SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="a">选项 A</SelectItem>
 *       <SelectItem value="b">选项 B</SelectItem>
 *     </SelectContent>
 *   </Select>
 */

import { forwardRef } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../utils/cn'

/* ── Root ──────────────────────────────────────────────── */

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

/* ── Trigger ───────────────────────────────────────────── */

const triggerVariants = cva(
  [
    'inline-flex items-center justify-between gap-1.5 w-full',
    'font-sans text-[var(--font-sm)]',
    'bg-bg-soft text-text',
    'border border-border rounded-xs',
    'px-2.5',
    'transition-colors duration-150',
    'focus-ring',
    'focus:border-primary focus:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[placeholder]:text-text-faint',
  ],
  {
    variants: {
      selectSize: {
        sm: 'h-7 text-[var(--font-xs)]',
        md: 'h-8',
        lg: 'h-9 text-[var(--font-base)]',
      },
    },
    defaultVariants: {
      selectSize: 'md',
    },
  },
)

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  selectSize?: VariantProps<typeof triggerVariants>['selectSize']
}

const SelectTrigger = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, selectSize, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(triggerVariants({ selectSize, className }))}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={14} className="shrink-0 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

/* ── ScrollUpButton ────────────────────────────────────── */

const SelectScrollUpButton = forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp size={14} />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

/* ── ScrollDownButton ──────────────────────────────────── */

const SelectScrollDownButton = forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown size={14} />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

/* ── Content ───────────────────────────────────────────── */

const contentClassName = [
  'z-[var(--z-dropdown)] min-w-[var(--radix-select-trigger-width)] max-h-60 overflow-hidden rounded-md',
  'border border-border bg-panel-elev text-text shadow-lg',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1',
  'data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
].join(' ')

const SelectContent = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        contentClassName,
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      sideOffset={4}
      collisionPadding={8}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[calc(var(--radix-select-trigger-width))]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

/* ── Label ─────────────────────────────────────────────── */

const SelectLabel = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-[var(--font-xs)] font-medium text-text-faint', className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

/* ── Item ──────────────────────────────────────────────── */

const itemClassName = [
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-xs px-2',
  'text-[var(--font-sm)] outline-none transition-colors',
  'text-text hover:bg-bg-soft hover:text-text-strong',
  'focus:bg-bg-soft focus:text-text-strong',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
].join(' ')

const SelectItem = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(itemClassName, 'pl-8', className)}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={13} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

/* ── Separator ─────────────────────────────────────────── */

const SelectSeparator = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-divider', className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  triggerVariants,
}
