/**
 * Dialog 组件
 *
 * 基于 @radix-ui/react-dialog 的模态对话框。
 * 用于审批弹窗、设置表单、确认操作等。
 *
 * @example
 *   <Dialog open={isOpen} onOpenChange={setIsOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>确认操作</DialogTitle>
 *         <DialogDescription>确定要删除此项目吗？</DialogDescription>
 *       </DialogHeader>
 *       <DialogFooter>
 *         <Button variant="secondary">取消</Button>
 *         <Button variant="danger">删除</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */

import { forwardRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'

/* ---- Dialog Root ---- */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

/* ---- DialogOverlay ---- */
const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-[var(--z-modal)]',
      'bg-black/60',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

/* ---- DialogContent ---- */
const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-[var(--z-modal)]',
        'w-full max-w-lg',
        'translate-x-[-50%] translate-y-[-50%]',
        'bg-panel-elev border border-border',
        'rounded-lg shadow-lg',
        'p-5',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          'absolute right-3 top-3',
          'rounded-xs p-1',
          'text-text-muted',
          'transition-colors hover:text-text',
          'focus-ring',
        )}
      >
        <X size={14} />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = 'DialogContent'

/* ---- DialogHeader ---- */
function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 pb-4', className)}
      {...props}
    />
  )
}

/* ---- DialogFooter ---- */
function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 pt-4', className)}
      {...props}
    />
  )
}

/* ---- DialogTitle ---- */
const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-[var(--font-lg)] font-semibold text-text-strong',
      className,
    )}
    {...props}
  />
))
DialogTitle.displayName = 'DialogTitle'

/* ---- DialogDescription ---- */
const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[var(--font-sm)] text-text-muted', className)}
    {...props}
  />
))
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
}
